# Windows audio backend decision

**Scope** — GOV-04, ENG-01, ENG-04 and HW-01. Risks R01, R50, R51 and R53.

The existing WinMM playback and recording paths remain the default. The
first migration extracts endpoint discovery and selection from the GUI and
passes a resolved device to input or output. The default mapper stays
available. Explicit choices live in memory, are resolved again before a
stream opens, and are rejected if missing or ambiguous. This avoids saving
a transient WinMM index into a Session. Windows can still change a device
between enumeration and stream open, so stream errors remain visible.

## Options

| Backend | Decision | Reason |
| --- | --- | --- |
| Windows waveform audio | Keep as fallback | Existing 48 kHz PCM path and take journaling. Device selection can ship separately from a low-latency engine. |
| Event-driven WASAPI shared mode | Opt-in render preview | The Windows default endpoint supports system-period negotiation and custom period requests when the 48 kHz client format is supported. See the [implementation and acceptance gate](WASAPI_PREVIEW.md). |
| WASAPI exclusive mode | Evaluate after shared-mode tests | Allows exclusive endpoint access, which changes interoperability. Require evidence that a specific workflow needs it. |
| ASIO | Leave out of the MIT distribution pending license review | Steinberg's SDK provides GPLv3 and proprietary alternatives. The repository has no approved redistribution route for a proprietary SDK or a GPLv3 combined distribution. |

Sources: [Microsoft WASAPI overview](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi),
[Microsoft shared and exclusive streams](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams),
[Steinberg ASIO SDK terms](https://github.com/audiosdk/asio/blob/main/LICENSE.txt).

## Interface boundary and next acceptance

The shared-render contract separates buffer and stream lifecycle from the WASAPI adapter. Endpoint enumeration for WASAPI and device notifications remain follow-up work. Keep the session mixer and journal behind a
bounded audio handoff. Prototype independent capture and render clocks with
explicit discontinuity counters before adding mixed-rate full duplex. Record
requested vs negotiated formats and periods, underruns, discontinuities,
reconnection behavior, and measured loopback latency. Device selection CI
checks the default mapper path and native workspace composition without
opening physical audio. Reconnect, channels, variable sample rates, buffer
selection, ASIO and full-duplex acceptance remain open.

For the physical endpoint check, select **Devices → Choose output** and
choose the built-in headphones, then play the demo. Select the default
microphone or AudioBox under **Choose input**, record a short take, stop,
save and reopen. Unplug the explicitly selected interface before opening the
next stream and verify that the error is visible and the project stays
readable. Reopen **Devices** after reconnecting. Record the driver and device
names, OS build, and any audible gaps. No latency claim follows from this test.
