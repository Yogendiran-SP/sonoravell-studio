# Offline Desktop Alpha acceptance report

**Disposition: Pending.** Copy this report for each candidate and attach
evidence for each verdict. Record physical results in the
[hardware report](ALPHA_HARDWARE_REPORT.md).

| Candidate record | Evidence |
| --- | --- |
| Version, full source commit, tree, artifact URL, and ZIP SHA-256 | Enter from the candidate manifest and CI run |
| Windows build, CPU, memory, storage, audio mode, and tester/date | Pending |
| Rollback build and unmodified test Session | PR #36 201dc12 and a copy of the chosen fixture |
| Baseline automated tests | PR #36 run 45614472691: Windows 27/27, Linux and macOS 26/26 |
| Stabilized automated tests and extracted archive smoke | Attach candidate run/summary |
| Applicable ASan/UBSan and file fault-injection evidence | Attach configuration, results, and omissions |

| Acceptance gate | Initial verdict | Evidence to attach |
| --- | --- | --- |
| Clean Windows x64 launch with network disconnected | Pending | OS build, archive identity, startup, and any runtime or policy errors |
| Full create/import/compose/record/arrange/mix/save/reopen/export walkthrough | Pending | Fixture or local notes, observed results, before/after WAV hashes |
| Keyboard-only production and workspace restoration | Pending | Input sequence, focus failures, restart and restore outcome |
| Repeated Play/Stop, seek, and looping with inserts | Pending | Iteration counts, observed audio, CPU/memory and handles before/after |
| Save failure and interrupted take recovery | Pending | Failure trigger, original hashes, verified recovered audio, both reopen outcomes |
| V1–v4 compatibility and rollback | Pending | Fixture versions, new v4 filename, unchanged originals, rollback artifact |
| Supported large Session, latency, and dropout behavior | Pending | Measured buffer budget, timing, resource data, and hardware report |

Use the [release checklist](ALPHA_RELEASE_CHECKLIST.md) for procedure and
[bug template](ALPHA_BUG_REPORT.md) for failures. Acceptance requires actual
Windows evidence and resolution of any release blockers. Packaged CI checks
exercise software on a hosted runner. Keep hands-on cases open until run.
