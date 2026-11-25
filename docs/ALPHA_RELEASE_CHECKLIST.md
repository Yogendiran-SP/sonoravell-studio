# Offline Desktop Alpha release checklist

The alpha scope is a local production from blank Session to exported WAV.
It includes the native editor, MIDI note composition, mono recording and
recovery, arranging, mixer controls, built-in inserts, and workspace
preferences. Keep volume/pan automation, a wider instrument interface,
third-party plugins, and online products in later milestones. Keep
automatic latency compensation, recording count-in, live monitoring and
production multitrack capture behind their physical gates.

## Candidate record

Record the commit and Windows artifact, Windows build and driver versions,
selected input/output and mode, attached CI run, any failed checks, the
tester, and the previous compatible Windows artifact. Use a copy of any
valuable Session. Workstream B covers the offline workflow below.
Workstream A records hardware results separately using the
[qualification protocol](HARDWARE_QUALIFICATION.md) and
[run template](HARDWARE_QUALIFICATION_REPORT.md).

| Check | Evidence to retain |
| --- | --- |
| Offline launch | With networking unavailable after installation, launch the native executable, create and open local Sessions, and export to local disk. |
| Produce a short song | Create a blank Session, import PCM WAV, add notes in Piano Roll, record a mono take, arrange and trim clips, move a clip between audio tracks, set the mix and add track and master inserts. Save, reopen and export before and after reopen. Compare WAV hashes for the same saved settings. |
| Transport and CPU load | Over at least 16 attempts, repeat Play/Stop, Pause/Resume, ruler seek and selected-loop playback with inserts active. Record early stops, dropouts, CPU time, process working set and any device-handle growth. Confirm repeated attempts settle and give control back. |
| Failure recovery | Check that a failed save leaves the previous named Session readable. Interrupt a new recording and recover its verified prefix; reopen the prior named Session and the new recovered Session independently. Validate power-cut behavior separately on appropriate test hardware. |
| Keyboard and workspace | Without a mouse, reach Play, Stop, Commands, the Inspector and insert controls. Change presets, resize and restore side panels, reopen a named layout, restart the app and check its last layout. Confirm that visibility changes preserve Session state and leave transport reachable. Record focus or screen-reader issues. |
| Supported load | Record the built-in large Session software benchmark, then repeat with a representative Session and the chosen device on Windows. Record prepared bytes, active delay bytes, p95/max processing time, buffer budget, peak working set, CPU time and underruns. |
| Compatibility and rollback | Open a preserved v1/v2/v3 fixture, save under a new v4 name and reopen it. Confirm the original remains byte-identical. Reopen the original with the previous app if rollback is needed. Keep v4 files for a v4-capable build. |

Run the portable test suite on Windows, macOS and Linux. The
`alpha_session_check` runs the local project, WAV import, MIDI, interrupted
journal, editing, mixing, repeated render starts, save/reopen, autosave and
WAV equivalence sequence without device I/O. The Windows workspace smoke
adds native control and project/view separation checks.

Run `sonoravell-render --benchmark-alpha` for the fixed 16-track, 32-bar
software fixture. It exercises the twelve-insert and eight-second total
delay caps. Use `sonoravell-render example.sonora --benchmark` for a specific
Session. The report includes preparation time, prepared track storage,
configured delay payload, and p95 and maximum block timings. It samples an
offline software path. Windows process CPU time and working set, physical
periods, audiobox measurements and device underruns belong in the run record.
A supported physical configuration must consistently finish processing in
its measured buffer interval and pass the recording and recovery checks.

Close the checklist only when the candidate has clean applicable CI,
repeatable workflow evidence and no unresolved data-loss or release-blocking
stability issue. Preserve unperformed rows as Open. Use the known limitations
and the documented compatible files for rollback.
