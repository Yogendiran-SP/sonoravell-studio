# Native UI command and state map

The [command registry](ui_commands.json) maps the existing Win32 entry points
to stable proposed intents. A future native frontend can bind controls by
intent ID and observe state independently of window handles, screen
coordinates, captions or Figma component names. The IDs and notifications in
this document are a proposed contract. The current alpha uses Win32 handlers,
local refresh, worker state and status messages.

| Feature | UI state to expose | Parameter model | State notifications |
| --- | --- | --- | --- |
| Session, import, export, recovery | Dirty, checkpoint pending, selected asset, file request, recording finalization | Local path, stable asset ID, Session metadata | SessionChanged, RecordingStateChanged, CommandCompleted, ErrorRaised |
| Arrangement and tracks | Selected track or clip, editable, zoom/grid, transient cursor and loop selection | Stable track/clip IDs, musical ticks, source frames, graph order | SelectionChanged, SessionChanged, TransportChanged |
| MIDI and built-in instruments | Selected note, creation and keyboard focus | Track ID, note selector scoped to project revision, tick, duration, pitch, velocity | SelectionChanged, SessionChanged, HistoryChanged |
| Mixer and inserts | Editable target, mute/solo, bypass/enabled, current meter readout | Stable track/insert IDs, master target, volume/pan, validated insert parameter ID/value | SessionChanged, MixerMeterChanged, HistoryChanged |
| Transport and recording | Stopped, starting, playing, paused, capture active, finalizing, failed | Session frame cursor, loop range, recording backend and attempt ID | TransportChanged, RecordingStateChanged, ErrorRaised |
| Device selection and diagnostics | WinMM or WASAPI, default/selected/missing endpoint, last attempt report | Backend, direction, device selection, requested buffer, negotiated report | AudioDeviceChanged, RecordingStateChanged, CommandCompleted, ErrorRaised |
| Workspace and commands | Active preset, focus, panel visibility, named layout, search, transport visibility | Local workspace preference values | WorkspaceChanged, SelectionChanged |
| Undo and redo | Availability, current project revision | No input for one-step undo or redo | HistoryChanged, SessionChanged |

## Request and result

The control thread owns the command dispatcher. A typed request pairs an
intent ID with validated parameters, the applicable project revision, and
stable entity IDs when they exist. Mapped Win32 constants stay in the adapter.
A result reports applied, cancelled or rejected plus machine-readable reason.
Revalidate selection, bounds and current recording state at dispatch time,
even if the presented control is already disabled. A rejected edit leaves
the project and history unchanged. Treat file selection and overwrite
confirmation as the frontend's modal interaction. Submit the selected path to
the controller. Journal finalization and worker exit are asynchronous.

Use the project's exact tick/frame conversions. Arrangement uses 960 ticks per beat. Transport frames are stereo
48 kHz frames. Clip source offsets are in source frames. Loop endpoints form a
half-open range. The Session envelope owns persistent parameters. Mixer and
insert units come from the domain descriptors. Confine ephemeral selection,
viewport, loop controls, metronome and workspace preferences to the appropriate
view or transport state. Scope note selection to a track and revision until
the project model has a durable note identity.

## State snapshots and notifications

Publish a read-only view snapshot on the control thread. Include the Session
revision and monotonic UI sequence in notifications. Coalesce meter and
position updates. Include direction and attempt IDs for stream failures,
completion and diagnostics. Discard stale worker events by attempt ID.
Display recovery only after journal closure. File dialogs, report display and
device enumeration run outside the render and capture processing path.

Views can disable unavailable intents or present typed reasons. Keep Stop,
recording status and the active/device-failure indication reachable across
layouts. Project mutations enter history once. Layout switches remain local
and emit workspace changes. Preserve the backend's live mixer parameter
handoff instead of sending frontend notifications to audio workers. Transport
or DSP mutations use the engine's existing command/lifetime constraints.

## Source boundaries

- `native/windows.cpp` owns present transport, menu commands, workspace,
  edit dispatch, and GUI-thread worker completion.
- `native/windows_inserts.cpp` presents insert edit operations.
  `native/inserts.hpp` defines the validated model.
- `native/edit_history.cpp` owns project edit history.
- `native/project.hpp`, `native/mixer_parameters.hpp`, and
  `native/playback_position.hpp` define core ownership and units.
- `native/duplex_transport.hpp` coordinates stream attempts. The proposed
  view model reports outcomes without taking ownership of worker resources.
