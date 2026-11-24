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
| Event-driven WASAPI shared mode | Independent previews and opt-in experimental duplex | Each stream resolves its own Windows endpoint and negotiates its own period. Capture feeds the existing journal under the [recording-first transport](WASAPI_DUPLEX.md). |
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

The capture adapter owns a single input stream and feeds the bounded journal
handoff. Independent Record stops playback. The explicit experimental action
joins the [recording-first lifecycle policy](WASAPI_COORDINATION.md) to both
workers and uses a prepared journal to protect the take.

The [clock model](WASAPI_CLOCKS.md) collects independent anchors and tests
start offset, drift, and bad timestamp handling using simulated pairs. The
experimental take keeps its selected Session tick and reports qualified
clock estimates separately. Establish an alignment error budget from physical
loopback measurements. Validate both streams under scheduling and
storage pressure, with bounded queues, explicit dropout/overrun reporting,
and recovery of the last checksummed audio prefix if either endpoint fails.
Monitoring, rate correction and synchronized operation depend on that evidence.
Use the [offline reference and hardware qualification protocol](HARDWARE_QUALIFICATION.md)
for measured returned-signal evidence and configuration-specific acceptance.
