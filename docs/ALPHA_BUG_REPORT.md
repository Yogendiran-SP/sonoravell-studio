# Offline Desktop Alpha bug report

- **Summary and impact** — crash, hang, wrong audio, lost data, or workflow issue.
- **Candidate** — copy BUILD-INFO.txt or the full version and commit from
  **Commands → About this build**. Include the candidate ZIP hash.
- **Environment** — Windows edition/build, CPU, RAM, free disk space, and
  workspace preset. PowerShell **Get-ComputerInfo** reports the system version.
- **Audio configuration** — WinMM or WASAPI, independent or duplex,
  input/output device and driver, period/buffer, and negotiated format.
- **Reproduction** — short exact steps, Session version, input type, effects,
  transport state, and count of successes/failures. Include expected and
  observed behavior.
- **Diagnostics** — record the status message, Devices diagnostics, and
  relevant Windows Application log event. For duplex, include available
  clock and analysis output. For performance, note buffer settings and
  before/after process working set and CPU time.
- **Data safety** — retain the original Session, WAV, recovery checkpoint,
  and take journal. Record SHA-256 hashes, whether reopening worked, and
  how much of a take recovered. Reproduce using copies.
- **Attachments** — provide a minimal synthetic Session or audio sample
  when possible. Review logs and paths before sharing. Share recordings,
  device identifiers, crash dumps, or private project files only when
  needed and appropriate for the audience.
