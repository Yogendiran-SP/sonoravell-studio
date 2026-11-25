# Offline Desktop Alpha engineering gates

Baseline [PR #18 at beef9a5](https://github.com/Yogendiran-SP/sonoravell-studio/pull/18).
The [native CI](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45559230504)
passed. Releases require separate evidence for physical audio and offline editing.

| Workstream | Scope | Acceptance evidence |
| --- | --- | --- |
| A — Physical audio | WASAPI duplex, device faults, calibrated latency, dropouts, and recovery in hardware configurations | Complete the [hardware protocol](HARDWARE_QUALIFICATION.md) and [run report](HARDWARE_QUALIFICATION_REPORT.md). Physical gates remain open. |
| B — Offline desktop | Session and Audio Pool, editing, arrangement, mixer, and adaptive native UI | Deterministic unit and regression checks, file and recovery fixtures, and Windows workspace smoke tests for each increment. |

Workstream B can ship an editing increment while A is in qualification.
WinMM remains the launch default. Automatic compensation, live monitoring,
and production multitrack recording have separate physical release gates.

## Clip model and file compatibility

The first B increment addresses ARR and PRJ requirements and the risks of
source loss, ambiguous clip selection, invalid ranges, and destructive
migration. An audio clip owns a nonzero Session-local ID, an Audio Pool
asset ID, a start tick, and a nonempty source-frame range. The range is
half-open, with stereo frames at the Session sample rate. Conversion from
ticks to frame boundaries uses integer rounding to nearest, with half frames
rounded up. Clip movement changes its tick. Trims can shorten a range or
extend it into still-available source audio. Splitting at the converted tick
partitions the source frames without dropping or repeating a frame. A split
or duplicate receives a new ID. Erasing a clip leaves the Audio Pool asset.

Ticks follow Session tempo. Source offsets and durations stay in frames.
Changing tempo after trimming or splitting can cause adjacent clips to gap
or overlap. Overlaps add in the existing mixer. Mix work and memory caps
still apply. Clip starts must precede the maximum timeline tick. Earlier
files can have playable tails beyond that start boundary within the same
render budget. The edit API rejects an empty source range, unavailable
source, invalid boundary, and failed validation without changing the Session.

The `SONOSESS` version-2 format stores five unsigned little-endian 32-bit
values for each clip in order: clip ID, asset ID, timeline tick, source frame,
and frame count. Other fields retain their previous layout. Version-1 clips
gain deterministic IDs in stored track and clip order and span their entire
original assets. Opening v1 changes only the in-memory model. Save a new v2
file to retain the original. The writer rejects replacing a legacy or newer
version. V1 applications cannot reopen v2. The existing write staging,
autosave slots, and recording journal formats continue to apply.

Acceptance requires sample-exact split and overlap fixtures, rejected edits
leaving metadata and PCM unchanged, deterministic v1 migration, v2
save/reopen, named-file preservation, and recovery/autosave regression tests.
Use an older application with the original v1 copy if rollback is needed.

## Native editing and command history

Select an audio track and a clip in the Inspector. The beat field sets the
target for Move, Split, Duplicate, Trim start, and Trim end. Select Delete
audio clip to remove the chosen instance from the timeline. Track deletion
and clip deletion leave their existing sources in the Audio Pool.

Undo and Redo, also available through Ctrl+Z and Ctrl+Y, retain 24 commands
per open Session. Commands edit and validate a draft before swapping it into
place. Undo/redo swaps validated state and never rewrites PCM. Audio Pool
payloads are immutable and shared between revisions. An invalid or unchanged
draft retains the redo branch. A new committed command after Undo discards
that branch. Opening a Session or restoring a checkpoint starts fresh history.

Move, trim, split, duplicate, delete, track, MIDI note, tempo, and available
mixer changes go through the same history. Structural changes and level
edits stop playback before replacing its prepared audio. Mute updates and
their undo/redo still use the active worker's atomic mute controls. No edit
or revision work occurs on the audio thread. Recording continues to lock
editing until its journal has settled.
