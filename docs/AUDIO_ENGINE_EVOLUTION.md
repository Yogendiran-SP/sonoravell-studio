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

## Internal processing stage

DSP-01, DSP-02 and ENG-09. The mixer accepts an optional, render-owner
stereo processor before master gain, PCM conversion and metering. It receives at most 256
frames at a time through reused fixed stack storage. InternalEffects
implements gain, a peaking biquad EQ, linked peak-detection compression
and a stereo feedback delay. Filter coefficients, detector coefficients
and delay storage are prepared before processing. The feedback magnitude
is capped at 0.9 and the delay buffer at two seconds (1,536,000 bytes at
48 kHz with two double channels). The processing loop does no allocation,
locking or I/O. The compressor can evaluate one power per frame above
threshold. Hardware callback time with effects requires separate evidence.

The initial effect settings are fixed for each prepared instance. Bypass
ramps over 240 frames and retains DSP state. Reset clears filters,
detector and delay off the processing path. Use a fresh or reset instance
for a seek or new render when deterministic output from that point is
required. One-shot renders end at the Session boundary, so add arrangement
space if tail audio needs to be included in an internal render.

The deterministic checks cover invalid settings, gain, EQ response,
linked compression, expected echoes, bypass, reset and PCM equivalence
with unequal block sizes. The [Alpha integration](OFFLINE_ALPHA_INTEGRATION.md)
connects these processors to the master and track inserts and documents
v4 persistence, editing, fresh state on seek, and release limits.
Live coefficient editing, expanded routing, and third-party hosting need
further lifecycle and licensing reviews.

## Arrangement gestures

EDIT-01 and UX-02. Drag the body of an audio clip to move it on its own
track. On wider clips, use the marked left and right ends to trim. The
timeline draws a proposed edit position while dragging, using the same
grid as the ruler. A click only selects the clip. Escape or loss of mouse
capture cancels the action. The Inspector still provides precise beat
entry for narrow clips and keyboard workflows.

A released gesture becomes one validated undoable command. An invalid
source or timeline range leaves the original clip and its source media
intact. Capture locks out drag edits. Structural edits follow the same
snapshot and playback lifecycle as Inspector commands. Tests cover
signed drag projection, grid and boundary behavior and a Windows
drag transaction, cancellation and undo. The smoke starts from prepared
gesture geometry so it also runs on an unattended Windows desktop. Playback metronome and recording count-in
remain separate acceptance work.

## Graphical MIDI editing

EDIT-02 and UX-10. Select an instrument track and use Ctrl+P or Toggle
Piano Roll in Commands. Click an empty cell to add a note at the current
snap resolution. Drag notes to change time and pitch. Drag the right
edge of a wide note to resize it. Use the wheel over a note to change its
velocity, Ctrl+wheel to scroll pitches, and right-click or Delete to
remove a note. Command search also offers two velocity adjustments for
the selected note. The Inspector continues to provide typed positions.

Edits and gestures use the existing command history. Capture disables
note editing. Switching the view or scrolling pitches leaves project
data and the playback snapshot alone. Portable tests check pitch rows,
velocity, time bounds and resizing. The Windows workspace smoke exercises
note creation, velocity adjustment and deletion. Keyboard-only and
assistive-technology usability verification remains open.

## Independent playback metronome

ENG-03. Toggle the playback metronome with Ctrl+M or Commands while
stopped or paused. The click follows Session tempo at the same integer
frame boundaries as clips and notes and accents the first beat of each
bar. The reference click waveforms and beat positions are prepared with
the snapshot. Each render block adds only overlapping clicks, after
effects and before master level and metering. The click starts in the
right phase when seeking or looping.

Click playback applies to independent WinMM and WASAPI output. WAV export,
independent capture, experimental duplex and Session storage are unaffected.
Recording count-in remains a later acceptance item. Automated tests cover
positions at fractional frames per beat, downbeat accent, continuity when
seeking, a wrapped device buffer and clean WAV source PCM.
