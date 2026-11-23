# Sonoravell Studio

Sonoravell Studio is a native desktop DAW in development under the [MIT License](LICENSE).
The first Windows build plays the four-track **After Hours** demo from Sonoravell Studio
1.0.2 and exports the active mix to stereo WAV. It uses a Win32 window and the Windows
default audio output. The demo keeps the original score and tempo, with native
synthesis and a basic stereo mix.

## Run the Windows build

Download **Sonoravell-Studio-Windows** from a successful Native DAW checks run on the
repository's Actions page. Extract it and open `SonoravellStudio.exe`. Use **Play**
and **Stop**. Track mutes also work during playback and are applied to WAV exports. The WAV export is 48 kHz,
16-bit stereo.

## Build and test

Use CMake 3.20 or later and a C++20 toolchain. On Windows, use Visual Studio with
Desktop development with C++ installed.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

The Windows build produces the desktop GUI. Linux and macOS CI build and test the
shared render engine.

## Headless render and timing

Run `sonoravell-render "After Hours.wav"` to export the demo without the GUI.
`sonoravell-render --benchmark` measures the C++ mixer at 32, 64, and 128 frames.
It reports the 95th percentile, worst observed buffer mix time, and buffer duration.
Hardware I/O and track preparation are outside the measurement.

## Roadmap status

This is a native rendering and playback milestone. It prepares the individual
tracks once, then mixes short buffers for Windows waveform audio output. Mute
changes reach the next available buffer and use a short gain ramp. The G0 real-time callback
benchmark, physical interface tests, recording, editing, project import and
saving are open. The v1.0.2 source remains available in the repository history
for porting project formats and production workflows.
