# Windows audio backend decision

**Scope** — GOV-04, ENG-01, ENG-04, HW-01 and REC-01. Risks R01, R04, R05, R14, R50, R51 and R53.

The existing WinMM playback and recording paths remain the default. The
WinMM migration extracts endpoint discovery and selection from the GUI and
passes a resolved device to input or output. The default mapper stays
available. Explicit choices live in memory, are resolved again before a
stream opens, and are rejected if missing or ambiguous. This avoids saving
a transient WinMM index into a Session. Windows can still change a device
between enumeration and stream open, so stream errors remain visible.

## Options

| Backend | Decision | Reason |
| --- | --- | --- |
| Windows waveform audio | Keep as fallback | Existing 48 kHz PCM path and take journaling. Device selection can ship separately from a low-latency engine. |
| Event-driven WASAPI shared mode | Independent, opt-in render and capture previews | Each stream resolves its own Windows endpoint and negotiates its own period. Capture feeds the existing take journal. See the [render](WASAPI_PREVIEW.md) and [capture](WASAPI_CAPTURE.md) acceptance gates. |
| WASAPI exclusive mode | Evaluate after shared-mode tests | Allows exclusive endpoint access, which changes interoperability. Require evidence that a specific workflow needs it. |
| ASIO | Leave out of the MIT distribution pending license review | Steinberg's SDK provides GPLv3 and proprietary alternatives. The repository has no approved redistribution route for a proprietary SDK or a GPLv3 combined distribution. |

Sources: [Microsoft WASAPI overview](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi),
[Microsoft shared and exclusive streams](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams),
[Steinberg ASIO SDK terms](https://github.com/audiosdk/asio/blob/main/LICENSE.txt).

## Interface boundary and next acceptance

The shared-render contract separates buffer and stream lifecycle from the
WASAPI adapter. The native picker discovers active render endpoints outside
the playback worker. Its app-local choice is copied into a stream request and
resolved before playback. The adapter owns COM and the packet lifecycle.
On invalidation it reports the error and closes the stream. Discovery refreshes
when the picker opens. Subscribing to device notifications is deferred until a
workflow requires live inventory updates. Both backends remain local and use
the existing Session audio model. See the [WASAPI verification procedure](WASAPI_PREVIEW.md).

For the WinMM physical endpoint check, select **Devices → Choose WinMM output** and
choose the built-in headphones, then play the demo. Select the default
microphone or AudioBox under **Choose WinMM input**, record a short take, stop,
save and reopen. Unplug the explicitly selected interface before opening the
next stream and verify that the error is visible and the project stays
readable. Reopen **Devices** after reconnecting. Record the driver and device
names, OS build, and any audible gaps. No latency claim follows from this test.

## Full-duplex dependencies

The capture adapter owns a single input stream, feeds the bounded journal
handoff and records correlated capture clock anchors. The Session transport
still stops playback before recording. First qualify the input and output
previews separately with physical endpoint loss and recording recovery.

Then prototype correlation of the independent capture and render clocks
against QPC, including reset, missing timestamps, start offset and relative
drift. Define a transport timeline and an alignment error budget based on
measured loopback behavior. Validate both streams under scheduling and
storage pressure, with bounded queues, explicit dropout/overrun reporting,
and recovery of the last checksummed audio prefix if either endpoint fails.
Monitoring, rate correction and synchronized operation depend on that evidence.
