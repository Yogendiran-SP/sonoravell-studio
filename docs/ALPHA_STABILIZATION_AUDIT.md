# Offline Desktop Alpha stabilization audit

**Scope anchor:** [PR #36 / 201dc12](https://github.com/Yogendiran-SP/sonoravell-studio/commit/201dc128895769874486f81dc3dd5349127df5f3).
**Decision:** build an acceptance candidate, with the frozen runtime scope
and focused data-integrity and installation fixes. Keep the source anchor
and prior Windows artifact available for rollback.

## Baseline evidence

| PR | Audited increment | Successful native CI run |
| --- | --- | --- |
| #31 | v4 master insert persistence and effect processing | [45611456310](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45611456310) |
| #32 | Track inserts and native editor | [45612155166](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45612155166) |
| #33 | Arrangement navigation and piano editing | [45612838011](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45612838011) |
| #34 | Frame-aligned loop regions | [45613340181](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45613340181) |
| #35 | Alpha workflow, load fixture and initial acceptance checklist | [45613946532](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45613946532) |
| #36 | Internal fader curves and built-in voices | [45614472691](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45614472691) |

## Risk review and disposition

| Area | Evidence reviewed | Candidate disposition |
| --- | --- | --- |
| WAV export and existing file ownership | The baseline opened destinations directly. A stream failure could truncate an earlier export, and export could replace a named Session. | Release blocker addressed by sibling staging, format checks, and byte-preservation regressions. |
| Save, migration, autosave | Session codec, replace/flush path, rotating checkpoint code, v1–v4 fixtures, and forced-replacement fault cases. | The old writer accepted foreign and malformed current targets. Reject those inputs and preserve originals. Physical power-cut and separate-process writes remain outside the automated evidence. |
| Capture and recovery | Windows input workers, bounded queue, synchronized journal records, checksummed prefixes, duplex attempt coordination, and interrupted-writer tests. | Existing ownership and formats retained. Candidate device, storage and termination trials remain open. |
| Undo and inserts | Bounded command history, immutable PCM, document validation, persisted IDs, configured delay caps, pre-fader track chains, and master chain order. | Corresponding round-trip, undo/redo, bypass and block-size fixtures stay in CI. |
| Transport and processor lifecycle | Cold prepare on play/resume/seek, loop seam continuity, per-worker rack ownership, shared mixer snapshots, and finite offline exports. | Keep the existing behavior. Device timing, audible seams, and repeated hardware attempts need evidence. |
| Resource bounds | Source tiles, event/asset caps, insert/delay caps, CTest regressions and fixed software load fixture. | Collect Windows working set, CPU time, handle counts, timing and underruns on actual devices. |
| Native access and workspace state | Window accelerators, built-in keyboard editing, workspace preset/restore code and workspace smoke. | Guided keyboard-only and accessibility walkthrough stays pending. |
| Install and offline operation | PR #36 Windows executable imports MSVCP140, the atomic-wait runtime and VCRUNTIME140 libraries. Candidate staging, extracts, and tests binaries with static MSVC runtime. | Establish a source-identified ZIP and package smoke. Clean target-machine offline launch is a manual gate. |
| Automation and instruments | Fader compiler, frame interpolation and bounded source voice interfaces plus deterministic tests. | Keep engine-only foundations in the frozen candidate. Persistent automation, live instrument scheduling, graph/host work and Figma design remain separate. |

The [candidate guide](ALPHA_CANDIDATE.md) records installation,
compatibility and rollback. Sign-off remains pending in the
[alpha acceptance report](ALPHA_ACCEPTANCE_REPORT.md) and
[hardware status](ALPHA_HARDWARE_REPORT.md). Automated CI establishes
software evidence for its recorded commit.
