# Experimental WASAPI duplex transport

## Scope and risk review

This increment starts at `a4e4b5868e8f506b7bae66fe5bc6ea5abf376a72` after
[clock evidence](https://github.com/Yogendiran-SP/sonoravell-studio/pull/14) and
[recording-first coordination](https://github.com/Yogendiran-SP/sonoravell-studio/pull/15).
It addresses ENG-01, ENG-04, REC-01, and risks R01, R04, R05, R14, R50, and
R51. The baseline render worker borrowed a cached Session and the independent
recording path stopped playback. It tracked capture and writer completion
separately, but the GUI consumed them as one result. Simultaneous operation
risks invalidating the borrowed audio, stopping a healthy input after output
loss, releasing a take before journal closure, and mixing clock anchors from
different attempts. The new adapter implements recording-first cleanup and
uses one immutable audio snapshot, one notice mailbox, and one journal per
attempt. The feature runs offline and uses the existing MIT code and Windows
SDK. Revert the increment or use independent Play and Record to roll back.

## Use and outcome

1. Select **Playback: WASAPI shared** and **Recording: WASAPI shared** in
   **Devices**. Choose input and output independently and start with the
   system periods. Independent **Play** and **Record** remain available, and
   WinMM is the launch default.
2. Set the start beat in the Inspector. Choose **Devices → Record with playback
   (experimental)**. The selected beat is the explicit Session position for
   both playback and take placement. Each endpoint opens independently.
   Playback uses only the prepared Session mix. Live input monitoring is off.
3. Press **Stop** to signal both workers. The control thread waits for their
   exit notices and the writer's closure before offering the take and a new
   attempt. The take is added as an edit. Use **Save As** to write a Session.
   **Recover take…** can read the journal after a crash. The adapter never
   updates the previously named Session as part of recovery.

| Interruption | Behavior |
| --- | --- |
| Output open failure, disconnect, or end of playback | Capture continues until Stop, input/storage failure, or the recording limit. |
| Input invalidation, packet discontinuity, or queue saturation | Stop output and drain the accepted prefix into the interrupted journal. No fabricated replacement audio is added. |
| Storage write failure | Stop both endpoints and offer the last verified journal prefix. |
| Stop during startup or running | Signal both endpoints. The writer flushes accepted audio and finalizes a successful journal after input exit. |
| Reconnect | Choose the endpoint as needed and start a fresh attempt after cleanup. Selection never silently switches to another endpoint. |

Workers publish readiness, errors, endpoint exit, and journal closure into
fixed-size atomic notices. No worker calls the GUI or waits on the policy.
The control timer applies the coordinator's Stop requests and joins exited
workers before reading their reports. The control thread owns the formatting,
recovery read, and Session edit. A blocked driver or storage operation can
delay completion. The next attempt waits for cleanup.

**Last experimental duplex diagnostics…** reports the endpoint names and IDs,
failure causes, verified frames, Session tick, and first and last qualified
device-position/QPC anchors with timestamp fault counters. The start offset
and relative drift appear only when the [clock evidence](WASAPI_CLOCKS.md)
qualifies. These estimates are separate from round-trip latency. The adapter
does not use them for placement, rate correction, or monitoring.

## Automated and physical acceptance

`duplex_transport_check` runs real C++ render and capture threads through
scripted shared endpoints, ordered readiness, the production notice mailbox,
and the take queue. It covers either start order, concurrent packets,
different clock rates, Stop during startup and running, input/output loss,
writer-fault notifications, saturation, stale attempts, delayed writer
closure, and journal/Session reopen. `take_check` covers checksummed recovery
and interrupted writes. Existing independent transport, Session/autosave,
and Windows workspace checks remain required. The scripted devices and CI
do not verify real hardware behavior.

### Windows hardware checklist

1. Save an original `.sonora` with periodic transients. Test built-in playback
   with headphones and built-in microphone first. Record a ten-second attempt
   and inspect both endpoint reports and the resulting clip. Repeat with both
   endpoints on the PreSonus AudioBox. Record the Windows build, driver,
   endpoint IDs, formats, and negotiated buffers for both sets.
2. With monitoring kept off, use a safe, attenuated line-level wired loopback
   on equipment that exposes a line output and input. Capture known transients
   at the start and periodically during a longer run. Log qualified start
   offset and relative drift. Measure round-trip latency from the returned
   transients independently and log audible gaps, render underrun indicators,
   and capture faults. Repeat at system and supported custom periods.
3. Use split endpoints so one endpoint can be disconnected independently.
   Unplug output during a take, confirm capture continues, then Stop. Repeat
   with input loss and verify output stops and the accepted prefix is offered.
   Reconnect and explicitly retry after cleanup. Check Stop during startup.
4. Force-close a separate attempt after several seconds, reopen the original
   `.sonora`, and recover the `.sntake`. Save the recovered Session to a
   separate path and reopen both files. Repeat independent Play/Record in
   WinMM and verify autosave recovery after the transport settles.

Hardware synchronization, latency, dropouts, and professional qualification
remain open physical gates. The transport is experimental and opt-in.
