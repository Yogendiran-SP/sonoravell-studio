# Audio engine evolution

The engine starts from the native v3 Session, immutable embedded PCM, and
the independent WinMM/WASAPI streams at PR #22. Two workstreams continue.
Workstream A follows [physical qualification](HARDWARE_QUALIFICATION.md).
Workstream B delivers the offline production workflow with scripted and
portable acceptance before any hardware-dependent defaults change.

## Live mixer parameters

MIX-01, ENG-01, PRJ-04. The control thread validates a Session edit, commits
it to undo history, and publishes all effective track channel gains plus
the master level. Three fixed slots provide one private producer slot,
one private consumer slot and one exchange slot. A lock-free unsigned
atomic transfers ownership and indicates an unread update. The render
worker uses the latest complete state at the next submitted buffer, without
allocation, locks or waiting. Rapid commits may coalesce. History retains
every committed UI edit and persists the last values in the existing v3
format. Device interfaces and recording journals stay independent.

Source preparation is independent of mixer values. The mixer interpolates
effective gains for 240 frames at 48 kHz. A change midway through a ramp
begins from the running value. Output already queued at the endpoint is
unaffected. Fresh playback and offline export start at the settled gains.
Multiplying after dry float accumulation may change rounding for older
non-unity mixes. The channel balance, mute precedence, sum and clip rules
are the same. Structural edits settle playback before snapshot replacement.

Acceptance covers first and settled samples, in-flight retargeting, stereo
balance and master composition, undo/redo with the same prepared Windows
snapshot, and a concurrent publisher/reader that verifies every observed
snapshot is coherent and forward-moving. Endpoint timing and audible
acceptance remain part of the hardware protocol. Rolling back this increment
retains v3 Session and journal compatibility.

## Offline Desktop Alpha exit checklist

- Complete Create → Import WAV → Compose MIDI → Record → Arrange → Edit →
  Mix → Save → Reopen → Export on a supported Windows test machine with
  networking unavailable. Compare the reopened mix and WAV.
- Under ordinary Start/Stop, interrupted capture, failed save and recovery,
  preserve the original named Session and recover the verified take prefix.
- Run the keyboard-only workflow, check focus order and transport visibility
  in each layout, and record usability issues in the tracker.
- Record worst-case block time and prepared-buffer memory for defined sparse
  and dense fixtures. Record qualified endpoint periods and dropouts
  separately through Workstream A. Document supported project limits.
- Attach green Windows, macOS and Linux CI, known limitations, and the
  Windows rollback build. Keep compensation, monitoring, and production
  multitrack recording gated on Workstream A.

## Bounded source blocks

ENG-01, ENG-02, ENG-03, EDIT-01. Full-length dry stereo track buffers
previously used four bytes per channel sample across every track, including
silence. The existing validation caps that budget at 256 MiB and also
limits work from overlapping events. A sparse snapshot now prepares
256-frame stereo tiles on the control thread only where dry audio is
nonzero. Tile lookup by absolute source frame is constant time. The mixer
advances ramps through silent tiles, keeps source ordering on overlaps,
and slices each device request at tile boundaries. The output stage
quantizes complete frames and measures the same PCM as before.

Clip input is read from immutable Audio Pool ranges. MIDI notes still use
the deterministic built-in instrument renderer during source preparation.
The mixer sees both through one immutable block boundary and uses fixed
stack scratch space. The device contract, source work cap, file schema and
capture lifecycles are unchanged. The intended next boundary for stateful
processors is the mixed stereo float block before device quantization,
with processor ownership and state local to a render attempt.

Dense storage remains available as a comparison and rollback path. The
regression requires bit-identical PCM on trimmed and overlapping clips,
instrument notes, partial blocks, gaps and seeks. In the sparse fixture,
prepared buffer memory must be under 1/30 of dense reference memory.
The sonoravell-render --benchmark command reports dense and sparse
preparation time, owned track-buffer bytes, and block p95 and maximum mix
time. Those measurements omit asset storage and hardware I/O. Dense
arrangements can still approach the original sample cap, and sparse tiles
have an index overhead. Synthesis preparation still runs before playback.

## Independent playback transport

ENG-03. Play changes to Pause while independent output is running, and to
Resume after pausing. Pause closes the current endpoint worker. Resume
opens the selected endpoint explicitly at the last observed played frame.
The WinMM position counts completed buffers. WASAPI uses submitted frames
minus endpoint padding. Both are conservative transport positions, not
sample-accurate hardware pause. Click the ruler to seek or choose Seek to
start. Ctrl+Space toggles play and pause. Ctrl+Home seeks to zero.

Choose Loop while playback is stopped or paused. The next independent
playback wraps at the complete Session end. Smoothing carries through the
seam. Signals that differ at the seam can click. The engine preserves
sample order rather than silently crossfading a Session. The stereo WAV
and experimental duplex continue to play once. Capture still owns Stop
and retains the existing editing lockout. Loop and cursor state are
view controls and do not change saved Session or journal formats.

Scripted sample checks cover split hardware buffers, exact wrap order,
large frame counters, resume position, and one-shot EOF. The Windows
workspace smoke tests check grid seeking, loop selection, and unchanged
Session/snapshot state. Physical pause timing and audible seam quality
are hardware acceptance work.

## Local adaptive workspace

UX-01, UX-06, UX-07, UX-08, UX-09 and UX-14. Beginner through Pro and
Recording, Arrange, Composition and Mix set display options only. Use
Commands to widen or narrow either side panel in 26-pixel steps. Focus
and individual visibility retain transport. Tab moves through the native
controls and Ctrl+F, search text, and Enter open the filtered commands.
Reset workspace restores default visibility and widths in one action.

The last workspace is saved per Windows user. Save workspace layout as
and Open workspace layout use named local files with a separate versioned
nine-byte format. Load validates every field before applying the view.
Save creates a new name and preserves existing layout files. Preset and
panel switching works during recording. Custom file dialogs are disabled
during capture so Stop stays available. Session, prepared audio, command
history and offline recording do not depend on the settings. No third-party
framework is introduced.

Portable acceptance covers layout round trips, bounds, corruption and
unsupported versions. Native workspace smoke verifies resize and reset
while retaining the same Session, snapshot and enabled Stop. Docking,
floating panels, accessibility walkthrough and usability acceptance remain
separate work.
