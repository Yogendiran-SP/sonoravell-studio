#pragma once

#include "mixer_parameters.hpp"

namespace sonoravell {
inline constexpr unsigned maxFaderPointsPerTrack = 128;

struct FaderPoint {
    unsigned frame;
    unsigned volume;
    int pan;
};

struct FaderLane {
    std::uint32_t trackId;
    std::vector<FaderPoint> points;
};

class FaderCursor {
public:
    FaderCursor(std::span<const FaderPoint> points, unsigned startFrame) noexcept;
    StereoGain next() noexcept;

private:
    std::span<const FaderPoint> points;
    std::size_t upper;
    unsigned frame;
};

class PreparedAutomation {
public:
    PreparedAutomation(const Project& project, std::span<const FaderLane> lanes);
    bool controls(std::size_t track) const noexcept { return !points[track].empty(); }
    FaderCursor cursor(std::size_t track, unsigned frame) const noexcept { return {points[track], frame}; }

private:
    std::array<std::vector<FaderPoint>, maxTracks> points;
};
}
