#include "instruments.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace sonoravell {
BuiltinVoice::BuiltinVoice(Instrument instrument, const MidiNote& note, unsigned startFrame, unsigned frameCount)
    : instrument(instrument), pitch(note.pitch), length(frameCount), noiseState(0x8c31274u + startFrame),
      frequency(440 * std::exp2((note.pitch - 69) / 12.0)), level(.14 * note.velocity / 127) {
    if (instrument >= Instrument::audio || note.pitch > 127 || !note.velocity || note.velocity > 127) {
        throw std::runtime_error("Invalid built-in instrument voice.");
    }
}

std::size_t BuiltinVoice::read(std::span<float> output) noexcept {
    constexpr double tau = 2 * std::numbers::pi;
    constexpr double balance[][2] = {{.85, .65}, {.8, .8}, {.8, .8}, {.55, .85}};
    const auto count = std::min<std::size_t>({output.size() / channelCount, sourceBlockFrames, length - frame});
    for (std::size_t i = 0; i < count; ++i, ++frame) {
        const double time = static_cast<double>(frame) / sampleRate;
        const double phase = tau * frequency * time;
        const double envelope = std::min({1.0, time * 350, (length - frame - 1) / 500.0});
        double voice = std::sin(phase);
        if (instrument == Instrument::drums) {
            noiseState = noiseState * 1664525u + 1013904223u;
            const double noise = (noiseState >> 8) / 8388608.0 - 1.0;
            voice = pitch == 36
                ? std::sin(tau * (52 * time + 2 * (1 - std::exp(-55 * time)))) * std::exp(-17 * time)
                : noise * std::exp(-(pitch == 38 ? 29 : 65) * time);
        } else if (instrument == Instrument::pluck) {
            voice = (.8 * voice + .2 * std::sin(phase * 2)) * std::exp(-12 * time);
        }
        for (unsigned channel = 0; channel < channelCount; ++channel) {
            output[i * channelCount + channel] =
                static_cast<float>(level * voice * envelope * balance[static_cast<unsigned>(instrument)][channel]);
        }
    }
    return count * channelCount;
}
}
