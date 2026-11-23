#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>
#include <mmsystem.h>

#include "session.hpp"

#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <utility>

namespace {
using namespace sonoravell;
constexpr int playId = 100, stopId = 101, exportId = 102, muteId = 200;
constexpr UINT_PTR playbackTimer = 1;

class Output {
    HWAVEOUT device = nullptr;
    WAVEHDR header{};
    Samples samples;

public:
    bool active() const { return device != nullptr; }
    bool finished() const { return active() && (header.dwFlags & WHDR_DONE) != 0; }

    bool stop() {
        if (!active()) return true;
        if (waveOutReset(device) != MMSYSERR_NOERROR) return false;
        if ((header.dwFlags & WHDR_PREPARED) &&
            waveOutUnprepareHeader(device, &header, sizeof(header)) != MMSYSERR_NOERROR) return false;
        if (waveOutClose(device) != MMSYSERR_NOERROR) return false;
        device = nullptr;
        header = {};
        samples.clear();
        return true;
    }

    bool play(Samples next) {
        if (!stop()) return false;
        WAVEFORMATEX format{WAVE_FORMAT_PCM, channelCount, sampleRate, sampleRate * channelCount * 2,
                            channelCount * 2, 16, 0};
        if (waveOutOpen(&device, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
            device = nullptr;
            return false;
        }
        samples = std::move(next);
        header.lpData = reinterpret_cast<LPSTR>(samples.data());
        header.dwBufferLength = static_cast<DWORD>(samples.size() * sizeof(Samples::value_type));
        if (waveOutPrepareHeader(device, &header, sizeof(header)) == MMSYSERR_NOERROR &&
            waveOutWrite(device, &header, sizeof(header)) == MMSYSERR_NOERROR) return true;
        stop();
        return false;
    }
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
    const auto samples = render(muted);
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
        statusLabel = control(window, L"STATIC", L"Ready. Mutes apply to the next playback or export.", 0, 20, 256, 460, 40);
        return 0;
    case WM_COMMAND:
        try {
            const int id = LOWORD(wParam);
            if (id == playId) {
                if (!audio.play(render(muted))) status(L"Could not start the default Windows audio output.");
                else {
                    SetTimer(window, playbackTimer, 100, nullptr);
                    status(L"Playing After Hours.");
                }
            } else if (id == stopId) {
                KillTimer(window, playbackTimer);
                status(audio.stop() ? L"Stopped." : L"Could not stop the audio output.");
            } else if (id == exportId) {
                exportWave(window);
            } else if (id >= muteId && id < muteId + static_cast<int>(muted.size())) {
                muted[id - muteId] = IsDlgButtonChecked(window, id) == BST_CHECKED;
            }
        } catch (const std::exception&) {
            status(L"Could not render or write the audio. Check the destination and retry.");
        }
        return 0;
    case WM_TIMER:
        if (wParam == playbackTimer && audio.finished()) {
            KillTimer(window, playbackTimer);
            status(audio.stop() ? L"Playback complete." : L"Could not release the audio output.");
        }
        return 0;
    case WM_CLOSE:
        if (!audio.stop()) {
            status(L"Could not release the audio output. Try Stop again.");
            return 0;
        }
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
