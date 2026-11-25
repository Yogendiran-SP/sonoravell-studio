#pragma once

#include <algorithm>
#include <cstdint>

namespace sonoravell {
// Device submission and Session position use distinct clocks. The UI maps
// consumed frames to the bounded Session timeline, including whole-session loops.
inline unsigned playbackFrame(unsigned total, unsigned start, std::uint64_t consumed, bool loop) noexcept {
    if (!total) return 0;
    start = std::min(start, total);
    if (!loop) return start + static_cast<unsigned>(std::min<std::uint64_t>(total - start, consumed));
    return static_cast<unsigned>((start + consumed % total) % total);
}
}
