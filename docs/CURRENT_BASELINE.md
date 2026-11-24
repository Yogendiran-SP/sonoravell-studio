# Current native-development baseline

Audit date: 2026-11-24. The coordination increment starts at `66a95be28a1621d23099b8ac2f1e02d4b7bff69c`, the merge of [PR #14](https://github.com/Yogendiran-SP/sonoravell-studio/pull/14) for WASAPI clock evidence. Its [Windows, macOS and Linux checks](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45425130199) passed. Earlier evidence includes [take recovery](https://github.com/Yogendiran-SP/sonoravell-studio/pull/8), [Session checkpoints](https://github.com/Yogendiran-SP/sonoravell-studio/pull/9), [WinMM selection](https://github.com/Yogendiran-SP/sonoravell-studio/pull/10), [WASAPI render selection](https://github.com/Yogendiran-SP/sonoravell-studio/pull/12) and [journaled WASAPI capture](https://github.com/Yogendiran-SP/sonoravell-studio/pull/13).

## Implemented in repository source

- C++20 Win32 native desktop app, CMake build, Linux/macOS core-library tests, and Windows packaged executable.
- Editable local `Project` with tracks, MIDI notes, audio clips, basic tempo/volume/mute and an in-memory Audio Pool.
- `.sonora` versioned local Session save/reopen; stereo embedded audio; staged file replacement; rejection of incompatible/corrupt project versions.
- PCM WAV import (16-bit mono/stereo, 44.1/48 kHz), simple resampling, placement of clips and use of the Audio Pool.
- Single mono recording from the selected Windows input, finalized on Stop. The recording worker writes recoverable blocks to a local take journal. **Recover take…** restores the verified prefix when input or storage is interrupted.
- Local Session autosave rotates two staged checkpoints per working Session. Restore opens a copy with its embedded audio.
- Edit MIDI note pitch/beat/duration, delete, undo last edit, click ruler to locate playback, focus/Inspector/Browser/Mixer workspace toggles and command search.
- Opt-in event-driven WASAPI shared-mode render for an explicitly selected output or the Windows multimedia default, with period requests and endpoint and stream diagnostics. A lost output stops the attempt and can be reopened on an explicit Play. WinMM remains the launch default.
- Opt-in [WASAPI shared capture](WASAPI_CAPTURE.md) for a single mono take from a supported 48 kHz Windows input. Live packet checks, a bounded handoff and the existing journal preserve the accepted prefix on interruption. Capture and render choose endpoints and periods independently.
- Independent [WASAPI clock diagnostics](WASAPI_CLOCKS.md) record capture and render position/QPC anchors. The paired clock model is exercised with simulated streams.
- A [recording-first duplex state machine](WASAPI_COORDINATION.md) is exercised in software and awaits transport integration and hardware qualification.
- Live track mute ramps, offline stereo WAV export, CLI saved-project render.
- Automated session and project checks; `workspace_check` on Windows; Actions CI.

Sources: README.md, `native/project.{hpp,cpp}`, `native/session.{hpp,cpp}`, `native/windows.cpp`, `native/windows_audio.hpp`, `native/windows_wasapi.cpp`, `native/windows_wasapi_capture.cpp`, `native/audio_endpoints.hpp`, and the `tests` directory.

## Limitations still open

- `waveOut` and `waveIn` expose session-local endpoint selection and retain the Windows default mapper. Recording stops playback, so simultaneous full-duplex monitoring or multitrack capture is not yet supported.
- WASAPI render selection lasts for the app run. The picker refreshes on open, and Play looks up the chosen endpoint again. Physical routing, device loss and reconnection remain open acceptance tests.
- Recording has a bounded queue and a duration cap. A crash can lose uncommitted samples. Clock anchors are best-effort companion diagnostics saved when a WASAPI take finishes. Real driver timing, device loss, and recorded audio remain open acceptance tests.
- Current project limits are development caps: 16 tracks, 128 bars, 64 assets and fixed 48 kHz stereo internal sample representation; not a proof of scalable/unlimited DAW operation.
- Only basic in-app MIDI note editing; no verified physical MIDI controller capture.
- No demonstrated VST3/CLAP host, channel selection, latency measurement/xruns, professional hardware compatibility, full undo history, or portable legacy browser-project converter.
- Cloud, mobile, AI/MCP, distributed editing, Follow Session and Live Show remain future work.
- Automated CI success is not evidence of tested external interfaces or measured end-to-end hardware latency.

## Immediate risk-driven priority order

1. **Recovery validation:** verify the [take journal](RECORDING_RECOVERY.md) with real Windows input and stress the autosave path on larger Sessions. The portable storage tests cover interrupted writes and independent checkpoints.
2. **Device abstraction and real-time telemetry:** validate WASAPI render and capture selection, restart and recovery on real Windows inputs. The [backend decision](AUDIO_BACKEND_DECISION.md) records clock, loopback and data-safety dependencies for full duplex.
3. **Project persistence and regression:** comprehensive session schema migration tests, undo/redo history, autosaves, reload of large sessions, failed-save atomicity, and clip relinking when external assets arrive.
4. **Recording/editing vertical slice:** selectable input/output, simultaneous playback + capture, basic clip trim/move/split, track arming and MIDI device input.
5. **Release gates:** G0 verified hardware callback evidence, G1 recoverable sessions/recordings, G2 usable offline production workflow before any cloud/live dependence.

## Source of engineering principles

Roger S. Pressman, *Software Engineering: A Practitioner's Approach*, 5th edition (2001). Applicable sections: incremental/spiral process (Ch. 2), project and risk management (Chs. 5-7), quality/configuration (Chs. 8-9), requirements (Chs. 10-11), architecture/UX (Chs. 13-15), verification and validation (Chs. 17-18), reengineering (Ch. 30).
