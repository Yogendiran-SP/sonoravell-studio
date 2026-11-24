# Windows audio backend decision

**Scope** — GOV-04, ENG-01, ENG-04 and HW-01. Risks R01, R50, R51 and R53.

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
| Event-driven WASAPI shared mode | Opt-in render preview | The user can choose an explicit output or the Windows multimedia default. The stream negotiates the period against the resolved endpoint. See the [implementation and acceptance gate](WASAPI_PREVIEW.md). |
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
microphone or AudioBox under **Choose input**, record a short take, stop,
save and reopen. Unplug the explicitly selected interface before opening the
next stream and verify that the error is visible and the project stays
readable. Reopen **Devices** after reconnecting. Record the driver and device
names, OS build, and any audible gaps. No latency claim follows from this test.

## Next increment — capture-only WASAPI shared mode

Reuse the endpoint ID model with capture-direction discovery. Keep an
independent event-driven capture adapter, with event waits outside packet
handling. Start with a single mono take and explicitly supported input
formats. Preallocate the conversion and handoff buffers, pair each successful
packet acquisition with its release, and pass ordered blocks to the existing
bounded queue and checksummed journal writer. Keep WinMM input available.

Track three separate conditions. A packet flagged silent contributes its
reported frame count as zeros. A data discontinuity or invalidation ends the
take with a visible reason and a recoverable contiguous prefix. A timestamp
error marks timing evidence unreliable. Capture and render endpoints can
have different clock offsets and drift even at the same nominal rate. Retain
input device frame positions and correlated QPC timestamps for analysis. Test
offset, monotonicity, missing timestamps and injected drift before proposing
alignment or rate correction for full duplex.

The capture increment passes its automated gate when scripted packets reach
the journal in order, one release follows each acquired packet, and device
loss, queue saturation, disk-write failure and process termination recover
exactly the verified prefix without silently inserting samples. The previously
saved `.sonora` must reopen and the user must be able to recover the take into
a Session. Physical acceptance repeats record, Stop, reconnect and forced
termination with a Windows microphone or AudioBox and records the format and
diagnostics. Full-duplex and calibrated loopback measurements have separate gates.

[Microsoft capture packet API](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)
and [buffer flags](https://learn.microsoft.com/windows/win32/api/audioclient/ne-audioclient-_audclnt_bufferflags).
