# Offline Desktop Alpha candidate notes

**0.1.0-alpha-candidate · Acceptance pending**

- Create a local Session, import or recover audio, compose in Piano Roll,
  arrange clips, mix, save, reopen, and export stereo PCM WAV.
- Apply gain, parametric EQ, compression, and delay on master or track
  chains. Bypass fades live. Changing the chain or parameters settles
  playback so the next attempt begins with prepared processor state.
- The stabilization build stages WAV output before replacement and checks
  destination formats. Failed outputs preserve the previous file. Save As
  protects unreadable, incompatible, and legacy files.
- The Windows ZIP records source identity and checksums. About this build
  displays the candidate version and source commit.

## Known limits

- The project uses 48 kHz stereo source processing. Capture supports one
  mono take at a time. Experimental WASAPI duplex remains opt-in.
- Resume locates from the last reported frame. Seek and resume start with
  fresh processor state. Looping retains state. Export ends at the Session
  boundary.
- A bus supports four built-in inserts. A project supports twelve total
  and eight seconds of configured delay. Project track, event, source, and
  preparation caps also apply.
- Automation editing and live instrument scheduling are post-alpha work.
  Physical timing, keyboard/accessibility, and live recording acceptance
  stay open.
- The candidate writes v4. A previous v1–v3 application uses its
  corresponding original Session. See the [rollback guide](ALPHA_CANDIDATE.md).
