# Offline Desktop Alpha hardware qualification status

**Verdict: Pending.** Record actual run evidence in a copy of the
[hardware report template](HARDWARE_QUALIFICATION_REPORT.md).

| Configuration or gate | Candidate evidence | Verdict |
| --- | --- | --- |
| Built-in device, WinMM output and mono capture | Candidate physical trial pending | Pending |
| Independent WASAPI playback and capture | Candidate endpoints, routing and measurements pending | Pending |
| AudioBox same-interface WASAPI duplex | Candidate driver and wired loopback trial pending | Pending |
| Split-device duplex and restart after endpoint loss | Candidate physical trials pending | Pending |
| Forced termination, storage stress, last verified take prefix | Scripted and file-level fixtures exercised; candidate device trials pending | Pending |
| Device periods, calibrated latency, discontinuities and dropout rate | Unmeasured | Pending |

Use the [hardware qualification protocol](HARDWARE_QUALIFICATION.md) for
setup, safe levels, repetitions and measurements. Attach device and driver
identity, negotiated formats and periods, endpoint-loss results, clock and
loopback evidence, CPU/storage load, and the recovered Session outcome.
Keep private media local or use a non-sensitive signal for a reproduction.

Keep automatic latency compensation, recording count-in, live monitoring,
and production multitrack capture gated on measured acceptance.
