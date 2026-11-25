#pragma once

#include "project.hpp"

namespace sonoravell {
enum class ClipEdit { move, trimStart, trimEnd, split, duplicate, erase };

// Timeline commands address a clip by ID. Boundary ticks use frameAtTick at
// the current tempo. Returns the resulting selection (zero after deletion).
std::uint32_t editAudioClip(Project& project, std::uint32_t clipId, ClipEdit edit, std::uint32_t tick = 0);
}
