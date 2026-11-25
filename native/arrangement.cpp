#include "arrangement.hpp"

#include <algorithm>
#include <cstdlib>
#include <limits>
#include <stdexcept>
#include <utility>

namespace sonoravell {
void renameTrack(Project& project, std::size_t index, std::string name) {
    auto& track = project.tracks.at(index);
    if (name.empty() || name.size() > 200 || name.find('\0') != name.npos) {
        throw std::invalid_argument("Enter a track name of 1 to 200 UTF-8 bytes.");
    }
    track.name = std::move(name);
}

std::size_t duplicateTrack(Project& project, std::size_t index) {
    auto copy = project.tracks.at(index);
    if (project.tracks.size() == maxTracks) throw std::runtime_error("The Session is at its track limit.");
    const auto maxTrack = std::ranges::max(project.tracks, {}, &Track::id).id;
    if (maxTrack == std::numeric_limits<std::uint32_t>::max()) throw std::runtime_error("Track IDs exhausted.");
    copy.id = maxTrack + 1;
    if (!copy.clips.empty()) {
        const auto first = newAudioClipId(project);
        if (copy.clips.size() - 1 > std::numeric_limits<std::uint32_t>::max() - first) {
            throw std::runtime_error("Clip IDs exhausted.");
        }
        auto next = first;
        for (auto& clip : copy.clips) clip.id = next++;
    }
    project.tracks.insert(project.tracks.begin() + index + 1, std::move(copy));
    return index + 1;
}

std::size_t moveTrack(Project& project, std::size_t index, bool earlier) {
    auto& track = project.tracks.at(index);
    if ((earlier && index == 0) || (!earlier && index + 1 == project.tracks.size())) return index;
    const auto next = earlier ? index - 1 : index + 1;
    std::swap(track, project.tracks[next]);
    return next;
}

std::uint32_t snapTimelineTick(std::uint32_t tick, std::uint32_t endTick, unsigned step) noexcept {
    if (!endTick) return 0;
    if (!step) return std::min(tick, endTick - 1);
    const auto rounded = (static_cast<std::uint64_t>(tick) + step / 2) / step;
    return static_cast<std::uint32_t>(std::min<std::uint64_t>(rounded, (endTick - 1) / step) * step);
}

std::uint32_t dragTimelineTick(std::uint32_t anchor, int pixels, int width, std::uint32_t visibleTicks,
                               std::uint32_t endExclusive, unsigned step) noexcept {
    if (width <= 0 || !endExclusive || !pixels) return anchor;
    const auto scaled = static_cast<std::int64_t>(pixels) * visibleTicks;
    const auto delta = (scaled + (scaled < 0 ? -width / 2 : width / 2)) / width;
    const auto target = std::clamp<std::int64_t>(anchor + delta, 0, endExclusive - 1);
    return snapTimelineTick(static_cast<std::uint32_t>(target), endExclusive, step);
}

WaveformPeaks::WaveformPeaks(const AudioAsset& asset) noexcept
    : framesPerBin(std::max<std::size_t>(1, (asset.stereo().size() / channelCount + bins - 1) / bins)),
      frames(static_cast<unsigned>(asset.stereo().size() / channelCount)) {
    const auto& stereo = asset.stereo();
    for (unsigned i = 0; i < frames; ++i) {
        auto& value = peaks[bins + i / framesPerBin];
        const auto left = std::abs(static_cast<int>(stereo[i * channelCount]));
        const auto right = std::abs(static_cast<int>(stereo[i * channelCount + 1]));
        value = std::max(value, static_cast<unsigned>(std::max(left, right)));
    }
    for (unsigned i = bins - 1; i > 0; --i) peaks[i] = std::max(peaks[i * 2], peaks[i * 2 + 1]);
}

unsigned WaveformPeaks::peak(std::uint32_t first, std::uint32_t end) const noexcept {
    end = std::min(end, frames);
    if (first >= end) return 0;
    auto left = bins + first / framesPerBin;
    auto right = bins + (end - 1) / framesPerBin + 1;
    unsigned result = 0;
    while (left < right) {
        if (left % 2) result = std::max(result, peaks[left++]);
        if (right % 2) result = std::max(result, peaks[--right]);
        left /= 2;
        right /= 2;
    }
    return result;
}
}
