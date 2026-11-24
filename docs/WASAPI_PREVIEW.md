# WASAPI shared playback preview

## Architecture and risk review

The endpoint-selection increment builds on [PR #11 at 33544f9](https://github.com/Yogendiran-SP/sonoravell-studio/pull/11), whose [Windows, Linux and macOS CI](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45410755371) passed. PR #11 introduced the shared-render lifecycle contract, event-driven default-output playback and stream diagnostics.
[PR #8](https://github.com/Yogendiran-SP/sonoravell-studio/pull/8) separated capture
and disk writing with a bounded FIFO and checksummed take records.
[PR #9](https://github.com/Yogendiran-SP/sonoravell-studio/pull/9) alternates
staged Session checkpoints outside the named file.
[PR #10](https://github.com/Yogendiran-SP/sonoravell-studio/pull/10) resolves
selected WinMM devices against the current inventory. All three CI runs passed.
The existing mixer already delivers interleaved 48 kHz stereo PCM and accepts
live mutes. That makes the render endpoint the smallest independent change.
Keeping capture on the existing journaled path avoids coupling changes to
playback timing with recording integrity.

Requirements **ENG-01, ENG-04, HW-01, SE-05/06/09**. Risks **R01, R04, R50,
R51, R53**. This increment keeps WinMM as the launch default, changes no
Session format, and adds only Windows SDK interfaces. It adds explicit render
endpoint selection to the existing preview. Capture, full duplex, exclusive
mode, ASIO and device latency qualification are later increments. Roll back
by selecting WinMM or reverting this increment.

## Output selection and device changes

- **Devices → Choose WASAPI output** lists the active Windows render endpoints
  each time it opens. Friendly names are labels. Entries with the same name
  get distinct labels, and selection follows the exact opaque Windows endpoint ID.
- **Windows default** resolves the multimedia default each time Play is pressed.
  An explicit selection resolves its ID again before every stream opens. The
  setting lasts for the app run and stays out of `.sonora` and autosave data.
- Changing the app's selection stops the current stream. Press **Play** to
  start on the new selection. Changing the Windows default leaves an open
  stream on its original endpoint unless Windows invalidates that stream.
- If an explicit endpoint disappears, the picker shows it as unavailable.
  Play fails visibly while the ID is unavailable. After reconnection, press
  Play to retry the same ID or reopen the picker to make a new choice if
  Windows assigned a new ID. Diagnostics report the requested and resolved
  output, endpoint ID, lifecycle stage and Windows error when available.

## Negotiation and lifecycle

- **System period** probes exact support for the 48 kHz stereo 16-bit client
  PCM. If the format needs conversion, WASAPI is asked to convert it to the
  reported Windows mix format. Initialization is authoritative and can still
  reject the stream.
- **256, 512, 1024 frames** request a custom period. This path requires exact
  client-format support and `IAudioClient3`. The request is rounded to a
  supported fundamental multiple and clamped to the driver-reported range.
  A rejected or locked period fails visibly. Use **System period** or
  **WinMM** to retry. The report includes requested and selected period,
  mix format, conversion request, and the actual allocated buffer size.
- A worker owns COM and the endpoint. It primes the buffer, starts playback,
  waits on device and stop events, refills using padding, and drains the
  final partial packet before closing. Device calls and PCM mixing in the loop
  use the endpoint buffer, the existing mixer and atomic mute state. The loop
  avoids app allocations, disk, network, GUI waits and blocking app locks.
- A missing buffer event times out after two seconds. Invalidation or a
  failed operation terminates the attempt with a stage, reason, and Windows
  status when available. **Play** opens a fresh stream for the current choice. The app
  never automatically replays on a different backend or device after a failure.
- A zero-padding event while source audio remains increments a **suspected**
  underrun counter. Normal final drain does not increment it. Timeouts and
  invalidations are separate counters. These are render-side observations.
  There is no capture discontinuity or physical latency measurement.

Sources: [Microsoft shared-mode initialization](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize),
[Microsoft render packets](https://learn.microsoft.com/windows/win32/coreaudio/rendering-a-stream),
[Microsoft IAudioClient3](https://learn.microsoft.com/windows/win32/api/audioclient/nn-audioclient-iaudioclient3),
[Microsoft endpoint IDs](https://learn.microsoft.com/windows/win32/coreaudio/endpoint-id-strings).

## Verification and release gate

`shared_render_check` uses a scripted endpoint to exercise period bounds,
unsupported format/period, unavailable device, start/stop, terminal buffer
drain, timeout and packet contract. The endpoint fixtures cover duplicate
names, list reordering, default changes, invalidation, a failed retry while an
endpoint is absent, and a successful retry when that exact ID returns with a
different label. The Windows workspace test exercises selection and backend
switching and checks that the Session is unaffected. Existing project,
autosave, take recovery, and mixer tests are required. CI compiles and packages
the Windows adapter. Real discovery, audible routing and driver behavior
require physical Windows hardware.

On a physical Windows machine:

1. Set the Windows default output to the built-in headphones. Play, mute and
   stop the demo in **WinMM**, then choose **Devices → Playback: WASAPI shared**
   and play again with **System period**. Confirm the final note finishes and
   Stop is responsive during playback.
2. Select the headphones explicitly under **Choose WASAPI output**. Change
   the Windows default to another output while playback is running. Verify
   the explicit stream stays on the selected output, then Stop and Play again.
   Select **Windows default** in the app and verify that the next Play follows
   the new Windows default. Open **Last WASAPI playback diagnostics** after
   each attempt. Record the OS build, requested and resolved output, endpoint ID,
   endpoint, Windows mix format, buffer frames, empty-buffer events, timeouts
   and invalidations. Try a custom request and record the selected frames or
   the rejection. Compare at 44.1 and 48 kHz where the endpoint supports both.
3. Explicitly select a detachable output such as the AudioBox and unplug it
   during playback. Check that playback ends visibly, and that no automatic
   replay starts. Reopen the picker, confirm the selection is unavailable, and
   try Play while it is disconnected. Confirm the attempt fails on that ID.
   Reconnect and press Play on the original selection. If Windows assigned
   a different ID, choose the newly listed device and press Play. Switch back
   to WinMM and verify the saved Session and input recording.
4. A calibrated loopback test under load must establish latency and dropout
   evidence before changing the launch default or making performance claims.
