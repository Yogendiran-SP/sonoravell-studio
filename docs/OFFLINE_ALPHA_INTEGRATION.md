# Offline Desktop Alpha integration

The integration starts at PR #30 and preserves the native engine, embedded
Audio Pool, Session editing, and recording journals. Physical acceptance
continues independently under the [Windows protocol](HARDWARE_QUALIFICATION.md).

## Master and track insert pipeline

DSP-01, DSP-02, DSP-05, MIX-01, PRJ-01 and PRJ-04. Use Commands → Master Effects
to open the modeless native insert editor for the master, or select a track
and use Commands → Track Effects for that track. Add Gain, Parametric EQ, Compressor
or Delay, select a named parameter, enter its indicated units, and choose Apply.
Move up/down changes processing order. Bypass fades to or from the dry input
over 240 frames (5 ms at 48 kHz). Disable removes the processor from the active
chain until it is re-enabled. Undo and Redo use the same Session command history.

Each bus has at most four inserts, with stable nonzero IDs local to that bus.
The model allows at most twelve inserts and eight seconds (6,144,000 bytes)
of configured stereo-double delay memory across the Session, including bypassed
and disabled inserts. A single delay is limited to two seconds. Both save and
load validate type, ID, flags, parameter ranges and the aggregate budget.
There are no new third-party dependencies.

The engine order is dry source → track inserts → track balance and level
(including mute/solo) → track sum → master inserts → playback click →
master level → PCM and meters. Track processors also receive silence in
gaps so their tails can continue. The offline renderer uses the same
pipeline with the playback click off. Master and track editing use the same commands, processor model and bounded
prepare path. The Track Effects window stays attached to the selected track
ID until reopened for another track. Deleting its track or opening another
Session closes that editing view.

| Operation | Processing state |
| --- | --- |
| Play, resume, or seek | Prepare a fresh rack on the control thread before starting output. Earlier timeline material is not replayed into processor state. |
| Loop boundary | Keep state continuous and wrap source frames. An audible seam is possible. |
| Pause or Stop | Join the output worker, then release processor state on the control thread. |
| Bypass | Keep the enabled processor running, publish the complete bypass mask with mixer parameters, and crossfade. Undo/redo takes the same live path. |
| Insert, remove, reorder, disable or edit a parameter | Validate through command history, stop output, and use the new rack on the next Play. Dry sources remain prepared. |
| Render end or WAV export | End at the Session boundary. Extend the arrangement with time after the last event to include a tail. |
| Invalid edit or excessive configured effects | Reject the draft and keep the playback, Session, and undo history intact. |
| Experimental duplex startup | Prepare the rack before capture starts or any output worker owns it. The recording-first failure policy is unchanged. |

## Session compatibility and rollback

SONOSESS v4 extends v3 after the embedded assets with one master list and
one list per track in serialized track order. A list starts with its
one-byte count. Each entry has a little-endian uint32 ID, one-byte effect
kind (0–3), one-byte enabled/bypass bits, and four little-endian signed
int32 parameter fields. Unused fields are zero. Older v1, v2 and v3 files
open with empty insert lists. Use Save As with a new filename to preserve
the original during migration. Older applications can use those original
files. V4 cannot open in v3-era builds. Current autosave writes v4, and
take files and recording journals retain their previous format.

Automated checks cover dry output, ordered effects, live bypass and undo,
unequal render blocks, muted track tails, cold seek, loop boundaries,
bounded allocations at preparation, legacy migration, rejected writes,
malformed payloads, autosave and recording regressions. Timing under
device load, audible seams and physical recovery remain acceptance items.

## Arrangement and Piano Roll navigation

EDIT-01, EDIT-02 and UX-10. Arrangement and Piano Roll share a frame-based
timeline viewport. Use Commands to zoom, scroll, or Fit Session timeline.
Ctrl+Page Up and Ctrl+Page Down zoom about the visible playhead, or the
viewport center when it is outside the view. Both views use the same
mapping for the ruler, waveform visibility, clip hit-testing and edits.
Zoom and scroll preserve the Session and prepared audio.

Drag the body of an audio clip into another audio track to move it in
one undoable operation. The clip keeps its ID, asset and source range.
Instrument-track drops are rejected. The existing trim handles keep the
clip on its original track. With the Piano Roll focused after selecting
a note, arrows nudge time or pitch and Shift+Left/Right changes duration.
These actions use the current grid, or one tick when the grid is Off.
No Session format change is required.


## Selectable loop regions

ENG-03. Locate the cursor using the ruler. In Commands, choose Set loop
start at cursor and Set loop end at cursor, then enable Loop. The ruler
highlights the selected span. The half-open region is at least 256 frames
and stays within the current Session. Use whole-Session loop clears the
region. Change it while stopped or paused. The region is a workspace
transport choice and starts fresh on Session open.

Playback starting outside the active loop enters at its first frame.
The playhead maps the device's consumed frame count to the same range.
Processor state is continuous across wraps, including when a device
buffer spans several wraps. Stop, resume and seek still create fresh
processor state. WAV export and experimental duplex retain one-shot
behavior. Keyboard commands, a deterministic loop fixture and the
Windows workspace check cover the boundary and rejection policy.


## Alpha acceptance

Use the [finite alpha checklist](ALPHA_RELEASE_CHECKLIST.md) for candidate
evidence, performance reporting and rollback. Portability checks and
synthetic recording recovery run in CI. The candidate walkthrough,
accessibility review and physical audio measurements have separate sign-off.

## Engine boundaries for later milestones

ENG-06, EDIT-07 and INS-01. The optional immutable fader automation input
compiles ordered, bounded frame points for track volume and pan. The
renderer interpolates both controls before applying the resulting stereo
trim to the existing mixer fader. The first and last points hold outside
their range. Absolute Session frames make offline export, seeks and loop
wraps agree. Mute and solo retain precedence. There is no allocation on
the playback path, and Sessions without a prepared lane use the existing
mixer path. The native automation editor and automation persistence stay
outside the frozen alpha scope.

Built-in note voices now share a bounded stereo source interface. Each
voice owns its phase position and deterministic noise sequence. The
source builder prepares voices and sums them in existing note order, off
the audio thread. Partition tests retain identical samples across block
sizes. Live instrument scheduling and third-party hosting are later work.
