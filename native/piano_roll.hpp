#pragma once

#include "arrangement.hpp"

namespace sonoravell {
inline constexpr int rollPitchCount = 25;

unsigned rollPitchAt(int y, int height, unsigned low) noexcept;
MidiNote rollNoteEdit(MidiNote original, unsigned tick, unsigned pitch, bool resize) noexcept;
void changeVelocity(MidiNote& note, int steps) noexcept;
}
