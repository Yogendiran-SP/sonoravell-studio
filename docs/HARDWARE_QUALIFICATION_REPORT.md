# Sonoravell Studio hardware qualification report

Copy this file for each run and link the raw evidence. Start all verdicts at
**Pending**. Only enter values observed for this configuration.

| Field | Value |
| --- | --- |
| Date, operator, Git commit, and Windows build | |
| Interface model, input endpoint ID, driver, and driver version | |
| Output endpoint ID, driver, and driver version | |
| Same-device or split-device arrangement | |
| Connection type, attenuation, monitoring state, and input channel | |
| Requested and negotiated input format and channels | |
| Requested and negotiated output format and channels | |
| Input/output requested and selected periods and allocated buffers | |
| Fixture version, Session tick/frame, start order, and duration | |
| CPU workload, storage workload, and free space | |
| Number of Start/Stop repeats and settled thread/handle observations | |
| First/last capture positions, QPC, and rejected timestamps | |
| First/last render positions, QPC, and rejected timestamps | |
| Qualified QPC start offset and relative clock drift | |
| Returned displacement range, signal drift, and detector settings | |
| Match scores, peak support, missing/duplicate/shifted marker IDs | |
| Clock-referenced signal residual, if the paired evidence qualified | |
| Independently calibrated end-to-end round-trip delay and method | Unmeasured |
| Render indicators, audible dropouts, and capture discontinuities | |
| Verified frames, end marker, recovered prefix, and reopen outcome | |
| Source Session evidence, journal, sidecar, and analysis report links | |
| Test limitations, calibration uncertainty, and deviations | |

| Gate | Evidence and verdict |
| --- | --- |
| Correct selected routing and negotiated formats | Pending |
| Fixture returns, timing evidence, and repeatability | Pending |
| Output loss preserves healthy capture | Pending |
| Input loss stops playback and preserves the verified prefix | Pending |
| Reconnection and fresh attempts | Pending |
| CPU/storage stress and cleanup | Pending |
| Forced termination and original/recovered Session reopen | Pending |
| WinMM and autosave compatibility | Pending |
| Latency/variation budget for the intended workflow, with justification | Pending |
| Physical qualification | Pending |

Record a separate go/no-go decision and supporting data for latency
compensation, monitoring and multitrack recording. Keep the experimental
configuration opt-in while qualification is pending.
