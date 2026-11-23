#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>
#include <mmsystem.h>

#include "session.hpp"

#include <atomic>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <stop_token>
#include <thread>

namespace {
using namespace sonoravell;
constexpr int playId = 100, stopId = 101, exportId = 102, muteId = 200;
constexpr UINT_PTR playbackTimer = 1;

const DemoAudio& demoAudio() {
    static const DemoAudio demo;
    return demo;
}

class WaveStream {
    static constexpr std::size_t framesPerBuffer = sampleRate / 50;
    struct Buffer {
        std::array<std::int16_t, framesPerBuffer * channelCount> samples{};
        WAVEHDR header{};
    };
    std::array<Buffer, 2> buffers;
    HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HWAVEOUT device = nullptr;

public:
    ~WaveStream() {
        if (device) {
            waveOutReset(device);
            for (auto& buffer : buffers) {
                if (buffer.header.dwFlags & WHDR_PREPARED) {
                    waveOutUnprepareHeader(device, &buffer.header, sizeof(buffer.header));
                }
            }
            waveOutClose(device);
        }
        if (ready) CloseHandle(ready);
    }

    bool run(PlaybackMixer& mixer, const std::atomic<unsigned>& muteMask, std::stop_token stop) {
        if (!ready) return false;
        std::stop_callback wakeOnStop(stop, [this] { SetEvent(ready); });
        if (stop.stop_requested()) return true;
        WAVEFORMATEX format{WAVE_FORMAT_PCM, channelCount, sampleRate, sampleRate * channelCount * 2,
                            channelCount * 2, 16, 0};
        if (waveOutOpen(&device, WAVE_MAPPER, &format, reinterpret_cast<DWORD_PTR>(ready), 0,
                        CALLBACK_EVENT) != MMSYSERR_NOERROR) {
            device = nullptr;
            return false;
        }
        if (waveOutPause(device) != MMSYSERR_NOERROR) return false;
        std::size_t pending = 0;
        for (auto& buffer : buffers) {
            if (mixer.finished()) break;
            buffer.header.lpData = reinterpret_cast<LPSTR>(buffer.samples.data());
            buffer.header.dwBufferLength = static_cast<DWORD>(sizeof(buffer.samples));
            if (waveOutPrepareHeader(device, &buffer.header, sizeof(buffer.header)) != MMSYSERR_NOERROR ||
                !queue(buffer, mixer, muteMask)) return false;
            ++pending;
        }
        if (!pending || stop.stop_requested()) return true;
        if (waveOutRestart(device) != MMSYSERR_NOERROR) return false;

        std::size_t oldest = 0;
        while (pending && !stop.stop_requested()) {
            auto& buffer = buffers[oldest];
            if (!(buffer.header.dwFlags & WHDR_DONE)) {
                if (WaitForSingleObject(ready, INFINITE) != WAIT_OBJECT_0) return false;
                continue;
            }
            // Recycle in playback order even when several buffers completed before we woke.
            oldest = (oldest + 1) % buffers.size();
            --pending;
            if (!mixer.finished()) {
                if (!queue(buffer, mixer, muteMask)) return false;
                ++pending;
            }
        }
        return true;
    }

    static TrackMutes decodeMutes(unsigned mask) {
        TrackMutes muted{};
        for (std::size_t track = 0; track < muted.size(); ++track) {
            muted[track] = (mask & (1u << track)) != 0;
        }
        return muted;
    }

private:
    bool queue(Buffer& buffer, PlaybackMixer& mixer, const std::atomic<unsigned>& muteMask) {
        const auto count = mixer.read(buffer.samples, decodeMutes(muteMask.load()));
        buffer.header.dwBufferLength = static_cast<DWORD>(count * sizeof(buffer.samples.front()));
        return waveOutWrite(device, &buffer.header, sizeof(buffer.header)) == MMSYSERR_NOERROR;
    }
};

class Output {
public:
    enum class State { stopped, completed, failed };

    State state() const { return playbackState.load(); }

    void stop() {
        if (worker.joinable()) {
            worker.request_stop();
            worker.join();
        }
        playbackState.store(State::stopped);
    }

    void setMutes(const TrackMutes& muted) {
        unsigned mask = 0;
        for (std::size_t track = 0; track < muted.size(); ++track) {
            if (muted[track]) mask |= 1u << track;
        }
        muteMask.store(mask);
    }

    void play() {
        stop();
        const auto* demo = &demoAudio();
        worker = std::jthread([this, demo](std::stop_token stopToken) {
            PlaybackMixer mixer(*demo, WaveStream::decodeMutes(muteMask.load()));
            bool ok;
            {
                WaveStream stream;
                ok = stream.run(mixer, muteMask, stopToken);
            }
            playbackState.store(ok ? State::completed : State::failed);
        });
    }

private:
    std::atomic<unsigned> muteMask{0};
    std::atomic<State> playbackState{State::stopped};
    std::jthread worker;
};

Output audio;
HWND statusLabel;
TrackMutes muted{};

void status(const wchar_t* value) { SetWindowTextW(statusLabel, value); }

HWND control(HWND parent, const wchar_t* type, const wchar_t* title, DWORD style,
             int x, int y, int width, int height, int id = 0) {
    auto result = CreateWindowExW(0, type, title, WS_CHILD | WS_VISIBLE | style,
                                  x, y, width, height, parent, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
                                  GetModuleHandleW(nullptr), nullptr);
    SendMessageW(result, WM_SETFONT, reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)), TRUE);
    return result;
}

void exportWave(HWND window) {
    wchar_t path[MAX_PATH] = L"After Hours.wav";
    OPENFILENAMEW dialog{};
    dialog.lStructSize = sizeof(dialog);
    dialog.hwndOwner = window;
    dialog.lpstrFilter = L"WAV audio\0*.wav\0";
    dialog.lpstrFile = path;
    dialog.nMaxFile = MAX_PATH;
    dialog.lpstrDefExt = L"wav";
    dialog.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    if (!GetSaveFileNameW(&dialog)) {
        if (CommDlgExtendedError()) status(L"Could not open the save dialog.");
        return;
    }
    const auto samples = demoAudio().render(muted);
    std::ofstream file(std::filesystem::path(path), std::ios::binary);
    writeWave(file, samples);
    file.close();
    if (!file) throw std::runtime_error("Could not finish the WAV export");
    status(L"Exported stereo WAV.");
}

LRESULT CALLBACK windowProc(HWND window, UINT event, WPARAM wParam, LPARAM lParam) {
    switch (event) {
    case WM_CREATE:
        control(window, L"STATIC", L"After Hours  /  104 BPM  /  8 bars", 0, 20, 18, 430, 25);
        control(window, L"BUTTON", L"Play", WS_TABSTOP, 20, 55, 80, 30, playId);
        control(window, L"BUTTON", L"Stop", WS_TABSTOP, 110, 55, 80, 30, stopId);
        control(window, L"BUTTON", L"Export WAV...", WS_TABSTOP, 200, 55, 136, 30, exportId);
        for (unsigned track = 0; track < trackNames.size(); ++track) {
            const int y = 105 + static_cast<int>(track) * 34;
            control(window, L"STATIC", trackNames[track], 0, 20, y, 165, 24);
            control(window, L"BUTTON", L"Mute", WS_TABSTOP | BS_AUTOCHECKBOX, 190, y, 70, 24, muteId + track);
        }
        statusLabel = control(window, L"STATIC", L"Ready. Mute tracks during playback or before export.", 0, 20, 256, 460, 40);
        return 0;
    case WM_COMMAND:
        try {
            const int id = LOWORD(wParam);
            if (id == playId) {
                audio.play();
                SetTimer(window, playbackTimer, 50, nullptr);
                status(L"Playing After Hours.");
            } else if (id == stopId) {
                KillTimer(window, playbackTimer);
                audio.stop();
                status(L"Stopped.");
            } else if (id == exportId) {
                exportWave(window);
            } else if (id >= muteId && id < muteId + static_cast<int>(muted.size())) {
                muted[id - muteId] = IsDlgButtonChecked(window, id) == BST_CHECKED;
                audio.setMutes(muted);
            }
        } catch (const std::exception&) {
            status(L"Could not render or write the audio. Check the destination and retry.");
        }
        return 0;
    case WM_TIMER:
        if (wParam == playbackTimer) {
            const auto state = audio.state();
            if (state == Output::State::completed || state == Output::State::failed) {
                KillTimer(window, playbackTimer);
                audio.stop();
                status(state == Output::State::completed ? L"Playback complete."
                                                        : L"Windows audio output failed.");
            }
        }
        return 0;
    case WM_CLOSE:
        audio.stop();
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(window, event, wParam, lParam);
    }
}
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE, LPSTR, int show) {
    WNDCLASSW type{};
    type.hInstance = instance;
    type.lpfnWndProc = windowProc;
    type.lpszClassName = L"SonoravellStudio";
    type.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
    type.hbrBackground = GetSysColorBrush(COLOR_WINDOW);
    if (!RegisterClassW(&type)) return 1;
    const auto window = CreateWindowExW(0, type.lpszClassName, L"Sonoravell Studio", WS_OVERLAPPED | WS_CAPTION |
                                         WS_SYSMENU | WS_MINIMIZEBOX, CW_USEDEFAULT, CW_USEDEFAULT, 520, 350,
                                         nullptr, nullptr, instance, nullptr);
    if (!window) return 1;
    ShowWindow(window, show);
    MSG message{};
    int result;
    while ((result = GetMessageW(&message, nullptr, 0, 0)) > 0) {
        if (!IsDialogMessageW(window, &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    return result == -1 ? 1 : static_cast<int>(message.wParam);
}
