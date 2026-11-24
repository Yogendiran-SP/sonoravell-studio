# WASAPI shared playback preview

## Architecture and risk review

Base: [main at 5d33165](https://github.com/Yogendiran-SP/sonoravell-studio/commit/5d331658c64aec946ee93af28fa5d62878f41a49).
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
Session format, and adds only Windows SDK interfaces. It targets default
endpoint playback. Capture, arbitrary WASAPI endpoint selection, full
duplex, exclusive mode, ASIO and device latency qualification are later
increments. Roll back by selecting WinMM or reverting this increment.

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
  status when available. **Play** opens a fresh default endpoint. The app
  never automatically replays on a different backend or device after a failure.
- A zero-padding event while source audio remains increments a **suspected**
  underrun counter. Normal final drain does not increment it. Timeouts and
  invalidations are separate counters. These are render-side observations.
  There is no capture discontinuity or physical latency measurement.

Sources: [Microsoft shared-mode initialization](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize),
[Microsoft render packets](https://learn.microsoft.com/windows/win32/coreaudio/rendering-a-stream),
[Microsoft IAudioClient3](https://learn.microsoft.com/windows/win32/api/audioclient/nn-audioclient-iaudioclient3).

## Verification and release gate

`shared_render_check` uses a scripted endpoint to exercise period bounds,
unsupported format/period, unavailable device, start/stop, terminal buffer
drain, timeout, invalidation, packet contract, and explicit retry.
The Windows workspace test verifies backend switching leaves the Session
unchanged. Existing project, autosave, take recovery, and mixer tests are
required. CI compiles and packages the Windows adapter; the scripted
endpoint cannot establish the actual driver contract or an audible result.

On a physical Windows machine:

1. Set the Windows default output to the built-in headphones. Play, mute and
   stop the demo in **WinMM**, then choose **Devices → Playback: WASAPI shared**
   and play again with **System period**. Confirm the final note finishes and
   Stop is responsive during playback.
2. Open **Devices → Last WASAPI playback diagnostics**. Record the OS build,
   endpoint, Windows mix format, buffer frames, empty-buffer events, timeouts
   and invalidations. Try a custom request and record the selected frames or
   the rejection. Compare at 44.1 and 48 kHz where the endpoint supports both.
3. With a detachable output such as the AudioBox, unplug during playback.
   Check that playback ends visibly, and that no automatic replay starts.
   Reconnect, verify the default output in Windows, and explicitly press Play.
   Switch back to WinMM and verify the saved Session and input recording.
4. A calibrated loopback test under load must establish latency and dropout
   evidence before changing the launch default or making performance claims.
