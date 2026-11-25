#pragma once

#include "source_blocks.hpp"

#include <span>

namespace sonoravell {
// A prepared note voice renders stereo source frames in bounded blocks.
// Scheduling, voice lifetime and summing belong to the caller.
class BuiltinVoice {
public:
    BuiltinVoice(Instrument instrument, const MidiNote& note, unsigned startFrame, unsigned frameCount);
    std::size_t read(std::span<float> output) noexcept;
    bool finished() const noexcept { return frame == length; }

private:
    Instrument instrument;
    int pitch;
    unsigned length;
    unsigned frame = 0;
    std::uint32_t noiseState;
    double frequency, level;
};
}
