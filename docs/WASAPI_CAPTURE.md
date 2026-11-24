# WASAPI shared capture preview

The capture increment starts from [PR #12 at 0ea7877](https://github.com/Yogendiran-SP/sonoravell-studio/pull/12).
Its [Windows, macOS and Linux checks](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45418445382)
passed. That baseline already had an independent shared render stream and a
WinMM input that wrote checksummed takes through a bounded queue. This
increment reuses the endpoint ID resolver and the journal writer. It adds a
separate capture worker with no shared render state.

Requirements **REC-01, ENG-01, ENG-04, HW-01, SE-05/06/07**. The highest
risks are audible gaps mistaken for valid takes (R01, R14), a blocked writer
or abrupt termination (R04), and altering a saved Session while recovering a
take (R05). The app keeps WinMM as the launch default. Roll back by choosing
**Recording: WinMM** or reverting the increment. The version-1 Session and
take formats are compatible in both cases.

## Record and diagnose

- Select **Devices → Recording: WASAPI shared**, then **Choose WASAPI input**.
  **Windows default** resolves the multimedia input at Record. An explicit
  choice resolves the opaque endpoint ID each time. A missing endpoint fails
  visibly. The selection and capture period are local to the app run.
- **System buffer** lets Windows select the shared event period. The 256,
  512 and 1024 frame requests use `IAudioClient3` and round and clamp to
  the supported periods. A rejected or locked period fails visibly and can
  be retried with **System buffer**. Diagnostics show the requested period,
  selected custom period and allocated buffer frames.
- The preview opens a 48 kHz mono or stereo shared mix format in PCM16 or
  float32, including corresponding extensible formats. Stereo channels are
  averaged to one mono take. Float output is clipped to PCM16. Unsupported
  rates, channel counts, encodings or buffers over 200 ms fail at open.
  An endpoint can often be configured in Windows Sound settings. WinMM
  remains a separate input choice.
- Record stops playback first. The worker waits on the Windows buffer or
  stop event, acquires each packet and pairs it with exactly one release.
  It converts into preallocated scratch space and publishes each accepted
  packet to the bounded queue in order. Allocation and COM setup precede
  Start. Journal writes and flushes run on the existing storage worker.
- **Stop** ends at the last packet the worker accepted and flushes the queue
  to the journal. Audio still in the Windows buffer can fall outside that
  boundary. The Session duration limit may shorten the final packet. A new
  **Record** opens a fresh stream and journal.

## Integrity and clock evidence

| Condition | Result |
| --- | --- |
| WASAPI silent flag | Queue the reported frames as zeros with their original frame positions. |
| Discontinuity flag, gap or overlapping device position | Reject the packet and stop at the prior verified prefix. A flag on the first packet at frame zero is recorded as a stream-start event because that packet has no predecessor. |
| Missing device frame position | Reject the packet and report the missing position. |
| Missing, error-flagged or non-increasing QPC timestamp | Count the unreliable timestamp and exclude it from timing estimates. Contiguous device frames can still be accepted. |
| Invalidation or failed buffer release | Stop; preserve the prior queued prefix. |
| Queue saturation | Reject the entire packet, including any part that would fit in the remaining slots. Flush the prior queue. |
| Disk write or sync failure | Stop and recover the checksummed journal prefix. The diagnostics distinguish storage failure from the stream result. |
| Process termination | Recover the prefix from the journal with no completion marker. Driver, queue, and uncommitted tail data can be lost. |

The capture diagnostics preserve the first and last accepted packet positions
and the first and last valid device frame / QPC pairs. QPC values are in
100 ns units. Their differences can estimate capture rate error relative to
48 kHz. **Last WASAPI capture diagnostics** shows the input, format, outcome,
failure stage, native status, queued and verified frames, and timing summary.
After the recorder finishes and reads the verified take, it also writes a
UTF-8 `.sntake.capture.txt` companion next to the journal. Saving this summary
is best effort. Forced process termination can leave recoverable audio
without a companion file. The summary contains anchors, rather than a trace
of every packet. Audio recovery reads the existing journal directly.

Capture and render position counters have independent origins. Their
endpoints can also run at different rates even with the same nominal sample
rate. A capture-only rate estimate carries no capture-to-playback alignment
evidence. Before full duplex, define a shared monotonic timeline, correlate
both streams against QPC, and measure start offset and long-run relative drift
in reference loopback tests. Validate sustained independent handoffs during
device loss and storage faults before enabling simultaneous streams. Drift
correction and synchronized monitoring require their own acceptance gates.

References [Microsoft packet lifecycle and QPC units](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer),
[buffer flags](https://learn.microsoft.com/windows/win32/api/audioclient/ne-audioclient-_audclnt_bufferflags),
[shared event initialization](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize),
and [custom shared periods](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudioclient3-initializesharedaudiostream).

## Acceptance gates

`shared_capture_check` scripts acquisition, release, Stop and retry and
exercises PCM conversion, clock offset and drift, missing timestamp and
position data, discontinuities, invalidation, and atomic queue saturation.
It imports an interrupted capture prefix and saves and reopens the recovered
Session alongside the original. `take_check` covers abrupt exit, torn records,
and injected storage failure on POSIX. The Windows workspace test covers
independent backend and input selection. Windows Actions builds and packages
the native adapter. Real audio input, reconnect, power-loss behavior and
physical timing require hardware.

1. In Windows Sound settings, enable the built-in microphone and choose a
   48 kHz input format. Save an empty Session. Select **Recording: WASAPI
   shared**, **Windows default**, and **System buffer**. Set the start to beat
   two. Record a spoken count with pauses for about ten seconds, press Stop,
   and inspect the take. Save a copy, reopen it, and verify the count order,
   pauses, and beat placement. Check the original Session still opens.
2. Open **Last WASAPI capture diagnostics**. Note the Windows build, endpoint
   name, negotiated format, buffer, terminal state, and verified frame count.
   Repeat with the microphone selected explicitly and a custom period. Log
   the accepted period or the reported rejection.
3. When the AudioBox is available, explicitly select it and start another
   take. Unplug after several seconds. Check for a visible failure and an
   audible prefix. While disconnected, retry Record and check the selected
   input reports unavailable. Reconnect and Record again. Select the new ID
   if Windows assigned one. Switch to WinMM and record a short fallback take.
4. From the saved Session, Record a separate take and use Task Manager
   **End task** after several seconds. Reopen the prior Session, select
   **Recover take…**, and choose the newest `.sntake` file. Verify the
   available prefix and beat placement. Save a copy and reopen it.
