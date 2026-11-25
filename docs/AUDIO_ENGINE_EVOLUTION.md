# Audio engine evolution

The engine starts from the native v3 Session, immutable embedded PCM, and
the independent WinMM/WASAPI streams at PR #22. Two workstreams continue.
Workstream A follows [physical qualification](HARDWARE_QUALIFICATION.md).
Workstream B delivers the offline production workflow with scripted and
portable acceptance before any hardware-dependent defaults change.

## Live mixer parameters

MIX-01, ENG-01, PRJ-04. The control thread validates a Session edit, commits
it to undo history, and publishes all effective track channel gains plus
the master level. Three fixed slots provide one private producer slot,
one private consumer slot and one exchange slot. A lock-free unsigned
atomic transfers ownership and indicates an unread update. The render
worker uses the latest complete state at the next submitted buffer, without
allocation, locks or waiting. Rapid commits may coalesce. History retains
every committed UI edit and persists the last values in the existing v3
format. Device interfaces and recording journals stay independent.

Source preparation is independent of mixer values. The mixer interpolates
effective gains for 240 frames at 48 kHz. A change midway through a ramp
begins from the running value. Output already queued at the endpoint is
unaffected. Fresh playback and offline export start at the settled gains.
Multiplying after dry float accumulation may change rounding for older
non-unity mixes. The channel balance, mute precedence, sum and clip rules
are the same. Structural edits settle playback before snapshot replacement.

Acceptance covers first and settled samples, in-flight retargeting, stereo
balance and master composition, undo/redo with the same prepared Windows
snapshot, and a concurrent publisher/reader that verifies every observed
snapshot is coherent and forward-moving. Endpoint timing and audible
acceptance remain part of the hardware protocol. Rolling back this increment
retains v3 Session and journal compatibility.

## Offline Desktop Alpha exit checklist

- Complete Create → Import WAV → Compose MIDI → Record → Arrange → Edit →
  Mix → Save → Reopen → Export on a supported Windows test machine with
  networking unavailable. Compare the reopened mix and WAV.
- Under ordinary Start/Stop, interrupted capture, failed save and recovery,
  preserve the original named Session and recover the verified take prefix.
- Run the keyboard-only workflow, check focus order and transport visibility
  in each layout, and record usability issues in the tracker.
- Record worst-case block time and prepared-buffer memory for defined sparse
  and dense fixtures. Record qualified endpoint periods and dropouts
  separately through Workstream A. Document supported project limits.
- Attach green Windows, macOS and Linux CI, known limitations, and the
  Windows rollback build. Keep compensation, monitoring, and production
  multitrack recording gated on Workstream A.
