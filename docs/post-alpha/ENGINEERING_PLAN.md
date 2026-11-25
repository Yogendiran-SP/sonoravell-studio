# Post-alpha engineering plan

This branch records design proposals. The Offline Desktop Alpha candidate remains
pinned to its tested source and Windows package. Workstream A continues physical
qualification using the existing protocol. Workstream B tests local editing and
engine changes on feature branches from this branch. Each feature needs its own
integration decision before it can enter a future candidate.

| Increment | First independently testable change | Exit evidence required |
| --- | --- | --- |
| Native frontend seam | Expose typed edit intents and read-only state on the control thread. Start with one mixer command and one history command. See the [UI command map](UI_COMMAND_MAP.md). | Stable selection IDs, typed validation errors, command parity with Win32 handlers, replayable state notification tests. |
| Automation | Persist only volume and pan lanes in a proposed successor to v4. Keep the existing prepared automation renderer as the test reference. | V1–v4 dry defaults, Save As and failed-write recovery, bounds and malformed data checks, undo/redo, playback/export sample comparisons. |
| Instruments | Prepare an immutable built-in instrument configuration and test a bounded voice scheduler against existing offline voices. | Identical seeded output across block sizes, deterministic voice exhaustion, seek/loop/reset behavior, measured CPU and memory budgets. |
| Routing | Prepare and validate a small offline stereo graph from existing sources, faders and master stages. | Dry-output parity, bounded fan-in and memory, cycle and bad-port rejection, deterministic graph order and failed replacement tests. |
| Plugin hosting | Review SDK revisions and test a host adapter against a small owned fixture in isolation. | Legal/notice review, scanner isolation, crash and timeout containment, state bounds, documented real-time limits. |

## Automation

V4 stores the manual fader settings. The current prepared automation lane is a
bounded list of combined volume and pan points per track that is supplied to
the engine in memory. Propose one persistent lane per stable track ID and
parameter ID. Initial IDs are `volume` and `pan`, with the existing parameter
ranges. Use strictly increasing absolute 48 kHz Session frames and a verified
cap no greater than the existing 128 points per track for the first slice.
Reject duplicate targets, missing tracks, out-of-range values and frames.
An absent or disabled lane uses the manual value. Start with hold and linear
interpolation. Define exact endpoints, pre-first and post-last values, loop
wrap and seeks in golden-sample fixtures before enabling editing.

Treat lane edits as a single undoable transaction. Prepare snapshots outside
audio work, retain the last valid snapshot on failure, and specify gesture
coalescing in the command layer. First build a read-only lane view, then enable
point creation and editing after persistence and rendering parity pass.
When editing a migrated copy, preserve the old file and require Save As.

## Instruments

Keep the existing `BuiltinVoice` render reference. Prepare oscillator and
envelope parameters and define reset, release, drain and seek semantics outside
the device backend. Schedule deterministic note events by Session frame, then
note-off before note-on, then stable track and event order. Preallocate a
bounded voice pool. Specify the eviction order for equal-priority voices and
test it at capacity. Render against the same scheduler in playback and export.
Add instrument parameter commands only after block-size and lifecycle parity.
External MIDI timing and controller acceptance remain separate experiments.

## Routing

Use typed node and port IDs. Audio ports declare channel shape. Event and
control ports use distinct types. Start with explicit stereo connections.
Validate IDs, endpoint uniqueness, compatible shape, fan-in, size limits, and
reachability of the master. Reject self edges and all cycles first. Define an
explicit future feedback representation only after stability and gain safety
can be demonstrated. Use stable topological ordering with a stable ID as a
tie-breaker. Buses, sends, returns and sidechains become separate typed nodes
or ports as they are added.

Compile a prepared graph and allocate scratch buffers on the control side.
Use bounded buffers and commit replacement at a defined block boundary.
Reclaim old graph resources on the control side after acknowledgement.
Retain the active graph if preparation, validation or installation fails.
Compare dry playback/export and verify invalid graph edits preserve the old
graph and history. Sonoravell's Visual Console Graph can project this model
once the routing contract has passed those gates.

## Plugin hosting decision

Evaluate CLAP first with owned test fixtures for its C ABI and lifecycle
extensions. The [CLAP SDK license](https://github.com/free-audio/clap/blob/main/LICENSE)
is MIT. [Steinberg's VST 3 SDK licensing documentation](https://steinbergmedia.github.io/vst3_dev_portal/pages/VST%2B3%2Blicensing/Index.html)
states that SDK 3.8 and newer use MIT terms and describes trademark rules
separately. Pin exact revisions and audit notices, dependency components and
trademark terms before importing either SDK. Keep both SDKs and plugin
execution outside the alpha candidate.

Introduce an adapter for stable plug-in, bus, parameter, and state identities.
Scan candidates in a separate process with time and memory limits, an explicit
trust decision, and quarantine on crash or timeout. Validate opaque state
size and preserve rollback data. Prepare and reset on the documented threads,
cache reported delay and tails, and verify that the audio path meets the
engine's bounded-work constraints. A scanner process alone does not isolate a
plugin that later runs in the host. Prove runtime failure containment in a
separate increment before enabling user-supplied binaries.

## Integration decisions

Review one branch and one risk at a time. Require deterministic regressions,
platform CI, relevant sanitizer results, and crash recovery when serialization
or workers change. Keep numerical timing budgets tied to measured Windows
machines. Preserve the alpha candidate and acceptance report while post-alpha
changes are under review. Hardware still gates recording count-in, latency
compensation, live monitoring and production multitrack capture.
