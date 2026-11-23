# Engineering principles and release discipline

Status: **proposed engineering policy**, 23 Nov 2026. Based on Roger S. Pressman, *Software Engineering: A Practitioner's Approach*, 5th ed. (2001): incremental and spiral processes (Ch. 2), risk planning (Ch. 6), quality (Ch. 8), configuration control (Ch. 9), requirements engineering (Ch. 10), modular design (Chs. 13-14), user-centered interface design (Ch. 15), testing (Chs. 17-18), and reengineering (Ch. 30). Implementation details below are project-specific adaptations, not quoted textbook requirements.

## Start from the actual baseline

Verified on main at `87bfa526dbc544127a1b70a3276a2b532fede2cf`:
- C++20 engine, Win32 UI, default Windows waveOut audio at fixed 48 kHz / 16-bit stereo, two approximately 20 ms buffers;
- four pre-rendered `After Hours` tracks, Play/Stop, live mute ramps and WAV export;
- regression tests for deterministic score/mix/mutes/buffer ordering/WAV; native build/CTest CI across three operating systems;
- MIT license.

Not demonstrated yet: professional low-latency audio callbacks with measured device latency/xruns, audio recording, general editable/savable session, Audio Pool import, MIDI input/Piano Roll, plugin host, arbitrary-user project recovery, mobile/cloud/collaboration/Live Show.

A successful CI run does not prove physical audio-interface reliability. The `--benchmark` command measures software mixing **without device I/O**.

## Non-negotiable architecture constraints

1. **Native desktop first.** Extend the existing C++20 codebase; do not replace the desktop runtime with a web application.
2. **Local-first.** Recording, session editing, exporting and Live Show critical paths do not depend on login, cloud or internet.
3. **RT thread discipline.** No disk/network access, blocking locks, allocations, GUI waits or unbounded work in an audio callback. Preallocate, use bounded queues and measure worst-case callback times and xruns.
4. **Separation of concerns.** Distinct audio/MIDI engine, device backends, project/Audio Pool store, validated command/undo layer, native UI, and optional cloud/collaboration services. One project model for all views.
5. **Data integrity before new features.** Version session schemas, atomically save, preserve source audio, maintain autosave/recovery and test interrupted writes.
6. **Evidence for every claim.** Label capability statuses: verified source + tests, partial prototype, or planned. Hardware support requires hardware evidence.
7. **License control.** Audit third-party code/assets, plugin SDKs and manufacturer APIs against the MIT core; keep license records and SBOM.
8. **Small, reversible changes.** PRs refer to requirements, tests, risks, and rollback; update architecture decision records for broad decisions.
9. **UI invariants.** Beginner/Pro panels and MD/performer layout changes never change audio state or hide essential safety controls.
10. **Risk-driven increments.** Each iteration ends with a running vertical slice, evidence, feedback and a proceed/revise/stop decision.

## Change checklist

A change is ready to merge only when:
- [ ] A requirement ID, user workflow and offline/online behavior are identified
- [ ] Dependencies and an explicit non-goal are documented
- [ ] User-facing behavior has an acceptance test
- [ ] New audio work is bounded, measurable, and RT-safe where applicable
- [ ] CI runs and real hardware tests are attached when hardware support is claimed
- [ ] Save/recovery tests pass when project/media serialization changes
- [ ] Licensing, permissions and privacy are reviewed if changed
- [ ] A rollback or compatible migration path exists
- [ ] Documentation and demonstrated-vs-planned status are updated

## First finite product goal

A usable **offline desktop DAW**: install, configure an audio device, create a project, import/edit/record local audio, use basic MIDI, save/reopen and recover a project, mix and export. The huge six-DAW portfolio, mobile, cloud, AI, visual console graph and collaborative Live Show remain tracked future modules rather than prerequisites for this first release.

**Release block:** any reproducible lost recording/project data, unsupported audio callback claims, missing device evidence, unresolved high-severity bugs or license violations.
