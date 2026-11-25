#pragma once

#include "project.hpp"

#include <array>
#include <span>
#include <vector>

namespace sonoravell {
class Metronome {
public:
    Metronome(unsigned tempo, unsigned frames);
    // Device-independent click aligned to Session frames, added before the master.
    void add(std::span<double> stereo, unsigned firstFrame) const noexcept;
    std::size_t scheduledBytes() const noexcept;

private:
    static constexpr unsigned clickFrames = sampleRate / 100;
    std::array<double, clickFrames> beat{}, downbeat{};
    std::vector<unsigned> positions;
};
}
