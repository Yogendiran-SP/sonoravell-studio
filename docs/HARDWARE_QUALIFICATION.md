# WASAPI hardware qualification

Scope ENG-01, ENG-04, HW-01 and REC-01. [PR #16 at bd9a77a](https://github.com/Yogendiran-SP/sonoravell-studio/pull/16)
established the opt-in transport. Its [native CI](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45439010829)
used scripted endpoints. The audit found separate endpoint and writer
completion, immutable playback ownership, and atomic attempt notices. A
blocked driver or writer can delay cleanup. Physical routing, stream timing,
clock correlation and recovery under faults still require evidence.

The offline executable adds no work to the audio threads. It uses the same
PCM WAV, Session, and checksummed take readers as the app. Independent
WASAPI, WinMM, Session autosave, and journal recovery remain available.
Rollback consists of reverting the qualification tool or omitting it from a
build. Session and journal formats are compatible with earlier builds.

## Generate and analyze

From a Windows package or CMake build, run the following in PowerShell 7.
On Windows PowerShell 5.1, pipe the JSON to `Set-Content -Encoding UTF8 run-01.json`
if the report needs UTF-8 output.

~~~powershell
.\sonoravell-qualify.exe generate .\qualification-reference
.\sonoravell-qualify.exe analyze "<full path to capture.sntake>"
.\sonoravell-qualify.exe analyze "<full path to capture.sntake>" --json > run-01.json
~~~

The generated directory contains `reference.wav` and `reference.sonora`.
The v1 fixture has eight distinct 48 kHz transient markers in a quiet bed and
a quiet capture tail in the Session. Open the unmodified reference Session
with its track at unity and the start beat set to one. Use **Devices → Record
with playback (experimental)** after selecting both WASAPI shared backends.
Let the final marker return before Stop. Preserve the actual `.sntake` from
`%LOCALAPPDATA%\Sonoravell Studio\Recovery`. The analyzer also accepts an
unresampled, capture-only PCM16 48 kHz WAV and reads its first channel. A
Session mix includes the source and can produce false matches.

The analyzer matches each expected code within its search window and reports
missing markers, separate duplicate matches, fitted-trend shifts, edge peaks,
and rail samples. Negative displacement can occur when capture starts after
playback. A regular displacement trend is reported as signal drift, and an
isolated shift or ambiguous event invalidates the summary. The default
search radius is two seconds and the default detrended shift flag is 96
frames. Use `--search-ms` and `--shift-frames` to record a deliberate alternative.
Keep the same settings for comparable runs. A marker outside the search
window is reported missing, and echoes closer than one marker length can
share a peak. Local near-peak intervals and normalized scores describe match
support. They carry no statistical coverage guarantee for physical latency.
The detector settings are software analysis bounds. Hardware acceptance
budgets must come from observed runs and the recording workflow.

Exit code 0 means a complete analyzable marker set. Code 3 means invalid
timing or an unfinished take, with the available evidence still reported.
Codes 1 and 2 indicate processing and usage errors. A finalized journal
and a clean match are evidence for one attempted configuration.

## Timing domains

| Quantity | Evidence |
| --- | --- |
| Session placement | The selected start tick and playback frame. The v1 comparison expects frame zero. |
| Render position and QPC | Qualified `IAudioClock` position units per second and first/last local QPC anchors. |
| Capture position and QPC | First accepted device frame, qualified packet anchors, and returned journal frame zero. |
| Relative clock drift | Capture/render normalized rate ratios over qualified overlap. |
| Signal displacement and drift | Matched returned frames relative to reference frames, observed spread, and fitted residual. |
| Clock-referenced signal delay | An optional projected residual from **both** matched returns and qualified paired clocks. It depends on the model and capture origin. |
| Calibrated round trip | An independently calibrated common-time measurement of the stimulus and return through the intended path. The per-run report leaves it unmeasured. |
| Dropouts and discontinuities | Record render indicators, capture packet faults, missing/shifted markers, and audible results separately. A clean marker set cannot rule out a gap between markers. |

The optional comparison reads the versioned `.duplex-clock.tsv` sibling of a
finalized journal. It requires the same frame count and PCM fingerprint, and a zero playback
origin. Archive the journal and its sidecar together. After a settled,
finalized duplex attempt with no endpoint or storage error and qualified
clock overlap, the control thread writes the sidecar beside the journal.
Independent, interrupted, or unqualified attempts can still be analyzed for
returned markers. A failed evidence write leaves the take available. The
duplex diagnostics also show both buffer configurations and render underrun
indicators. Clock-origin differences alone provide no analog round-trip
measurement. Capture remains unmodified throughout analysis.

## Windows runs and acceptance gates

Start with monitoring off and headphones where applicable. Use safe,
attenuated line-level connections only on hardware with a suitable line out
and line in, keep gains low while making the connection, and follow the
interface manual. Skip wired loopback on an incompatible built-in jack.
Built-in acoustic trials include room and transducer delay and belong in a
separate row. Record unsupported custom periods and configurations explicitly.

| Configuration or scenario | Procedure and evidence required |
| --- | --- |
| Built-in input and output, system period | Confirm endpoint routing, complete Start/Stop, reopen the take, and capture clean diagnostics. Run an acoustic marker test only when the returned signal can be isolated safely. |
| AudioBox input and output, same-device WASAPI | Start with system periods, then supported custom periods. Run the v1 reference with a safe wired return. Preserve the endpoint IDs, negotiated periods, capture journal, and analysis. |
| Split input/output | Record each device independently, then run the combined reference and document the different clocks. Repeat with input and output unplugged separately. A healthy input must continue after output loss. Input loss must stop output and preserve the committed prefix. Reconnect and retry explicitly. |
| Normal and repeated Start/Stop | Stop once during startup and between complete runs. Check that retries wait for closure, produce one take per attempt, and carry no stale error or samples. Compare OS thread and handle counts after settled runs. One deliberately retained journal per attempt supports recovery. |
| CPU load and storage pressure | Repeat while running a documented local CPU workload and with the recovery directory on an isolated constrained test volume as appropriate. Record workload, space, buffer and duration. Check cleanup, the reportable failure reason, readable committed prefix, and no change to the prior named Session. |
| Forced termination | During a take, terminate the app, reopen the original Session, and recover the newest take. Save a separate Session and reopen both. Compare the recovered frame count and prefix, including any missing late markers. |
| WinMM and autosave regression | Repeat independent Play/Record through WinMM. Reopen the previous named Session and restore an autosave after settling the duplex transport. |

An accepted configuration needs recorded identity and routing, successful
repeats, explainable timing/marker results, and preservation of the prior
Session and journal prefix under the applicable faults. Define the workflow's
latency and variation budget from measured, repeated loopback runs before
qualifying a configuration. Mark every unperformed case pending. The current
recommendation is **no-go** for automatic latency compensation, live input
monitoring, and multitrack capture. Each needs physical timing and separate
safety and recording integrity evidence. [Reusable run report](HARDWARE_QUALIFICATION_REPORT.md)

The capture and render clock fields follow the Windows APIs documented for
[capture packets](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)
and [render position](https://learn.microsoft.com/windows/win32/api/audioclient/nf-audioclient-iaudioclock-getposition).
