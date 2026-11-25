#include "effects.hpp"
#include "session.hpp"

#include <array>
#include <cmath>
#include <limits>
#include <numbers>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool result, const char* message) {
    if (!result) throw std::runtime_error(message);
}

void rejects(const EffectSettings& settings) {
    try { InternalEffects rejected(settings); }
    catch (const std::invalid_argument&) { return; }
    throw std::runtime_error("Expected bounded processor settings.");
}

void testProcessors() {
    EffectSettings settings;
    settings.delay = Delay{2, .5, 1.};
    InternalEffects delay(settings);
    std::array<double, 12> impulse{.5, .25};
    delay.process(impulse);
    check(impulse == std::array<double, 12>{0., 0., 0., 0., .5, .25, 0., 0., .25, .125, 0., 0.},
          "Delay must yield the exact expected echoes on both channels.");
    delay.reset();
    impulse = {};
    delay.process(impulse);
    check(impulse == std::array<double, 12>{}, "Reset must clear feedback history.");

    settings = {};
    settings.gainDb = 6.;
    InternalEffects gain(settings);
    std::array<double, 2> sample{.2, -.4};
    gain.process(sample);
    check(sample[0] > .39 && sample[0] < .41 && sample[1] == -2 * sample[0], "Decibel gain must scale stereo equally.");
    gain.setBypassed(true);
    for (unsigned i = 0; i <= InternalEffects::bypassRampFrames; ++i) {
        std::array next{.2, -.4};
        gain.process(next);
        check(next[0] <= sample[0] + 1e-12 && next[0] >= .2 && next[1] == -2 * next[0],
              "Bypass must crossfade without imbalance.");
        sample = next;
    }
    check(sample == std::array{.2, -.4}, "Bypass must settle at unprocessed audio.");

    settings = {};
    settings.eq = ParametricEq{1000., 9., 1.};
    InternalEffects eq(settings);
    double energy = 0.;
    for (unsigned i = 0; i < 4800; ++i) {
        const auto sine = std::sin(2. * std::numbers::pi * i / 48.) * .1;
        std::array signal{sine, 0.};
        eq.process(signal);
        check(std::isfinite(signal[0]) && signal[1] == 0., "EQ must maintain independent, finite channels.");
        if (i >= 2400) energy += signal[0] * signal[0];
    }
    check(energy > 80. && energy < 110., "Peaking EQ must boost its configured center.");

    settings = {};
    settings.compressor = Compressor{-18., 4., 1., 100.};
    InternalEffects control(settings);
    for (unsigned i = 0; i < 2000; ++i) {
        sample = {.8, -.2};
        control.process(sample);
    }
    check(sample[0] > .15 && sample[0] < .3 && std::abs(sample[1] + sample[0] / 4.) < 1e-12,
          "The compressor must reduce a sustained peak and preserve stereo balance.");
}

void testBlockIntegration() {
    Project project;
    project.bars = 1;
    project.assets.emplace_back(1, "Impulse", Samples{16000, -16000});
    project.tracks.push_back({1, "Source", Instrument::audio, false, 100, {}, {{1, 1, 0, 0, 1}}});
    const SessionAudio audio(project);
    EffectSettings settings;
    settings.gainDb = -3.;
    settings.eq = ParametricEq{1600., 4., .7};
    settings.compressor = Compressor{-24., 5., .5, 200.};
    settings.delay = Delay{299, .4, .5};
    InternalEffects offline(settings), streamed(settings);
    const auto reference = audio.render({}, &offline);
    check(reference[0] != 16000 && reference[299 * channelCount] != 0, "The output stage must include the effect chain.");
    PlaybackMixer mixer(audio, {}, 0, nullptr, nullptr, false, &streamed);
    Samples blocks(reference.size());
    for (std::size_t written = 0; written < blocks.size();) {
        auto remainder = std::span(blocks).subspan(written);
        const auto count = mixer.read(remainder.first(std::min<std::size_t>(170, remainder.size())));
        check(count > 0, "Streaming must advance through the fixed Session duration.");
        written += count;
    }
    check(reference == blocks && mixer.finished(), "Offline and streamed effects must match sample-for-sample.");
    offline.reset();
    check(audio.render({}, &offline) == reference, "Reset must reproduce the initial output.");
    offline.reset();
    MixerParameters muted;
    muted.master = 0.;
    for (const auto sample : audio.render(muted, &offline)) {
        check(sample == 0, "Master gain must control the entire processor output and its tail.");
    }
}
}

int main() {
    testProcessors();
    testBlockIntegration();
    EffectSettings settings;
    settings.gainDb = std::numeric_limits<double>::quiet_NaN();
    rejects(settings);
    settings = {};
    settings.eq = ParametricEq{24000., 0., 1.};
    rejects(settings);
    settings = {};
    settings.compressor = Compressor{-6., 0., 1., 20.};
    rejects(settings);
    settings = {};
    settings.delay = Delay{InternalEffects::maxDelayFrames + 1, .5, .5};
    rejects(settings);
    settings.delay = Delay{1, 1., .5};
    rejects(settings);
}
