# Recoverable Windows takes

**Scope** — REC-01, PRJ-03, SE-05, SE-06 and SE-07. This increment addresses
R04 (lost takes) and R05 (project damage). It retains the native C++20 app,
default mono Windows input and the existing version-1 `.sonora` format.
It adds no dependencies and runs offline.

## Architecture review

The old input handed WinMM one buffer for the whole take and converted it
on Stop. The new input uses 12 prepared 20 ms buffers. WinMM signals an event.
A capture worker copies complete blocks to a bounded single-producer,
single-consumer queue; another worker owns disk writes and flushes. Buffer
ownership changes only after the device returns each header. The audio
notification does no application allocation, disk I/O, or network work.
The GUI requests Stop asynchronously and adds a track after the writer
closes. The existing playback backend remains in place.

The local take format has a versioned signature, checksummed beat position,
and length-prefixed PCM blocks with checksums. The writer flushes each
completed block (normally 200 ms) and records a separate end marker.
The reader uses the valid contiguous prefix and reports an incomplete take.
Driver/queue/storage failures stop capture and leave committed audio in
place. Data in the driver, queue, current write, or incomplete final block
can still be lost. A stalled storage device can delay Stop. This is neither
a promise of power-loss durability on every filesystem nor hardware timing
or dropout evidence. The staged `.sonora` save path remains separate.

## Recover a take

Open the intended Session, then choose **Browser → Recover take…** or find
the command by name. Select a `.sntake` file from the local recovery folder.
The app restores the verified samples onto a new track at the take's
original beat. An uninterrupted Stop uses this same decoder. A recovered
take is a new edit and needs **Save As** to become part of the Session.
Journals remain in `%LOCALAPPDATA%\Sonoravell Studio\Recovery` across
normal and abnormal exits. This increment leaves cleanup manual so a
failed save, undo or change of Session never prunes a take. Reimporting the
same journal creates another track.

## Definition of done and test evidence

- An immediate process exit after a committed block leaves those samples
  recoverable with no end marker. Tested by the `take_check` subprocess.
- Truncation, checksum corruption and a POSIX file-size-limit write failure
  leave the preceding audio intact. No failed write reports finalization.
- Recovery saves/reopens with embedded audio. Existing `project_check`
  checks safe replacement and unsupported project versions.
- The queue test verifies saturation, FIFO ordering and a producer/consumer
  handoff. The Windows workspace smoke check remains required before merge.
- Physical acceptance remains open. With the built-in microphone first,
  record a 10-second phrase into an empty Session at beat two, press Stop,
  save/reopen and listen. Then record for at least five seconds and use
  Task Manager **End task** during capture. Reopen the same saved Session,
  select **Recover take…**, choose the newest take, and check its prefix,
  beat placement, and successful save/reopen. Repeat with the AudioBox if
  available. Log the device, build and audible gaps. Software fault tests
  do not substitute for this procedure.

## Remaining risk and next increment

Add revisioned local Session autosave separate from the named file, then
verify restore without changing and without overwriting the named project.
A recording journal preserves samples and the start beat, while unsaved
Session edits still need snapshot recovery. Full duplex, interface selection
and measured dropouts remain gated behind device-layer work.
