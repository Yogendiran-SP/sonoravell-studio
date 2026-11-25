# Offline Desktop Alpha integration

The integration starts at PR #30 and preserves the native engine, embedded
Audio Pool, Session editing, and recording journals. Physical acceptance
continues independently under the [Windows protocol](HARDWARE_QUALIFICATION.md).

## Master and track insert pipeline

DSP-01, DSP-02, DSP-05, MIX-01, PRJ-01 and PRJ-04. Use Commands → Master Effects
to open the modeless native insert editor. Add Gain, Parametric EQ, Compressor
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
pipeline with the playback click off. The native master controls and
persistent per-track engine paths have independent tests. The track
editor uses the same commands in the next increment.

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
