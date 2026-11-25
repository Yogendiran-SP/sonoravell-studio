#pragma once

#include "project.hpp"
#include <array>

namespace sonoravell {
void renameTrack(Project& project, std::size_t index, std::string name);
std::size_t duplicateTrack(Project& project, std::size_t index);
std::size_t moveTrack(Project& project, std::size_t index, bool earlier);
std::uint32_t snapTimelineTick(std::uint32_t tick, std::uint32_t endTick, unsigned step) noexcept;

class WaveformPeaks {
public:
    explicit WaveformPeaks(const AudioAsset& asset) noexcept;
    unsigned peak(std::uint32_t first, std::uint32_t end) const noexcept;

private:
    static constexpr unsigned bins = 256;
    std::array<unsigned, bins * 2> peaks{};
    unsigned framesPerBin;
    unsigned frames;
};
}
