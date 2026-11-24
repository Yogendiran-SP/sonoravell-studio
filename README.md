# Sonoravell Studio

Sonoravell Studio is a native desktop DAW in development under the [MIT License](LICENSE).
The Windows application opens the four-track **After Hours** demo from the original
Sonoravell prototype. It can also start an empty Session and work offline.

## Run on Windows

Download **Sonoravell-Studio-Windows** from a successful Native DAW checks run on
GitHub Actions, extract it, and open `SonoravellStudio.exe`.

| Workspace | What you can do |
| --- | --- |
| Transport | Record from the selected Windows input, play, stop, change tempo, and undo the last edit. Stop finalizes a disk-backed take as a new audio track. |
| Arrange | See bars, MIDI notes, audio clips, and the playback cursor. Click the ruler to start playback from a beat, or click a track lane to select it. |
| Inspector | Add, update, or delete MIDI notes. Set beat, duration, and pitch in the Inspector. Move the first audio clip or remove the selected track. |
| Browser | Import a PCM WAV, create an instrument track, or place an existing Audio Pool source on another track. |
| Mixer | Set the selected track's level and mute or unmute it during playback. |
| Focus | Expand Arrange and keep transport and file controls visible. |

**Save as** writes a `.sonora` Session with embedded audio, MIDI, tempo, and track
controls. **Open** restores it. **Export** writes 48 kHz, 16-bit stereo WAV. Import
supports mono and stereo 16-bit PCM WAV at 44.1 or 48 kHz. Use **Restore Session checkpoint…** in command search to restore an idle autosave with embedded audio. The native Session
format has its own version and extension. Older browser project files require
a separate migration path.

Use Ctrl+F to focus **Find a command**, type a term, and press Enter to see matching
commands. It also provides separate panel toggles and **Reset workspace**. Ctrl+O
opens a Session, Ctrl+Shift+S opens Save As, and Ctrl+Z undoes the last edit.

## Build and test

Use CMake 3.20 or later and a C++20 toolchain. On Windows, use Visual Studio with
Desktop development with C++ installed.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

Use **Devices** to select the WinMM input and output for the app run. For the opt-in playback preview, choose **Playback: WASAPI shared**, then **Choose WASAPI output** to select an active output or follow the Windows default. Choose **System period** or request a custom period. Find the output identity and stream result under **Last WASAPI playback diagnostics**. Switch back to **Playback: WinMM** to use the fallback. [WASAPI scope and physical test procedure](docs/WASAPI_PREVIEW.md)

For the capture preview, choose **Devices → Recording: WASAPI shared → Choose WASAPI input**. Start with **System buffer** and a 48 kHz Windows input. **Last WASAPI capture diagnostics** shows the format, stream outcome and verified journal frames. [Capture workflow and physical verification](docs/WASAPI_CAPTURE.md)

The Windows CI build also checks the native workspace commands. Linux and macOS
CI build and test the shared mixer, Session storage, and audio import code.

### Headless render and timing

Run `sonoravell-render "After Hours.wav"` for the demo or
`sonoravell-render input.sonora mix.wav` to export a saved Session.
`sonoravell-render --benchmark` measures mixer processing at 32, 64, and 128
frames, excluding device I/O and track preparation.

## Roadmap status

This build covers the initial editable local Session slice from the roadmap.
Recording currently creates one mono take from the selected Windows input at
a time and stops playback first. A committed Session uses staged file
replacement. **Browser → Recover take…** restores committed audio after an
interruption. See [recording recovery](docs/RECORDING_RECOVERY.md). The G0 real-device latency/dropout benchmark and the
G1 multitrack capture, external MIDI, hardware recovery validation, and configurable
workspace acceptance tests remain open.
