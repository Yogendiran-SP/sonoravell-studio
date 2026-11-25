#include "piano_roll.hpp"

#include <stdexcept>

using namespace sonoravell;
void check(bool value) {
    if (!value) throw std::runtime_error("Piano Roll regression");
}

int main() {
    check(rollPitchAt(-1, 100, 48) == 72 && rollPitchAt(5, 100, 48) == 71);
    check(rollPitchAt(4, 101, 48) == 71 && rollPitchAt(99, 100, 48) == 48);
    check(rollPitchAt(140, 100, 103) == 103 && rollPitchAt(0, 100, 103) == 127);
    const MidiNote note{960, 120, 61, 96};
    check(rollNoteEdit(note, 960, 96, false) == MidiNote{960, 120, 96, 96});
    check(rollNoteEdit(note, maxTimelineTick, 140, false) == MidiNote{maxTimelineTick - 120, 120, 127, 96});
    check(rollNoteEdit(note, 800, 100, true) == MidiNote{960, 1, 61, 96});
    check(rollNoteEdit(note, 970, 103, true) == MidiNote{960, 10, 61, 96});
    auto changed = note;
    changeVelocity(changed, 2);
    check(changed == MidiNote{960, 120, 61, 112});
    changeVelocity(changed, 100);
    check(changed.velocity == 127);
    changeVelocity(changed, -100);
    check(changed.velocity == 1);
}
