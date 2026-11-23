# Current native-development baseline

Audit date: 2026-11-23. Main commit: `03a9016516a9378d7349d175996d9adc0c75cac0` (merged PR #6). This snapshot replaces the outdated PR #4 / fixed-demo-only baseline.

## Implemented in repository source

- C++20 Win32 native desktop app, CMake build, Linux/macOS core-library tests, and Windows packaged executable.
- Editable local `Project` with tracks, MIDI notes, audio clips, basic tempo/volume/mute and an in-memory Audio Pool.
- `.sonora` versioned local Session save/reopen; stereo embedded audio; staged file replacement; rejection of incompatible/corrupt project versions.
- PCM WAV import (16-bit mono/stereo, 44.1/48 kHz), simple resampling, placement of clips and use of the Audio Pool.
- Single mono recording from the default Windows input, finalized on Stop. **Recording is held in memory until manual Save**; power failure or crash can lose an unsaved take.
- Edit MIDI note pitch/beat/duration, delete, undo last edit, click ruler to locate playback, focus/Inspector/Browser/Mixer workspace toggles and command search.
- Live track mute ramps, offline stereo WAV export, CLI saved-project render.
- Automated session and project checks; `workspace_check` on Windows; Actions CI.

Sources: README.md, `native/project.{hpp,cpp}`, `native/session.{hpp,cpp}`, `native/windows.{cpp,_audio.hpp}`, `tests/{session_check,project_check}.cpp` at the inspected commit.

## Limitations still open

- `waveOut` and `waveIn` default Windows-device APIs are used. Recording stops playback, so simultaneous full-duplex monitoring or multitrack capture is not yet supported.
- Capture uses a fixed memory buffer with a built-in duration cap, not a tested crash-safe streaming take file or professional low-latency callback.
- Current project limits are development caps: 16 tracks, 128 bars, 64 assets and fixed 48 kHz stereo internal sample representation; not a proof of scalable/unlimited DAW operation.
- Only basic in-app MIDI note editing; no verified physical MIDI controller capture.
- No demonstrated VST3/CLAP host, device selection, latency measurement/xruns, professional hardware compatibility, post-crash autosave recovery, full undo history, or portable legacy browser-project converter.
- Cloud, mobile, AI/MCP, distributed editing, Follow Session and Live Show remain future work.
- Automated CI success is not evidence of tested external interfaces or measured end-to-end hardware latency.

## Immediate risk-driven priority order

1. **Recording durability:** spool microphone capture to a recoverable on-disk take, flush safely, handle unexpected termination, make the take recoverable on reopen. Test forced termination and disk-full cases.
2. **Device abstraction and real-time telemetry:** isolate `waveOut/waveIn` behind backend interfaces, prototype WASAPI/ASIO with documented licensing, measure callback deadline misses and xruns on physical hardware. Keep existing Windows Audio playback as fallback.
3. **Project persistence and regression:** comprehensive session schema migration tests, undo/redo history, autosaves, reload of large sessions, failed-save atomicity, and clip relinking when external assets arrive.
4. **Recording/editing vertical slice:** selectable input/output, simultaneous playback + capture, basic clip trim/move/split, track arming and MIDI device input.
5. **Release gates:** G0 verified hardware callback evidence, G1 recoverable sessions/recordings, G2 usable offline production workflow before any cloud/live dependence.

## Source of engineering principles

Roger S. Pressman, *Software Engineering: A Practitioner's Approach*, 5th edition (2001). Applicable sections: incremental/spiral process (Ch. 2), project and risk management (Chs. 5-7), quality/configuration (Chs. 8-9), requirements (Chs. 10-11), architecture/UX (Chs. 13-15), verification and validation (Chs. 17-18), reengineering (Ch. 30).
