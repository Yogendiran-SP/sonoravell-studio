#pragma once

#include <algorithm>
#include <cstdint>
#include <optional>

namespace sonoravell {
inline constexpr unsigned minimumLoopFrames = 256;

struct PlaybackLoop {
    unsigned first;
    unsigned end;
    bool valid(unsigned total) const noexcept {
        return first < end && end <= total && end - first >= minimumLoopFrames;
    }
    bool operator==(const PlaybackLoop&) const = default;
};

inline unsigned normalizeLoopStart(unsigned frame, PlaybackLoop loop) noexcept {
    return frame >= loop.first && frame < loop.end ? frame : loop.first;
}

// Device submission and Session position use distinct clocks. The UI maps
// consumed frames to the bounded Session timeline, including whole-session loops.
inline unsigned playbackFrame(unsigned total, unsigned start, std::uint64_t consumed, bool loop) noexcept {
    if (!total) return 0;
    start = std::min(start, total);
    if (!loop) return start + static_cast<unsigned>(std::min<std::uint64_t>(total - start, consumed));
    return static_cast<unsigned>((start + consumed % total) % total);
}

inline unsigned playbackFrame(unsigned total, unsigned start, std::uint64_t consumed,
                              std::optional<PlaybackLoop> loop) noexcept {
    if (!loop || !loop->valid(total)) return playbackFrame(total, start, consumed, false);
    const auto length = loop->end - loop->first;
    const auto offset = normalizeLoopStart(start, *loop) - loop->first;
    return loop->first + playbackFrame(length, offset, consumed, true);
}
}
