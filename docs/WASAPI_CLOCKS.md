# WASAPI stream clock evidence

This increment starts at [PR #13](https://github.com/Yogendiran-SP/sonoravell-studio/pull/13)
on `be703798862ed5342f77c2aff09245edf40ddc28`. The [prior native checks](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45422458477)
passed on Windows, macOS, and Linux. The baseline uses independent workers,
a bounded capture queue and a checksummed journal. The capture device frame
and QPC anchors describe only one input. The playback cursor is derived from
submitted frames and endpoint padding, which supply no common time reference.
Treating those values as aligned risks silent take placement and duration
errors. Scope is ENG-01, ENG-04, REC-01, GOV-04, and the timing and recording
risks R01, R04, R14, R50, and R51. Roll back by reverting the increment.

## Clock domains

| Value | Source and use |
| --- | --- |
| Capture position | WASAPI capture packet frame position relative to the stream. Nominal units per second are the client rate. |
| Render position | `IAudioClock::GetPosition` in the units reported by `GetFrequency`. Buffer padding still drives the UI cursor. |
| Common reference | The performance counter on the local computer, in 100 ns units. Each worker samples local QPC to validate the age of the paired timestamp. |
| Session placement | An explicit Session start tick or frame from the transport. It remains separate from stream origins and from the host clock. |

Each worker retains two accepted position/QPC anchors and counters. Output
queries `IAudioClock` at most every 100 ms during normal monotonic polling.
Missing clock service or an inaccurate result affects diagnostics only.
Capture validates timestamps independently of packet continuity and hands
audio to the same writer. Collection does fixed-size integer work without
allocating or logging. Diagnostic formatting and floating-point estimates
run off the audio worker. Both independent previews expose their own evidence
after Stop in **Devices** diagnostics. WinMM, take journals, and `.sonora`
storage retain their existing operation. The entire runtime works offline.

Sources [capture packet API](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)
and [render clock API](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudioclock-getposition).

## Qualification and estimates

Missing samples, timestamps over two seconds old, repeated positions, and
future or nonmonotonic anchors do not advance the fit. A backwards observation
clock or regressing position on advancing time invalidates the run until the
stream is rebuilt. A coordinated start uses a fresh nonzero attempt ID for
both endpoints. Independent previews use zero, so their reports cannot be
paired. A pair requires fresh evidence with at least 100 ms of overlap and a
first anchor within two observed seconds of each stream's position origin.
Those are software evidence gates, not hardware timing tolerances.

The fit divides each device-position delta by its own nominal unit frequency
and by the QPC elapsed time. It then compares the two normalized rates in
parts per million. It estimates each stream's origin using its first anchor
and fitted rate. The start offset is capture origin time minus render origin
time. Neither estimate changes samples, monitoring, or Session placement.
Device clock correlation measures a different quantity from analog or
acoustic transit time.

## Software and physical gates

`stream_clock_check` simulates different nominal frequencies and independent
rates, both start orders, large counter values, invalid timestamps, reset,
stale evidence, missing overlap, and attempt isolation. Existing capture,
render, journal, Session and Windows workspace suites remain regression gates.
No simultaneous endpoints are opened by this increment.

1. On Windows, follow the [output](WASAPI_PREVIEW.md) and [input](WASAPI_CAPTURE.md)
   procedures independently, first on built-in audio and then on the AudioBox.
   Record device IDs, Windows build, format and buffer. Run each for at least
   ten seconds. Save the diagnostics and check the first and last device/QPC
   anchors progress, and that unplug/restart produces a fresh report.
2. Verify Stop, fallback to WinMM, and the [take recovery procedure](RECORDING_RECOVERY.md),
   including interrupted recording and save/reopen of both Sessions.
3. Before enabling simultaneous operation, test a wired line-level loopback
   into an input with live monitoring disabled. Use a known transient pattern
   at the start and throughout a long run. Log the two clock traces, compare
   estimated offset/drift with transient displacement, and separately report
   repeatable round-trip latency and dropouts. Include both start orders,
   same-interface and split-device runs, and minimum and default buffer cases.
4. On the simultaneous test build, unplug output then repeat with input loss.
   Repeat under load and storage/queue pressure. Check interruption reasons,
   the saved prior Session, the recovered prefix, and an explicit fresh Start.
