#include "fader_automation.hpp"

#include <algorithm>
#include <stdexcept>

namespace sonoravell {
FaderCursor::FaderCursor(std::span<const FaderPoint> points, unsigned startFrame) noexcept
    : points(points),
      upper(points.empty() ? 0 : static_cast<std::size_t>(std::ranges::upper_bound(points, startFrame, {}, &FaderPoint::frame) - points.begin())),
      frame(startFrame) {}

StereoGain FaderCursor::next() noexcept {
    if (points.empty()) return {};
    while (upper < points.size() && points[upper].frame <= frame) ++upper;
    const auto& left = upper ? points[upper - 1] : points.front();
    const auto& right = upper ? points[std::min(upper, points.size() - 1)] : left;
    const auto mix = left.frame == right.frame ? 0. : static_cast<double>(frame - left.frame) / (right.frame - left.frame);
    ++frame;
    const auto volume = (left.volume + (static_cast<double>(right.volume) - left.volume) * mix) / 100.;
    const auto pan = (left.pan + (right.pan - left.pan) * mix) / 100.;
    return {volume * (1. - std::max(pan, 0.)), volume * (1. + std::min(pan, 0.))};
}

PreparedAutomation::PreparedAutomation(const Project& project, std::span<const FaderLane> lanes) {
    if (project.tracks.size() > maxTracks || lanes.size() > project.tracks.size()) {
        throw std::runtime_error("Too many automation lanes.");
    }
    const auto total = sessionFrames(project);
    for (const auto& lane : lanes) {
        const auto track = std::ranges::find(project.tracks, lane.trackId, &Track::id);
        if (track == project.tracks.end() || lane.points.empty() || lane.points.size() > maxFaderPointsPerTrack) {
            throw std::runtime_error("Invalid automation track or point count.");
        }
        auto& target = points[static_cast<std::size_t>(track - project.tracks.begin())];
        if (!target.empty()) throw std::runtime_error("Duplicate automation track.");
        for (const auto& point : lane.points) {
            if (point.frame >= total || point.volume > 100 || point.pan < -100 || point.pan > 100 ||
                (!target.empty() && target.back().frame >= point.frame)) {
                throw std::runtime_error("Invalid or unordered volume/pan point.");
            }
            target.push_back(point);
        }
    }
}
}
