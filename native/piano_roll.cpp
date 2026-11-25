#include "piano_roll.hpp"

#include <algorithm>

namespace sonoravell {
unsigned rollPitchAt(int y, int height, unsigned low) noexcept {
    if (height <= 0) return low;
    const auto row = ((static_cast<std::int64_t>(std::clamp(y, 0, height - 1)) + 1) * rollPitchCount - 1) / height;
    return std::min(127u, low + static_cast<unsigned>(rollPitchCount - 1 - row));
}

MidiNote rollNoteEdit(MidiNote original, unsigned tick, unsigned pitch, bool resize) noexcept {
    if (resize) {
        const auto end = std::clamp(tick, original.tick + 1, maxTimelineTick);
        original.length = end - original.tick;
    } else {
        original.tick = std::min(tick, maxTimelineTick - original.length);
        original.pitch = static_cast<std::uint8_t>(std::min(127u, pitch));
    }
    return original;
}

void changeVelocity(MidiNote& note, int steps) noexcept {
    note.velocity = static_cast<std::uint8_t>(std::clamp<std::int64_t>(
        static_cast<std::int64_t>(steps) * 8 + note.velocity, 1, 127));
}
}
