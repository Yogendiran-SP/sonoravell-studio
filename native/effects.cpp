#include "effects.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace sonoravell {
namespace {
bool inRange(double value, double low, double high) noexcept {
    return value >= low && value <= high;
}

double amplitude(double dB) {
    return std::pow(10., dB / 20.);
}

double envelopePole(double milliseconds) {
    return std::exp(-1000. / (sampleRate * milliseconds));
}

double withoutTinyTail(double value) noexcept {
    return std::abs(value) < 1e-24 ? 0. : value;
}
}

InternalEffects::InternalEffects(const EffectSettings& settings) {
    if (!inRange(settings.gainDb, -24., 24.)) throw std::invalid_argument("Gain must be within +/-24 dB.");
    gain = amplitude(settings.gainDb);
    if (settings.eq) {
        const auto spec = *settings.eq;
        if (!inRange(spec.frequencyHz, 20., 20000.) || !inRange(spec.gainDb, -18., 18.) || !inRange(spec.q, .1, 10.)) {
            throw std::invalid_argument("Invalid parametric EQ settings.");
        }
        const auto angle = 2. * std::numbers::pi * spec.frequencyHz / sampleRate;
        const auto a = amplitude(spec.gainDb / 2.);
        const auto alpha = std::sin(angle) / (2. * spec.q);
        const auto a0 = 1. + alpha / a;
        const auto b1 = -2. * std::cos(angle) / a0;
        eq = EqState{(1. + alpha * a) / a0, b1, (1. - alpha * a) / a0, b1, (1. - alpha / a) / a0};
    }
    if (settings.compressor) {
        const auto spec = *settings.compressor;
        if (!inRange(spec.thresholdDb, -60., 0.) || !inRange(spec.ratio, 1., 20.) ||
            !inRange(spec.attackMs, .1, 100.) || !inRange(spec.releaseMs, 10., 1000.)) {
            throw std::invalid_argument("Invalid compressor settings.");
        }
        compressor = CompressorState{amplitude(spec.thresholdDb), 1. - 1. / spec.ratio,
                                     envelopePole(spec.attackMs), envelopePole(spec.releaseMs)};
    }
    if (settings.delay) {
        const auto spec = *settings.delay;
        if (spec.frames == 0 || spec.frames > maxDelayFrames || !inRange(spec.feedback, -.9, .9) ||
            !inRange(spec.wet, 0., 1.)) throw std::invalid_argument("Invalid delay settings.");
        delay.resize(spec.frames);
        feedback = spec.feedback;
        wet = spec.wet;
    }
}

void InternalEffects::EqState::process(std::array<double, channelCount>& frame) noexcept {
    for (unsigned channel = 0; channel < channelCount; ++channel) {
        const auto input = frame[channel];
        const auto output = b0 * input + z1[channel];
        z1[channel] = withoutTinyTail(b1 * input - a1 * output + z2[channel]);
        z2[channel] = withoutTinyTail(b2 * input - a2 * output);
        frame[channel] = output;
    }
}

void InternalEffects::CompressorState::process(std::array<double, channelCount>& frame) noexcept {
    const auto peak = std::max(std::abs(frame[0]), std::abs(frame[1]));
    const auto pole = peak > envelope ? attack : release;
    envelope = withoutTinyTail(peak + pole * (envelope - peak));
    if (envelope > threshold) {
        const auto scale = std::pow(threshold / envelope, slope);
        for (auto& sample : frame) sample *= scale;
    }
}

void InternalEffects::setBypassed(bool bypassed) noexcept {
    const auto next = bypassed ? 0. : 1.;
    if (next == target) return;
    target = next;
    remaining = bypassRampFrames;
    step = (target - mix) / remaining;
}

void InternalEffects::reset() noexcept {
    if (eq) {
        eq->z1 = {};
        eq->z2 = {};
    }
    if (compressor) compressor->envelope = 0.;
    std::ranges::fill(delay, std::array<double, channelCount>{});
    delayCursor = 0;
    remaining = 0;
    mix = target;
}

void InternalEffects::process(std::span<double> block) noexcept {
    for (std::size_t i = 0; i + 1 < block.size(); i += channelCount) {
        const std::array dry{block[i], block[i + 1]};
        std::array frame{dry[0] * gain, dry[1] * gain};
        if (eq) eq->process(frame);
        if (compressor) compressor->process(frame);
        if (!delay.empty()) {
            auto& memory = delay[delayCursor];
            for (unsigned channel = 0; channel < channelCount; ++channel) {
                const auto delayed = memory[channel];
                memory[channel] = withoutTinyTail(frame[channel] + delayed * feedback);
                frame[channel] += wet * (delayed - frame[channel]);
            }
            if (++delayCursor == delay.size()) delayCursor = 0;
        }
        for (unsigned channel = 0; channel < channelCount; ++channel) {
            block[i + channel] = dry[channel] + mix * (frame[channel] - dry[channel]);
        }
        if (remaining) mix = --remaining ? mix + step : target;
    }
}
}
