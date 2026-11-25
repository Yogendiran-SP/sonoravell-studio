#include "clip_edit.hpp"

#include <algorithm>
#include <stdexcept>

namespace sonoravell {
std::uint32_t editAudioClip(Project& project, std::uint32_t clipId, ClipEdit edit, std::uint32_t tick) {
    const auto track = std::ranges::find_if(project.tracks, [&](const Track& candidate) {
        return std::ranges::find(candidate.clips, clipId, &AudioClip::id) != candidate.clips.end();
    });
    if (track == project.tracks.end()) throw std::runtime_error("Select an audio clip first.");
    auto staged = track->clips;
    const auto selected = std::ranges::find(staged, clipId, &AudioClip::id);
    const auto start = frameAtTick(selected->tick, project.tempo);
    const auto sourceFrames = findAsset(project, selected->assetId).stereo().size() / channelCount;
    if (!selected->frameCount || selected->sourceFrame >= sourceFrames ||
        selected->frameCount > sourceFrames - selected->sourceFrame) {
        throw std::runtime_error("Audio clip range is outside its source.");
    }
    if (edit != ClipEdit::erase && tick > maxTimelineTick) throw std::runtime_error("Clip edit is outside the timeline.");
    const auto boundary = frameAtTick(tick, project.tempo);
    std::uint32_t selection = clipId;
    switch (edit) {
    case ClipEdit::move:
        selected->tick = tick;
        break;
    case ClipEdit::trimStart: {
        const auto delta = static_cast<std::int64_t>(boundary) - start;
        const auto offset = static_cast<std::int64_t>(selected->sourceFrame) + delta;
        const auto frames = static_cast<std::int64_t>(selected->frameCount) - delta;
        if (offset < 0 || frames <= 0 || static_cast<std::uint64_t>(offset + frames) > sourceFrames) {
            throw std::runtime_error("Start trim is outside the source or leaves an empty clip.");
        }
        selected->tick = tick;
        selected->sourceFrame = static_cast<std::uint32_t>(offset);
        selected->frameCount = static_cast<std::uint32_t>(frames);
        break;
    }
    case ClipEdit::trimEnd:
        if (boundary <= start || selected->sourceFrame >= sourceFrames ||
            boundary - start > sourceFrames - selected->sourceFrame) {
            throw std::runtime_error("End trim is outside the source or leaves an empty clip.");
        }
        selected->frameCount = boundary - start;
        break;
    case ClipEdit::split: {
        if (boundary <= start || boundary - start >= selected->frameCount) {
            throw std::runtime_error("Choose a split point strictly inside the clip.");
        }
        const auto leftFrames = boundary - start;
        auto right = *selected;
        right.id = newAudioClipId(project);
        right.tick = tick;
        right.sourceFrame += leftFrames;
        right.frameCount -= leftFrames;
        selected->frameCount = leftFrames;
        selection = right.id;
        staged.insert(selected + 1, right);
        break;
    }
    case ClipEdit::duplicate: {
        auto copy = *selected;
        copy.id = newAudioClipId(project);
        copy.tick = tick;
        selection = copy.id;
        staged.insert(selected + 1, copy);
        break;
    }
    case ClipEdit::erase:
        staged.erase(selected);
        selection = 0;
        break;
    }
    track->clips.swap(staged);
    try {
        validateProject(project);
    } catch (...) {
        track->clips.swap(staged);
        throw;
    }
    return selection;
}
}
