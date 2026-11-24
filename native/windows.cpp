#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <commdlg.h>
#include <mmsystem.h>

#include "session.hpp"
#include "session_autosave.hpp"
#include "windows_audio.hpp"
#include "windows_capture.hpp"
#include "windows_devices.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cwchar>
#include <cwctype>
#include <exception>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <filesystem>
#include <fstream>
#include <stdexcept>

namespace {
using namespace sonoravell;
constexpr UINT_PTR transportTimer = 1;

enum ControlId {
    titleId = 100, newId, demoId, openId, saveId, exportId, recordId, playId, stopId, undoId, tempoLabelId, tempoId,
    tempoApplyId, commandId, focusId, inspectorId, trackListId, trackLabelId, beatLabelId, beatId,
    pitchLabelId, pitchId, noteId, moveId, removeId, browserId, importId, addTrackId, assetListId, placeId,
    lengthLabelId, lengthId, noteListId, updateNoteId, deleteNoteId, queryId, queryFocusId,
    toggleInspectorId, toggleBrowserId, toggleMixerId, resetLayoutId, recoverId, restoreSessionId, deviceId, selectInputId, selectOutputId,
    selectWaveOutId, selectWasapiId, selectWasapiOutputId, selectPeriodId, renderReportId,
    selectWaveInId, selectWasapiCaptureId, selectWasapiInputId, selectCaptureBufferId, captureReportId,
    mixerId, volumeLabelId, volumeId, volumeApplyId, muteId, statusId
};

Project project = afterHoursProject();
std::unique_ptr<SessionAudio> prepared;
Output audio;
Capture capture;
EndpointChoice inputChoice, outputChoice;
bool useWasapi = false;
WasapiOutputConfig wasapiConfig;
bool useWasapiCapture = false;
WasapiInputConfig wasapiInputConfig;
struct CaptureDiagnostics {
    WasapiInputReport report;
    bool storageFailed;
    bool saved;
    std::size_t verifiedFrames;
};
std::optional<CaptureDiagnostics> lastCaptureDiagnostics;
constexpr std::array periodChoices{0u, 256u, 512u, 1024u};
std::function<void()> undo;
bool dirty = false;
bool autosavePending = false;
ULONGLONG autosaveAfter = 0;
SessionAutosave autosave;
bool focused = false;
bool inspectorShown = true, browserShown = true, mixerShown = true;
unsigned playFrom = 0;
std::uint32_t totalFrames = sessionFrames(project);

std::wstring wide(const std::string& value) {
    if (value.empty()) return {};
    auto size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) return L"(Unreadable name)";
    std::wstring output(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), output.data(), size);
    return output;
}

std::string audioName(const std::filesystem::path& path) {
    const auto name = path.stem().u8string();
    if (name.size() > 200 || name.empty()) return "Imported Audio";
    return {name.begin(), name.end()};
}

HWND field(HWND window, int id) { return GetDlgItem(window, id); }

void status(HWND window, const wchar_t* value) { SetWindowTextW(field(window, statusId), value); }

void addControl(HWND window, int id, const wchar_t* type, const wchar_t* title, DWORD style = 0, DWORD edge = 0) {
    const auto control = CreateWindowExW(edge, type, title, WS_CHILD | WS_VISIBLE | style, 0, 0, 0, 0, window,
        reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), GetModuleHandleW(nullptr), nullptr);
    SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)), TRUE);
}

void layout(HWND window) {
    RECT client{};
    GetClientRect(window, &client);
    const int width = client.right;
    const int height = client.bottom;
    const auto place = [&](int id, int x, int y, int w, int h) {
        MoveWindow(field(window, id), x, y, std::max(1, w), std::max(1, h), TRUE);
    };
    place(titleId, 14, 12, width - 500, 24);
    int buttonX = width - 464;
    for (int id : {newId, demoId, openId, saveId, exportId, focusId}) {
        place(id, buttonX, 8, 71, 27);
        buttonX += 75;
    }
    buttonX = 14;
    for (int id : {recordId, playId, stopId, undoId}) {
        place(id, buttonX, 47, 74, 29);
        buttonX += 80;
    }
    place(tempoLabelId, 350, 53, 82, 20);
    place(tempoId, 430, 47, 52, 26);
    place(tempoApplyId, 490, 47, 57, 28);
    const int queryWidth = std::clamp(width - 718, 52, 143);
    place(deviceId, 549, 47, 66, 28);
    place(queryId, width - 96 - queryWidth, 47, queryWidth, 27);
    place(commandId, width - 91, 47, 78, 28);

    const auto show = [&](std::initializer_list<int> ids, bool visible) {
        for (int id : ids) ShowWindow(field(window, id), visible && !focused ? SW_SHOW : SW_HIDE);
    };
    show({inspectorId, trackLabelId, trackListId, beatLabelId, beatId, pitchLabelId, pitchId, lengthLabelId,
          lengthId, noteListId, noteId, updateNoteId, deleteNoteId, moveId, removeId}, inspectorShown);
    show({browserId, importId, addTrackId, assetListId, placeId, recoverId}, browserShown);
    show({mixerId, volumeLabelId, volumeId, volumeApplyId, muteId}, mixerShown);
    place(inspectorId, 10, 91, 173, height - 176);
    place(trackLabelId, 22, 122, 145, 18);
    place(trackListId, 22, 143, 148, 280);
    place(beatLabelId, 22, 184, 105, 22);
    place(beatId, 126, 180, 45, 24);
    place(pitchLabelId, 22, 219, 100, 22);
    place(pitchId, 126, 215, 45, 24);
    place(lengthLabelId, 22, 251, 100, 22);
    place(lengthId, 126, 247, 45, 24);
    place(noteListId, 22, 277, 148, 240);
    place(noteId, 22, 309, 148, 27);
    place(updateNoteId, 22, 343, 70, 27);
    place(deleteNoteId, 99, 343, 71, 27);
    place(moveId, 22, 377, 148, 27);
    place(removeId, 22, 411, 148, 27);
    place(browserId, width - 183, 91, 173, height - 176);
    place(importId, width - 171, 124, 148, 28);
    place(addTrackId, width - 171, 162, 148, 28);
    place(recoverId, width - 171, 200, 148, 28);
    place(assetListId, width - 171, 242, 148, height - 491);
    place(placeId, width - 171, height - 241, 148, 28);
    place(mixerId, 10, height - 77, width - 20, 50);
    place(volumeLabelId, 25, height - 54, 94, 18);
    place(volumeId, 119, height - 58, 45, 24);
    place(volumeApplyId, 171, height - 60, 65, 28);
    place(muteId, 250, height - 57, 110, 23);
    place(statusId, 14, height - 21, width - 30, 18);
    InvalidateRect(window, nullptr, TRUE);
}

RECT arrangeRect(HWND window) {
    RECT rect{};
    GetClientRect(window, &rect);
    return {focused || !inspectorShown ? 12 : 190, 96, rect.right - (focused || !browserShown ? 12 : 190),
            rect.bottom - (focused || !mixerShown ? 28 : 87)};
}

void fill(HDC dc, const RECT& rect, COLORREF color) {
    const auto brush = CreateSolidBrush(color);
    if (brush) {
        FillRect(dc, &rect, brush);
        DeleteObject(brush);
    }
}

int arrangementRowHeight(const RECT& panel) {
    const int height = std::max(20, static_cast<int>(panel.bottom - panel.top - 65));
    return std::min(38, height / static_cast<int>(std::max<std::size_t>(1, project.tracks.size())));
}

void drawArrangement(HWND window) {
    PAINTSTRUCT paint{};
    const auto dc = BeginPaint(window, &paint);
    const auto panel = arrangeRect(window);
    if (panel.right <= panel.left || panel.bottom <= panel.top) {
        EndPaint(window, &paint);
        return;
    }
    const int savedDc = SaveDC(dc);
    IntersectClipRect(dc, panel.left, panel.top, panel.right, panel.bottom);
    SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
    SetBkMode(dc, TRANSPARENT);
    FillRect(dc, &panel, GetSysColorBrush(COLOR_WINDOW));
    const int left = panel.left + 102;
    const int width = std::max(1L, panel.right - left - 8);
    const int gridTop = panel.top + 58;
    const int height = std::max(20, static_cast<int>(panel.bottom - gridTop - 7));
    const int rowHeight = arrangementRowHeight(panel);
    auto ruler = RECT{left, panel.top + 31, panel.right - 8, gridTop};
    FillRect(dc, &ruler, GetSysColorBrush(COLOR_BTNFACE));
    const auto xOf = [&](unsigned frame) {
        return left + static_cast<int>(static_cast<std::uint64_t>(std::min(frame, totalFrames)) * width / totalFrames);
    };
    SetTextColor(dc, GetSysColor(COLOR_WINDOWTEXT));
    TextOutW(dc, panel.left + 8, panel.top + 7, L"Arrange", 7);
    if (project.tracks.empty()) {
        constexpr wchar_t empty[] = L"Import audio, record, or add an instrument track.";
        TextOutW(dc, panel.left + 8, gridTop + 10, empty, static_cast<int>(std::size(empty) - 1));
    }
    const int selected = static_cast<int>(SendMessageW(field(window, trackListId), CB_GETCURSEL, 0, 0));
    for (std::size_t index = 0; index < project.tracks.size(); ++index) {
        const auto& track = project.tracks[index];
        const int top = gridTop + static_cast<int>(index) * rowHeight;
        RECT label{panel.left + 5, top + 1, left - 4, top + rowHeight - 1};
        if (static_cast<int>(index) == selected) FillRect(dc, &label, GetSysColorBrush(COLOR_BTNFACE));
        const auto name = wide(track.name);
        DrawTextW(dc, name.c_str(), -1, &label, DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX);
        const auto block = [&](unsigned first, unsigned last, COLORREF color) {
            const int x = xOf(first);
            const RECT rect{x, top + 4, std::min(static_cast<int>(panel.right - 8), std::max(x + 2, xOf(last))),
                            top + rowHeight - 4};
            fill(dc, rect, track.muted ? GetSysColor(COLOR_GRAYTEXT) : color);
        };
        for (const auto& note : track.notes) {
            block(frameAtTick(note.tick, project.tempo), frameAtTick(note.tick + note.length, project.tempo), RGB(86, 185, 156));
        }
        for (const auto& clip : track.clips) {
            const auto start = frameAtTick(clip.tick, project.tempo);
            const auto frames = static_cast<unsigned>(findAsset(project, clip.assetId).stereo.size() / channelCount);
            block(start, start + frames, RGB(82, 143, 207));
        }
        RECT line{panel.left + 5, top + rowHeight - 1, panel.right - 8, top + rowHeight};
        FillRect(dc, &line, GetSysColorBrush(COLOR_BTNFACE));
    }
    int lastLabel = left - 35;
    for (unsigned bar = 0; bar < maxBars; ++bar) {
        const auto frame = frameAtTick(bar * beatsPerBar * ticksPerBeat, project.tempo);
        if (frame >= totalFrames) break;
        const int x = xOf(frame);
        if (x - lastLabel < 34) continue;
        const auto label = std::to_wstring(bar + 1);
        TextOutW(dc, x + 4, ruler.top + 6, label.c_str(), static_cast<int>(label.size()));
        RECT line{x, gridTop, x + 1, gridTop + height};
        FillRect(dc, &line, GetSysColorBrush(COLOR_3DLIGHT));
        lastLabel = x;
    }
    const bool playing = audio.state() == Output::State::playing;
    const int x = xOf(playFrom + (playing ? audio.framesPlayed() : 0));
    const RECT playhead{x, ruler.top, x + (playing ? 2 : 1), gridTop + height};
    fill(dc, playhead, RGB(220, 105, 39));
    RestoreDC(dc, savedDc);
    EndPaint(window, &paint);
}

int selectedTrack(HWND window) {
    return static_cast<int>(SendMessageW(field(window, trackListId), CB_GETCURSEL, 0, 0));
}

std::wstring beatText(unsigned tick) {
    auto text = std::to_wstring(static_cast<double>(tick) / ticksPerBeat);
    text.erase(text.find_last_not_of(L'0') + 1);
    if (text.back() == L'.') text.pop_back();
    return text;
}

void pickNote(HWND window) {
    const int trackIndex = selectedTrack(window);
    const auto noteIndex = SendMessageW(field(window, noteListId), CB_GETCURSEL, 0, 0);
    if (trackIndex < 0 || noteIndex < 0 || static_cast<std::size_t>(trackIndex) >= project.tracks.size()) return;
    const auto& notes = project.tracks[trackIndex].notes;
    if (static_cast<std::size_t>(noteIndex) >= notes.size()) return;
    const auto& note = notes[noteIndex];
    SetDlgItemTextW(window, beatId, beatText(note.tick).c_str());
    SetDlgItemTextW(window, lengthId, beatText(note.length).c_str());
    SetDlgItemInt(window, pitchId, note.pitch, FALSE);
}

void refreshTrack(HWND window) {
    const int index = selectedTrack(window);
    const bool selected = index >= 0 && index < static_cast<int>(project.tracks.size());
    const bool safeToEdit = selected && !capture.active();
    for (int id : {volumeId, volumeApplyId, muteId}) EnableWindow(field(window, id), safeToEdit);
    EnableWindow(field(window, beatId), !capture.active());
    bool instrument = false, audioClip = false, hasNotes = false;
    const auto noteList = field(window, noteListId);
    SendMessageW(noteList, CB_RESETCONTENT, 0, 0);
    SetDlgItemTextW(window, lengthId, L"1");
    if (selected) {
        const auto& track = project.tracks[index];
        instrument = track.instrument != Instrument::audio;
        audioClip = !track.clips.empty();
        SetDlgItemInt(window, volumeId, track.volume, FALSE);
        CheckDlgButton(window, muteId, track.muted ? BST_CHECKED : BST_UNCHECKED);
        SetDlgItemTextW(window, beatId, beatText(audioClip ? track.clips.front().tick : 0).c_str());
        hasNotes = !track.notes.empty();
        for (const auto& note : track.notes) {
            const auto item = L"Beat " + beatText(note.tick) + L"  |  MIDI " + std::to_wstring(note.pitch);
            SendMessageW(noteList, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(item.c_str()));
        }
        if (hasNotes) {
            SendMessageW(noteList, CB_SETCURSEL, 0, 0);
            pickNote(window);
        }
    } else {
        SetDlgItemTextW(window, volumeId, L"");
        CheckDlgButton(window, muteId, BST_UNCHECKED);
    }
    EnableWindow(field(window, pitchId), safeToEdit && instrument);
    EnableWindow(field(window, noteId), safeToEdit && instrument);
    EnableWindow(field(window, lengthId), safeToEdit && instrument);
    for (int id : {noteListId, updateNoteId, deleteNoteId}) EnableWindow(field(window, id), safeToEdit && hasNotes);
    EnableWindow(field(window, moveId), safeToEdit && audioClip);
    EnableWindow(field(window, removeId), safeToEdit);
}

void refresh(HWND window, int index) {
    const auto title = wide(project.name) + (dirty ? L" *" : L"");
    SetDlgItemTextW(window, titleId, title.c_str());
    auto list = field(window, trackListId);
    SendMessageW(list, CB_RESETCONTENT, 0, 0);
    for (const auto& track : project.tracks) {
        const auto name = wide(track.name);
        SendMessageW(list, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(name.c_str()));
    }
    if (!project.tracks.empty()) {
        SendMessageW(list, CB_SETCURSEL, std::clamp(index, 0, static_cast<int>(project.tracks.size() - 1)), 0);
    }
    const auto sources = field(window, assetListId);
    SendMessageW(sources, LB_RESETCONTENT, 0, 0);
    for (const auto& source : project.assets) {
        const auto name = wide(source.name);
        SendMessageW(sources, LB_ADDSTRING, 0, reinterpret_cast<LPARAM>(name.c_str()));
    }
    if (!project.assets.empty()) SendMessageW(sources, LB_SETCURSEL, 0, 0);
    EnableWindow(field(window, placeId), !capture.active() && !project.assets.empty());
    SetDlgItemInt(window, tempoId, project.tempo, FALSE);
    for (int id : {newId, demoId, openId, saveId, exportId, playId, recordId, importId, addTrackId, tempoApplyId, recoverId, deviceId}) {
        EnableWindow(field(window, id), !capture.active());
    }
    EnableWindow(field(window, undoId), !capture.active() && static_cast<bool>(undo));
    refreshTrack(window);
    const auto rect = arrangeRect(window);
    InvalidateRect(window, &rect, FALSE);
}

unsigned value(HWND window, int id, unsigned min, unsigned max, const char* message) {
    BOOL converted = FALSE;
    const unsigned result = GetDlgItemInt(window, id, &converted, FALSE);
    if (!converted || result < min || result > max) throw std::runtime_error(message);
    return result;
}

unsigned beatInput(HWND window, int id, bool duration) {
    wchar_t fieldText[24]{};
    const auto size = GetDlgItemTextW(window, id, fieldText, static_cast<int>(std::size(fieldText)));
    if (size <= 0 || size >= static_cast<int>(std::size(fieldText) - 1)) {
        throw std::runtime_error("Enter a beat value such as 0, 1 or 2.5.");
    }
    std::string number;
    for (wchar_t digit : std::wstring_view(fieldText, size)) {
        if ((digit < L'0' || digit > L'9') && digit != L'.') {
            throw std::runtime_error("Enter beats using digits and a decimal point.");
        }
        number.push_back(static_cast<char>(digit));
    }
    double beats = 0;
    const auto [end, error] = std::from_chars(number.data(), number.data() + number.size(), beats);
    const auto limit = maxBars * beatsPerBar * ticksPerBeat;
    if (error != std::errc{} || end != number.data() + number.size() || beats >= maxBars * beatsPerBar) {
        throw std::runtime_error("Beat value is outside the supported timeline.");
    }
    const auto tick = static_cast<unsigned>(std::lround(beats * ticksPerBeat));
    if (tick >= limit || (duration && tick == 0)) throw std::runtime_error("Enter a positive duration within the timeline.");
    return tick;
}

template<class Items>
std::uint32_t newIdFor(const Items& items) {
    for (std::uint32_t id = 1; id <= items.size() + 1; ++id) {
        if (std::ranges::none_of(items, [id](const auto& item) { return item.id == id; })) return id;
    }
    throw std::runtime_error("No free track or audio source ID.");
}

void markDirty() {
    dirty = true;
    autosavePending = true;
    autosaveAfter = GetTickCount64() + 1200;
}

std::filesystem::path sessionRecoveryDirectory() {
    return takeRecoveryDirectory() / L"Sessions";
}

void checkpointIfIdle(HWND window) {
    if (!autosavePending || capture.active() || audio.state() != Output::State::stopped ||
        GetTickCount64() < autosaveAfter) return;
    autosavePending = false;
    try {
        autosave.checkpoint(sessionRecoveryDirectory(), project);
        status(window, L"Recovery checkpoint saved. Use Save As to update your Session file.");
    } catch (const std::exception&) {
        status(window, L"Session autosave failed. The previous checkpoint is intact. Check storage or use Save As.");
        autosavePending = true;
        autosaveAfter = GetTickCount64() + 15000;
    }
}

void edit(HWND window, std::function<void()> reverse, int index, bool newAudio = true) {
    try {
        validateProject(project);
    } catch (...) {
        reverse();
        refresh(window, index);
        throw;
    }
    if (newAudio) {
        audio.stop();
        prepared.reset();
    }
    totalFrames = sessionFrames(project);
    playFrom = std::min(playFrom, totalFrames - 1);
    audio.setMutes(trackMutes(project));
    undo = std::move(reverse);
    markDirty();
    refresh(window, index);
}

void revert(HWND window) {
    if (!undo) return;
    const int index = selectedTrack(window);
    audio.stop();
    prepared.reset();
    undo();
    undo = {};
    markDirty();
    totalFrames = sessionFrames(project);
    playFrom = std::min(playFrom, totalFrames - 1);
    audio.setMutes(trackMutes(project));
    refresh(window, index);
    status(window, L"Undid the last edit.");
}

void installProject(HWND window, Project next) {
    audio.stop();
    prepared.reset();
    project = std::move(next);
    playFrom = 0;
    totalFrames = sessionFrames(project);
    playFrom = std::min(playFrom, totalFrames - 1);
    audio.setMutes(trackMutes(project));
    dirty = false;
    autosavePending = false;
    autosave.startSession();
    undo = {};
    refresh(window, 0);
}

bool discardEdits(HWND window) {
    return !dirty || MessageBoxW(window, L"Discard changes since your last Session save?", L"Unsaved Session",
                                 MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON2) == IDYES;
}

std::filesystem::path selectFile(HWND window, bool save, const wchar_t* filter, const wchar_t* extension, const wchar_t* directory = nullptr) {
    wchar_t path[32768]{};
    OPENFILENAMEW dialog{};
    dialog.lStructSize = sizeof(dialog);
    dialog.hwndOwner = window;
    dialog.lpstrFilter = filter;
    dialog.lpstrFile = path;
    dialog.nMaxFile = static_cast<DWORD>(std::size(path));
    dialog.lpstrDefExt = extension;
    dialog.lpstrInitialDir = directory;
    dialog.Flags = OFN_EXPLORER | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR |
                   (save ? OFN_OVERWRITEPROMPT : OFN_FILEMUSTEXIST);
    if (save ? GetSaveFileNameW(&dialog) : GetOpenFileNameW(&dialog)) return path;
    if (CommDlgExtendedError()) throw std::runtime_error("Could not open the file dialog.");
    return {};
}

const SessionAudio& renderedSession() {
    if (!prepared) prepared = std::make_unique<SessionAudio>(project);
    return *prepared;
}

void addAudio(HWND window, AudioAsset asset, unsigned tick) {
    if (project.tracks.size() >= maxTracks || project.assets.size() >= maxAssets) {
        throw std::runtime_error("The Session is at its track or audio source limit.");
    }
    const auto id = asset.id;
    Track track{newIdFor(project.tracks), asset.name, Instrument::audio, false, 100, {}, {{id, tick}}};
    project.assets.push_back(std::move(asset));
    try {
        project.tracks.push_back(std::move(track));
    } catch (...) {
        project.assets.pop_back();
        throw;
    }
    edit(window, [] { project.tracks.pop_back(); project.assets.pop_back(); },
         static_cast<int>(project.tracks.size() - 1));
}

void addRecoveredTake(HWND window, RecoveredTake take, bool interrupted) {
    if (take.stereo.empty()) {
        refresh(window, selectedTrack(window));
        status(window, interrupted ? L"Recording stopped before any audio could be recovered. Check device and disk space."
                                   : L"No recoverable audio was found in this take.");
        return;
    }
    const auto id = newIdFor(project.assets);
    try {
        addAudio(window, {id, "Recording " + std::to_string(id), std::move(take.stereo)}, take.startTick);
    } catch (const std::exception&) {
        throw std::runtime_error("The take file is intact. It did not fit this Session. Try Recover take in a smaller Session.");
    }
    status(window, interrupted || !take.finalized
        ? L"Recovered verified audio up to the interruption. Save this Session to keep the edit."
        : L"Recording added. The recovery copy remains on disk. Save Session to keep the edit.");
}

void finishTake(HWND window) {
    auto result = capture.finish();
    const auto error = result.wasapi ? result.wasapi->stream.error : CaptureError::none;
    const bool recovered = !result.take.stereo.empty();
    if (result.wasapi) {
        lastCaptureDiagnostics = CaptureDiagnostics{std::move(*result.wasapi), result.storageFailed,
                                                     result.diagnosticsSaved, result.take.stereo.size() / channelCount};
    }
    addRecoveredTake(window, std::move(result.take), result.interrupted);
    if (result.storageFailed || error != CaptureError::none) {
        const auto reason = wide(captureErrorText(result.storageFailed ? CaptureError::storage : error));
        status(window, (reason + (recovered ? L" Verified audio recovered. Save the Session to keep it."
                                            : L" No audio recovered.")).c_str());
    }
}

void showCommands(HWND window) {
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    wchar_t queryText[100]{};
    GetDlgItemTextW(window, queryId, queryText, static_cast<int>(std::size(queryText)));
    const auto lowercase = [](std::wstring text) {
        std::ranges::transform(text, text.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
        return text;
    };
    const auto query = lowercase(queryText);
    for (const auto& entry : {std::pair<int, const wchar_t*>{newId, L"New Session"}, {demoId, L"Load demo"},
         {openId, L"Open Session..."}, {deviceId, L"Audio devices..."}, {restoreSessionId, L"Restore Session checkpoint..."}, {saveId, L"Save Session As..."}, {importId, L"Import WAV..."},
         {addTrackId, L"Add instrument"}, {placeId, L"Place audio source"}, {recoverId, L"Recover recorded take..."}, {recordId, L"Record"}, {playId, L"Play"}, {stopId, L"Stop"},
         {exportId, L"Export WAV..."}, {undoId, L"Undo last edit"}, {focusId, L"Toggle Focus"}, {noteId, L"Add MIDI note"},
         {updateNoteId, L"Update MIDI note"}, {deleteNoteId, L"Delete MIDI note"}, {moveId, L"Move audio clip"},
         {toggleInspectorId, L"Toggle Inspector"}, {toggleBrowserId, L"Toggle Browser"},
         {toggleMixerId, L"Toggle Mixer"}, {resetLayoutId, L"Reset workspace"}}) {
        if (!query.empty() && lowercase(entry.second).find(query) == std::wstring::npos) continue;
        const auto action = field(window, entry.first);
        AppendMenuW(menu, MF_STRING | (!action || IsWindowEnabled(action) ? MF_ENABLED : MF_GRAYED),
                    entry.first, entry.second);
    }
    if (GetMenuItemCount(menu) == 0) AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, L"No matching commands");
    RECT rect{};
    GetWindowRect(field(window, commandId), &rect);
    TrackPopupMenu(menu, TPM_RIGHTALIGN | TPM_TOPALIGN, rect.right, rect.bottom, 0, window, nullptr);
    DestroyMenu(menu);
}

std::wstring menuLabel(std::wstring name) {
    // Win32 menus treat ampersand as an accelerator marker.
    for (std::size_t at = 0; (at = name.find(L'&', at)) != name.npos; at += 2) name.insert(at, 1, L'&');
    return name;
}

void chooseAudioDevice(HWND window, AudioDirection direction) {
    const auto devices = listWindowsAudioEndpoints(direction);
    auto& choice = direction == AudioDirection::input ? inputChoice : outputChoice;
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    AppendMenuW(menu, MF_STRING | (!choice ? MF_CHECKED : 0), 1, L"Windows default");
    for (std::size_t index = 0; index < devices.size(); ++index) {
        const auto& device = devices[index];
        const auto label = menuLabel(device.name);
        const auto ambiguous = std::ranges::count(devices, device) > 1;
        AppendMenuW(menu, MF_STRING | (ambiguous ? MF_GRAYED : 0) | (choice == device ? MF_CHECKED : 0),
                    index + 2, label.c_str());
    }
    RECT toggle{};
    GetWindowRect(field(window, deviceId), &toggle);
    const auto selected = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY, toggle.left, toggle.bottom, 0, window, nullptr);
    DestroyMenu(menu);
    if (!selected || capture.active()) return;
    EndpointChoice next;
    if (selected > 1) next = devices.at(selected - 2);
    resolveWindowsAudioEndpoint(direction, next);
    audio.stop();
    const auto rect = arrangeRect(window);
    InvalidateRect(window, &rect, FALSE);
    choice = std::move(next);
    const std::wstring kind = direction == AudioDirection::input ? L"Input: " : L"Output: ";
    status(window, (kind + (choice ? choice->name : L"Windows default")).c_str());
}

const wchar_t* renderErrorText(RenderError error) {
    switch (error) {
    case RenderError::none: return L"None";
    case RenderError::unsupportedFormat: return L"Unsupported client format. Try System period or WinMM.";
    case RenderError::unsupportedPeriod: return L"Unsupported or locked engine period. Try System period or WinMM.";
    case RenderError::deviceUnavailable: return L"Output unavailable. Reconnect it or choose another WASAPI output in Devices.";
    case RenderError::deviceInvalidated: return L"Device became unavailable. Reconnect it or choose another output, then press Play.";
    case RenderError::timeout: return L"Timed out waiting for audio buffer events.";
    case RenderError::invalidBuffer: return L"Endpoint reported invalid buffer data.";
    case RenderError::driver: return L"Windows audio driver or service error.";
    }
    return L"Unknown error.";
}

const wchar_t* renderStageText(RenderStage stage) {
    switch (stage) {
    case RenderStage::open: return L"Open";
    case RenderStage::prime: return L"Prime";
    case RenderStage::start: return L"Start";
    case RenderStage::stream: return L"Render";
    case RenderStage::drain: return L"Drain";
    case RenderStage::stop: return L"Stop";
    }
    return L"Unknown";
}

std::wstring clockDiagnostics(const StreamClock& clock) {
    if (!clock.unitsPerSecond()) return L"\n\nStream clock: unavailable";
    const auto stamp = [](const std::optional<ClockStamp>& sample) -> std::wstring {
        if (!sample) return L"Unavailable";
        return std::to_wstring(sample->position.units) + L" / " + std::to_wstring(sample->qpc.ticks100ns);
    };
    const auto rejected = clock.rejected();
    return L"\n\nStream clock units/second: " + std::to_wstring(clock.unitsPerSecond()) +
        L"\nFirst position / QPC (100 ns): " + stamp(clock.first()) +
        L"\nLast position / QPC (100 ns): " + stamp(clock.last()) +
        L"\nMissing / stale / nonmonotonic samples: " + std::to_wstring(rejected.missing) +
        L" / " + std::to_wstring(rejected.stale) + L" / " + std::to_wstring(rejected.nonmonotonic) +
        L"\nClock reset detected: " + (rejected.reset ? L"Yes" : L"No");
}

void showRenderReport(HWND window) {
    if (audio.state() == Output::State::playing) {
        status(window, L"Stop playback to view its diagnostic report.");
        return;
    }
    audio.stop();
    const auto& result = audio.lastWasapiRun();
    if (!result) {
        status(window, L"Run a WASAPI playback attempt to collect diagnostics.");
        return;
    }
    const auto& report = result->stream;
    const auto target = result->requested ? L"Explicit: " + result->requested->name : L"Windows default";
    const auto output = result->resolved.name.empty() ? L"Unresolved" : result->resolved.name;
    const auto& endpointId = !result->resolved.id.empty() ? result->resolved.id :
                             (result->requested ? result->requested->id : result->resolved.id);
    const auto outcome = report.end == RenderEnd::completed ? L"Completed" :
                         report.end == RenderEnd::cancelled ? L"Stopped" : L"Failed";
    wchar_t nativeCode[16]{};
    swprintf_s(nativeCode, std::size(nativeCode), L"0x%08X", report.nativeError);
    const auto message = std::wstring(outcome) + L" • " + renderStageText(report.stage) +
        L"\n" + renderErrorText(report.error) + L"\nNative status " + nativeCode +
        L"\n\nRequested output: " + target + L"\nResolved output: " + output +
        L"\nEndpoint ID: " + (endpointId.empty() ? L"Unavailable" : endpointId) +
        L"\n\nClient format: 48000 Hz, 2 channels, 16-bit PCM" +
        L"\nWindows mix: " + std::to_wstring(report.mixRate) + L" Hz / " + std::to_wstring(report.mixChannels) +
        L" channels\nWindows conversion requested: " + (report.conversionEnabled ? L"Yes" : L"No") +
        L"\nRequested period: " + (report.requestedFrames ? std::to_wstring(report.requestedFrames) : L"System") +
        L"\nSelected custom period: " + (report.selectedPeriodFrames ? std::to_wstring(report.selectedPeriodFrames) : L"None") +
        L"\nAllocated buffer: " + std::to_wstring(report.bufferFrames) + L" frames" +
        L"\nSubmitted: " + std::to_wstring(report.submittedFrames) + L" frames" +
        L"\n\nEmpty render-buffer events (suspected underruns): " + std::to_wstring(report.emptyBufferEvents) +
        L"\nWait timeouts: " + std::to_wstring(report.waitTimeouts) +
        L"\nDevice invalidations: " + std::to_wstring(report.deviceInvalidations) + clockDiagnostics(result->clock);
    MessageBoxW(window, message.c_str(), L"WASAPI playback diagnostics", MB_OK | MB_ICONINFORMATION);
}

unsigned popupDeviceMenu(HWND window, HMENU menu) {
    RECT toggle{};
    GetWindowRect(field(window, deviceId), &toggle);
    const auto selected = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY, toggle.left, toggle.bottom, 0, window, nullptr);
    DestroyMenu(menu);
    return selected;
}

void chooseWasapiPeriod(HWND window) {
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    for (std::size_t i = 0; i < periodChoices.size(); ++i) {
        const auto frames = periodChoices[i];
        const auto title = frames ? std::to_wstring(frames) + L" frames (request)" : L"System period";
        AppendMenuW(menu, MF_STRING | (frames == wasapiConfig.stream.requestedFrames ? MF_CHECKED : 0), i + 1, title.c_str());
    }
    const auto selected = popupDeviceMenu(window, menu);
    if (!selected || capture.active()) return;
    audio.stop();
    wasapiConfig.stream.requestedFrames = periodChoices.at(selected - 1);
    InvalidateRect(window, nullptr, FALSE);
    status(window, L"WASAPI buffer preference updated for the next Play.");
}

void setWasapiOutput(HWND window, AudioEndpointChoice next) {
    const auto& current = wasapiConfig.output;
    const bool changed = current.has_value() != next.has_value() ||
                         (current && next && current->id != next->id);
    if (changed) audio.stop();
    wasapiConfig.output = std::move(next);
    InvalidateRect(window, nullptr, FALSE);
    status(window, changed ? L"WASAPI output selected. Press Play to use it."
                           : L"WASAPI output already selected.");
}

void setWasapiInput(HWND window, AudioEndpointChoice next) {
    wasapiInputConfig.input = std::move(next);
    status(window, L"WASAPI input selected for the next Record.");
}

void chooseWasapiEndpoint(HWND window, AudioDirection direction) {
    const bool input = direction == AudioDirection::input;
    std::vector<AudioEndpointInfo> endpoints;
    bool discoveryFailed = false;
    try {
        endpoints = input ? listWasapiCaptureEndpoints() : listWasapiRenderEndpoints();
    } catch (const std::runtime_error& error) {
        discoveryFailed = true;
        status(window, wide(error.what()).c_str());
    }
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    const auto& choice = input ? wasapiInputConfig.input : wasapiConfig.output;
    AppendMenuW(menu, MF_STRING | (!choice ? MF_CHECKED : 0), 1, L"Windows default");
    if (discoveryFailed) AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, L"Endpoint discovery unavailable");
    else if (choice && !findAudioEndpoint(endpoints, choice->id)) {
        const auto label = menuLabel(L"Unavailable: " + choice->name);
        AppendMenuW(menu, MF_STRING | MF_CHECKED | MF_GRAYED, 0, label.c_str());
    }
    for (std::size_t i = 0; i < endpoints.size(); ++i) {
        const auto& endpoint = endpoints[i];
        auto label = endpoint.name;
        if (std::ranges::count(endpoints, endpoint.name, &AudioEndpointInfo::name) > 1) {
            label += L" (" + std::to_wstring(i + 1) + L")";
        }
        const auto flags = MF_STRING | (choice && choice->id == endpoint.id ? MF_CHECKED : 0);
        AppendMenuW(menu, flags, i + 2, menuLabel(std::move(label)).c_str());
    }
    const auto selected = popupDeviceMenu(window, menu);
    if (!selected || capture.active()) return;
    AudioEndpointChoice next;
    if (selected > 1) next = std::move(endpoints.at(selected - 2));
    if (input) setWasapiInput(window, std::move(next));
    else setWasapiOutput(window, std::move(next));
}

void setPlaybackBackend(HWND window, bool wasapi) {
    audio.stop();
    useWasapi = wasapi;
    InvalidateRect(window, nullptr, FALSE);
    status(window, useWasapi ? L"WASAPI shared playback selected. Choose the output in Devices."
                             : L"WinMM playback selected.");
}

void setCaptureBackend(HWND window, bool wasapi) {
    useWasapiCapture = wasapi;
    status(window, wasapi ? L"WASAPI shared recording selected. Choose the input in Devices."
                          : L"WinMM recording selected.");
}

void chooseCaptureBuffer(HWND window) {
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    for (std::size_t i = 0; i < periodChoices.size(); ++i) {
        const auto frames = periodChoices[i];
        const auto name = frames ? std::to_wstring(frames) + L" frames (period request)" : L"System buffer";
        AppendMenuW(menu, MF_STRING | (wasapiInputConfig.stream.requestedFrames == frames ? MF_CHECKED : 0), i + 1, name.c_str());
    }
    const auto selected = popupDeviceMenu(window, menu);
    if (!selected || capture.active()) return;
    wasapiInputConfig.stream.requestedFrames = periodChoices.at(selected - 1);
    status(window, L"WASAPI capture buffer preference updated for the next Record.");
}

void showCaptureReport(HWND window) {
    if (!lastCaptureDiagnostics) {
        status(window, L"Record a WASAPI take to collect capture diagnostics.");
        return;
    }
    const auto& result = *lastCaptureDiagnostics;
    const auto& stream = result.report.stream;
    const auto input = result.report.requested ? L"Explicit: " + result.report.requested->name : L"Windows default";
    const auto& resolved = result.report.resolved;
    const auto& id = !resolved.id.empty() || !result.report.requested ? resolved.id : result.report.requested->id;
    const auto outcome = result.storageFailed || stream.end == CaptureEnd::interrupted ? L"Interrupted" :
                         stream.end == CaptureEnd::stopped ? L"Stopped by user" : L"Reached Session recording limit";
    const auto encoding = stream.encoding == CaptureEncoding::float32 ? L"float32" :
                          stream.encoding == CaptureEncoding::pcm16 ? L"PCM16" : L"unsupported";
    wchar_t nativeCode[16]{};
    swprintf_s(nativeCode, std::size(nativeCode), L"0x%08X", stream.nativeError);
    const auto message = std::wstring(outcome) + L"\nStage: " + wide(captureStageText(stream.stage)) +
        L"\nStream error: " + wide(captureErrorText(stream.error)) + L"\nNative status: " + nativeCode +
        L"\nStorage write failed: " + (result.storageFailed ? L"Yes" : L"No") +
        L"\n\nRequested input: " + input + L"\nResolved input: " + (resolved.name.empty() ? L"Unresolved" : resolved.name) +
        L"\nEndpoint ID: " + (id.empty() ? L"Unavailable" : id) +
        L"\n\nMix format: " + std::to_wstring(stream.rate) + L" Hz, " + std::to_wstring(stream.channels) + L" channel(s), " + encoding +
        L"\nRequested period frames (0 = system): " + std::to_wstring(stream.requestedPeriodFrames) +
        L"\nSelected custom period frames: " + std::to_wstring(stream.selectedPeriodFrames) +
        L"\nAllocated buffer frames: " + std::to_wstring(stream.bufferFrames) +
        L"\nQueued frames: " + std::to_wstring(stream.acceptedFrames) +
        L"\nVerified journal frames: " + std::to_wstring(result.verifiedFrames) +
        L"\nSilent frames: " + std::to_wstring(stream.silentFrames) +
        L"\nFirst packet flagged at frame zero: " + (stream.initialDiscontinuityFlag ? L"Yes" : L"No") +
        L"\nCompanion diagnostics file saved: " + (result.saved ? L"Yes" : L"No") +
        clockDiagnostics(stream.timing.clock);
    MessageBoxW(window, message.c_str(), L"WASAPI capture diagnostics", MB_OK | MB_ICONINFORMATION);
}

void showAudioDevices(HWND window) {
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    const std::wstring input = L"Choose WinMM input  (" + (inputChoice ? inputChoice->name : L"Windows default") + L")";
    const std::wstring output = L"Choose WinMM output  (" + (outputChoice ? outputChoice->name : L"Windows default") + L")";
    const auto wasapiOutput = menuLabel(L"Choose WASAPI output  (" +
        (wasapiConfig.output ? wasapiConfig.output->name : L"Windows default") + L")");
    const auto wasapiInput = menuLabel(L"Choose WASAPI input  (" +
        (wasapiInputConfig.input ? wasapiInputConfig.input->name : L"Windows default") + L")");
    AppendMenuW(menu, MF_STRING | (useWasapiCapture ? MF_GRAYED : 0), selectInputId, menuLabel(input).c_str());
    AppendMenuW(menu, MF_STRING | (useWasapi ? MF_GRAYED : 0), selectOutputId, menuLabel(output).c_str());
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING | (!useWasapi ? MF_CHECKED : 0), selectWaveOutId, L"Playback: WinMM");
    AppendMenuW(menu, MF_STRING | (useWasapi ? MF_CHECKED : 0), selectWasapiId, L"Playback: WASAPI shared");
    AppendMenuW(menu, MF_STRING | (!useWasapi ? MF_GRAYED : 0), selectWasapiOutputId, wasapiOutput.c_str());
    AppendMenuW(menu, MF_STRING | (!useWasapi ? MF_GRAYED : 0), selectPeriodId, L"WASAPI buffer period...");
    AppendMenuW(menu, MF_STRING, renderReportId, L"Last WASAPI playback diagnostics...");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING | (!useWasapiCapture ? MF_CHECKED : 0), selectWaveInId, L"Recording: WinMM");
    AppendMenuW(menu, MF_STRING | (useWasapiCapture ? MF_CHECKED : 0), selectWasapiCaptureId, L"Recording: WASAPI shared");
    AppendMenuW(menu, MF_STRING | (!useWasapiCapture ? MF_GRAYED : 0), selectWasapiInputId, wasapiInput.c_str());
    AppendMenuW(menu, MF_STRING | (!useWasapiCapture ? MF_GRAYED : 0), selectCaptureBufferId, L"WASAPI capture buffer...");
    AppendMenuW(menu, MF_STRING, captureReportId, L"Last WASAPI capture diagnostics...");
    const auto selected = popupDeviceMenu(window, menu);
    if (capture.active()) return;
    switch (selected) {
    case selectInputId: chooseAudioDevice(window, AudioDirection::input); break;
    case selectOutputId: chooseAudioDevice(window, AudioDirection::output); break;
    case selectWasapiOutputId: chooseWasapiEndpoint(window, AudioDirection::output); break;
    case selectWasapiInputId: chooseWasapiEndpoint(window, AudioDirection::input); break;
    case selectPeriodId: chooseWasapiPeriod(window); break;
    case selectCaptureBufferId: chooseCaptureBuffer(window); break;
    case renderReportId: showRenderReport(window); break;
    case captureReportId: showCaptureReport(window); break;
    case selectWaveInId:
    case selectWasapiCaptureId:
        setCaptureBackend(window, selected == selectWasapiCaptureId);
        break;
    case selectWaveOutId:
    case selectWasapiId:
        setPlaybackBackend(window, selected == selectWasapiId);
        break;
    }
}

void startPlayback() {
    if (useWasapi) audio.play(renderedSession(), playFrom, WAVE_MAPPER, wasapiConfig);
    else audio.play(renderedSession(), playFrom, resolveWindowsAudioEndpoint(AudioDirection::output, outputChoice));
}

void execute(HWND window, int id) {
    if (id == commandId) { showCommands(window); return; }
    if (id == queryFocusId) { SetFocus(field(window, queryId)); return; }
    if (id == focusId || id == toggleInspectorId || id == toggleBrowserId || id == toggleMixerId || id == resetLayoutId) {
        if (id == focusId) focused = !focused;
        else {
            if (id == toggleInspectorId) inspectorShown = focused || !inspectorShown;
            if (id == toggleBrowserId) browserShown = focused || !browserShown;
            if (id == toggleMixerId) mixerShown = focused || !mixerShown;
            if (id == resetLayoutId) inspectorShown = browserShown = mixerShown = true;
            focused = false;
        }
        SetDlgItemTextW(window, focusId, focused ? L"Full view" : L"Focus");
        layout(window);
        return;
    }
    if (id == stopId) {
        if (capture.active()) {
            capture.requestStop();
            status(window, L"Finishing the recording on disk...");
        } else {
            audio.stop();
            const auto rect = arrangeRect(window);
            InvalidateRect(window, &rect, FALSE);
            status(window, L"Stopped.");
        }
        return;
    }
    if (capture.active()) return;
    if (id == deviceId) { showAudioDevices(window); return; }
    if (id == newId || id == demoId) {
        if (discardEdits(window)) {
            installProject(window, id == newId ? Project{} : afterHoursProject());
            status(window, L"Session ready.");
        }
        return;
    }
    constexpr wchar_t sessionFilter[] = L"Sonoravell Session\0*.sonora\0";
    constexpr wchar_t wavFilter[] = L"PCM WAV audio\0*.wav\0";
    if (id == openId) {
        const auto path = selectFile(window, false, sessionFilter, L"sonora");
        if (!path.empty() && discardEdits(window)) {
            installProject(window, openProject(path));
            status(window, L"Opened Session.");
        }
    } else if (id == restoreSessionId) {
        const auto directory = sessionRecoveryDirectory();
        std::filesystem::create_directories(directory);
        const auto path = selectFile(window, false, sessionFilter, L"sonora", directory.c_str());
        if (!path.empty() && discardEdits(window)) {
            installProject(window, openProject(path));
            markDirty();
            refresh(window, 0);
            status(window, L"Restored checkpoint as a working Session. Use Save As to keep it.");
        }
    } else if (id == saveId) {
        const auto path = selectFile(window, true, sessionFilter, L"sonora");
        if (!path.empty()) {
            saveProject(path, project);
            dirty = false;
            autosavePending = false;
            refresh(window, selectedTrack(window));
            status(window, L"Saved Session with embedded audio.");
        }
    } else if (id == exportId) {
        const auto path = selectFile(window, true, wavFilter, L"wav");
        if (!path.empty()) {
            const auto samples = renderedSession().render(trackMutes(project));
            std::ofstream file(path, std::ios::binary);
            writeWave(file, samples);
            file.close();
            if (!file) throw std::runtime_error("Could not finish the WAV export.");
            status(window, L"Exported 48 kHz stereo WAV.");
        }
    } else if (id == playId) {
        startPlayback();
        status(window, L"Playing Session.");
    } else if (id == recoverId) {
        auto directory = takeRecoveryDirectory();
        std::filesystem::create_directories(directory);
        constexpr wchar_t takeFilter[] = L"Sonoravell recorded takes\0*.sntake\0";
        const auto path = selectFile(window, false, takeFilter, L"sntake", directory.c_str());
        if (!path.empty()) addRecoveredTake(window, recoverTake(path), false);
    } else if (id == recordId) {
        if (project.tracks.size() >= maxTracks || project.assets.size() >= maxAssets) {
            throw std::runtime_error("The Session is at its track or audio source limit.");
        }
        const auto takeTick = beatInput(window, beatId, false);
        const auto capacity = recordingCapacity(project, takeTick);
        if (!capacity) throw std::runtime_error("No recording capacity at that beat. Choose an earlier start or a smaller Session.");
        audio.stop();
        if (useWasapiCapture) capture.start(capacity, takeTick, WAVE_MAPPER, wasapiInputConfig);
        else capture.start(capacity, takeTick, resolveWindowsAudioEndpoint(AudioDirection::input, inputChoice));
        refresh(window, selectedTrack(window));
        status(window, L"Recording to local recovery storage. Press Stop to finish the take.");
    } else if (id == importId) {
        const auto path = selectFile(window, false, wavFilter, L"wav");
        if (!path.empty()) {
            const auto tick = beatInput(window, beatId, false);
            std::ifstream file(path, std::ios::binary);
            addAudio(window, readWave(file, newIdFor(project.assets), audioName(path)), tick);
            status(window, L"Imported WAV into a new track.");
        }
    } else if (id == placeId) {
        const auto source = SendMessageW(field(window, assetListId), LB_GETCURSEL, 0, 0);
        if (source < 0 || static_cast<std::size_t>(source) >= project.assets.size()) return;
        if (project.tracks.size() >= maxTracks) throw std::runtime_error("The Session is at its track limit.");
        const auto tick = beatInput(window, beatId, false);
        const auto& asset = project.assets[source];
        project.tracks.push_back({newIdFor(project.tracks), asset.name, Instrument::audio, false, 100, {}, {{asset.id, tick}}});
        edit(window, [] { project.tracks.pop_back(); }, static_cast<int>(project.tracks.size() - 1));
        status(window, L"Placed an Audio Pool source on a new track.");
    } else if (id == addTrackId) {
        if (project.tracks.size() >= maxTracks) throw std::runtime_error("The Session is at its track limit.");
        const auto id = newIdFor(project.tracks);
        project.tracks.push_back({id, "Instrument " + std::to_string(id), Instrument::keys, false, 100, {}, {}});
        edit(window, [] { project.tracks.pop_back(); }, static_cast<int>(project.tracks.size() - 1));
        status(window, L"Added an instrument. Set Start beat and Pitch, then choose Add note.");
    } else if (id == undoId) {
        revert(window);
    } else if (id == tempoApplyId) {
        const auto previous = project.tempo;
        project.tempo = value(window, tempoId, 30, 300, "Set tempo between 30 and 300 BPM.");
        edit(window, [previous] { project.tempo = previous; }, selectedTrack(window));
        status(window, L"Updated tempo.");
    } else {
        const int index = selectedTrack(window);
        if (index < 0 || index >= static_cast<int>(project.tracks.size())) return;
        auto& track = project.tracks[index];
        if (id == muteId) {
            const auto previous = track.muted;
            track.muted = IsDlgButtonChecked(window, muteId) == BST_CHECKED;
            edit(window, [index, previous] { project.tracks[index].muted = previous; }, index, false);
        } else if (id == removeId) {
            if (MessageBoxW(window, L"Remove the selected track from this Session?", L"Remove track",
                            MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON2) != IDYES) return;
            std::function<void()> restore = [index, removed = track]() mutable {
                project.tracks.insert(project.tracks.begin() + index, std::move(removed));
            };
            project.tracks.erase(project.tracks.begin() + index);
            edit(window, std::move(restore), index);
            status(window, L"Removed track. Undo can restore it.");
        } else if (id == volumeApplyId) {
            const auto previous = track.volume;
            track.volume = value(window, volumeId, 0, 100, "Enter a level from 0 to 100 percent.");
            edit(window, [index, previous] { project.tracks[index].volume = previous; }, index);
            status(window, L"Updated track level.");
        } else if ((id == noteId || id == updateNoteId || id == deleteNoteId) && track.instrument != Instrument::audio) {
            auto& notes = track.notes;
            const auto selected = SendMessageW(field(window, noteListId), CB_GETCURSEL, 0, 0);
            if (id != noteId && (selected < 0 || static_cast<std::size_t>(selected) >= notes.size())) return;
            if (id == deleteNoteId) {
                const auto removed = notes[selected];
                notes.erase(notes.begin() + selected);
                edit(window, [index, selected, removed] {
                    auto& original = project.tracks[index].notes;
                    original.insert(original.begin() + selected, removed);
                }, index);
                status(window, L"Deleted MIDI note.");
            } else {
                auto note = id == noteId ? MidiNote{0, ticksPerBeat, 60, 96} : notes[selected];
                note.tick = beatInput(window, beatId, false);
                note.length = beatInput(window, lengthId, true);
                note.pitch = static_cast<std::uint8_t>(value(window, pitchId, 0, 127, "Enter a MIDI pitch from 0 to 127."));
                if (id == noteId) {
                    notes.push_back(note);
                    edit(window, [index] { project.tracks[index].notes.pop_back(); }, index);
                    SendMessageW(field(window, noteListId), CB_SETCURSEL, notes.size() - 1, 0);
                } else {
                    const auto previous = notes[selected];
                    notes[selected] = note;
                    edit(window, [index, selected, previous] { project.tracks[index].notes[selected] = previous; }, index);
                    SendMessageW(field(window, noteListId), CB_SETCURSEL, selected, 0);
                }
                pickNote(window);
                status(window, id == noteId ? L"Added MIDI note." : L"Updated MIDI note.");
            }
        } else if (id == moveId && !track.clips.empty()) {
            const auto previous = track.clips.front().tick;
            track.clips.front().tick = beatInput(window, beatId, false);
            edit(window, [index, previous] { project.tracks[index].clips.front().tick = previous; }, index);
            status(window, L"Moved the audio clip.");
        }
    }
}

void createWorkspace(HWND window) {
    addControl(window, titleId, L"STATIC", L"");
    for (const auto& entry : {std::pair<int, const wchar_t*>{newId, L"New"}, {demoId, L"Demo"}, {openId, L"Open..."},
         {saveId, L"Save as..."}, {exportId, L"Export..."}, {focusId, L"Focus"}, {recordId, L"Record"},
         {playId, L"Play"}, {stopId, L"Stop"}, {undoId, L"Undo"}, {deviceId, L"Devices"}, {tempoApplyId, L"Set"}, {commandId, L"Commands"},
         {noteId, L"Add note"}, {updateNoteId, L"Update"}, {deleteNoteId, L"Delete"}, {moveId, L"Move audio clip"}, {removeId, L"Remove track..."},
         {importId, L"Import WAV..."}, {placeId, L"Place audio source"}, {recoverId, L"Recover take..."},
         {addTrackId, L"Add instrument"}, {volumeApplyId, L"Apply"}}) {
        addControl(window, entry.first, L"BUTTON", entry.second, WS_TABSTOP);
    }
    addControl(window, tempoLabelId, L"STATIC", L"Tempo (BPM)");
    addControl(window, tempoId, L"EDIT", L"", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, inspectorId, L"BUTTON", L"Inspector", BS_GROUPBOX);
    addControl(window, trackLabelId, L"STATIC", L"Selected track");
    addControl(window, trackListId, L"COMBOBOX", L"", WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST);
    addControl(window, beatLabelId, L"STATIC", L"Start beat (0+)");
    addControl(window, beatId, L"EDIT", L"0", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, lengthLabelId, L"STATIC", L"Length (beats)");
    addControl(window, lengthId, L"EDIT", L"1", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, noteListId, L"COMBOBOX", L"", WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST);
    addControl(window, queryId, L"EDIT", L"", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    SendMessageW(field(window, queryId), EM_SETCUEBANNER, TRUE, reinterpret_cast<LPARAM>(L"Find a command"));
    addControl(window, pitchLabelId, L"STATIC", L"MIDI pitch");
    addControl(window, pitchId, L"EDIT", L"60", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, browserId, L"BUTTON", L"Browser", BS_GROUPBOX);
    addControl(window, assetListId, L"LISTBOX", L"", WS_TABSTOP | WS_VSCROLL | LBS_NOINTEGRALHEIGHT, WS_EX_CLIENTEDGE);
    addControl(window, mixerId, L"BUTTON", L"Mixer  /  Selected track", BS_GROUPBOX);
    addControl(window, volumeLabelId, L"STATIC", L"Volume (%)");
    addControl(window, volumeId, L"EDIT", L"100", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, muteId, L"BUTTON", L"Mute track", WS_TABSTOP | BS_AUTOCHECKBOX);
    addControl(window, statusId, L"STATIC", L"Ready.");
    refresh(window, 0);
    layout(window);
    SetTimer(window, transportTimer, 40, nullptr);
}

LRESULT CALLBACK windowProc(HWND window, UINT event, WPARAM wParam, LPARAM lParam) {
    try {
        switch (event) {
        case WM_CREATE:
            createWorkspace(window);
            return 0;
        case WM_GETMINMAXINFO: {
            auto* limits = reinterpret_cast<MINMAXINFO*>(lParam);
            limits->ptMinTrackSize = {820, 600};
            return 0;
        }
        case WM_SIZE:
            layout(window);
            return 0;
        case WM_PAINT:
            drawArrangement(window);
            return 0;
        case WM_LBUTTONDOWN: {
            const auto panel = arrangeRect(window);
            const auto x = GET_X_LPARAM(lParam);
            const auto y = GET_Y_LPARAM(lParam) - (panel.top + 58);
            const auto left = panel.left + 102;
            const auto width = panel.right - left - 8;
            if (x >= left && x < left + width && y >= -27 && y < 0 && !capture.active()) {
                const auto frame = static_cast<double>(x - left) * totalFrames / width;
                const auto ticks = static_cast<unsigned>(std::lround(frame * project.tempo / (60. * sampleRate))) * ticksPerBeat;
                playFrom = frameAtTick(ticks, project.tempo);
                if (playFrom >= totalFrames) playFrom = frameAtTick(ticks - ticksPerBeat, project.tempo);
                if (audio.state() == Output::State::playing) startPlayback();
                InvalidateRect(window, &panel, FALSE);
            } else if (x >= panel.left && x < panel.right && y >= 0) {
                const int index = y / arrangementRowHeight(panel);
                if (index < static_cast<int>(project.tracks.size())) {
                    SendMessageW(field(window, trackListId), CB_SETCURSEL, index, 0);
                    refreshTrack(window);
                    InvalidateRect(window, &panel, FALSE);
                }
            }
            return 0;
        }
        case WM_COMMAND: {
            const int id = LOWORD(wParam);
            if (id == trackListId && HIWORD(wParam) == CBN_SELCHANGE) {
                refreshTrack(window);
                const auto rect = arrangeRect(window);
                InvalidateRect(window, &rect, FALSE);
            } else if (id == noteListId && HIWORD(wParam) == CBN_SELCHANGE) {
                pickNote(window);
            } else if (id != muteId || HIWORD(wParam) == BN_CLICKED) {
                auto control = field(window, id);
                if (!control || IsWindowEnabled(control)) execute(window, id);
            }
            return 0;
        }
        case WM_TIMER: {
            if (wParam != transportTimer) return 0;
            if (capture.finished()) finishTake(window);
            checkpointIfIdle(window);
            const auto state = audio.state();
            if (state == Output::State::completed || state == Output::State::failed) {
                audio.stop();
                if (state == Output::State::completed) status(window, L"Playback complete.");
                else if (const auto& report = audio.lastWasapiRun(); audio.lastPlaybackUsedWasapi() && report) {
                    status(window, renderErrorText(report->stream.error));
                } else status(window, L"Windows audio output failed.");
            }
            if (state != Output::State::stopped) {
                const auto rect = arrangeRect(window);
                InvalidateRect(window, &rect, FALSE);
            }
            return 0;
        }
        case WM_CLOSE:
            if (capture.active()) {
                capture.requestStop();
                status(window, L"Finishing the recording on disk. Close the window after the take appears.");
                return 0;
            }
            if (discardEdits(window)) {
                audio.stop();
                DestroyWindow(window);
            }
            return 0;
        case WM_DESTROY:
            KillTimer(window, transportTimer);
            PostQuitMessage(0);
            return 0;
        default:
            return DefWindowProcW(window, event, wParam, lParam);
        }
    } catch (const std::exception& error) {
        status(window, wide(error.what()).c_str());
        if (event == WM_CREATE) return -1;
        if (!capture.active()) refresh(window, selectedTrack(window));
        return 0;
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
    const auto window = CreateWindowExW(0, type.lpszClassName, L"Sonoravell Studio", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                                         CW_USEDEFAULT, CW_USEDEFAULT, 1040, 700,
                                         nullptr, nullptr, instance, nullptr);
    if (!window) return 1;
    if (std::wstring_view(GetCommandLineW()).ends_with(L" --workspace-check")) {
        if (!field(window, deviceId) ||
            resolveWindowsAudioEndpoint(AudioDirection::input, {}) != WAVE_MAPPER ||
            resolveWindowsAudioEndpoint(AudioDirection::output, {}) != WAVE_MAPPER) return 1;
        try {
            resolveWindowsAudioEndpoint(AudioDirection::input, WindowsAudioEndpoint{L"Sonoravell missing endpoint fixture", 0, 0, 0});
            return 1;
        } catch (const std::runtime_error&) {
            // A stale explicit selection must not silently open the default input.
        }
        const auto savedProject = project;
        if (useWasapi || wasapiConfig.stream.requestedFrames || wasapiConfig.output) return 1;
        setPlaybackBackend(window, true);
        setWasapiOutput(window, AudioEndpointInfo{L"{ci-output}", L"Fixture output"});
        if (!useWasapi || project != savedProject || audio.state() != Output::State::stopped ||
            !wasapiConfig.output || wasapiConfig.output->id != L"{ci-output}") return 1;
        setPlaybackBackend(window, false);
        if (useWasapi || project != savedProject || !wasapiConfig.output) return 1;
        setWasapiOutput(window, {});
        if (wasapiConfig.output || project != savedProject) return 1;
        if (useWasapiCapture || wasapiInputConfig.input || wasapiInputConfig.stream.requestedFrames) return 1;
        setCaptureBackend(window, true);
        setWasapiInput(window, AudioEndpointInfo{L"{ci-input}", L"Fixture input"});
        if (!useWasapiCapture || !wasapiInputConfig.input || wasapiInputConfig.input->id != L"{ci-input}" ||
            capture.active() || project != savedProject || useWasapi || wasapiConfig.output) return 1;
        setCaptureBackend(window, false);
        setWasapiInput(window, {});
        if (useWasapiCapture || wasapiInputConfig.input || project != savedProject) return 1;
        execute(window, newId);
        execute(window, addTrackId);
        SetDlgItemInt(window, beatId, 2, FALSE);
        SetDlgItemInt(window, pitchId, 64, FALSE);
        execute(window, noteId);
        const bool editOk = project.tracks.size() == 1 && project.tracks.front().notes.size() == 1 &&
            project.tracks.front().notes.front().tick == 2 * ticksPerBeat && project.tracks.front().notes.front().pitch == 64;
        SetDlgItemTextW(window, beatId, L"3.5");
        SetDlgItemTextW(window, lengthId, L"0.25");
        SendMessageW(window, WM_COMMAND, updateNoteId, 0);
        const auto edited = project.tracks.front().notes.front();
        const bool updateOk = edited.tick == 3360 && edited.length == 240;
        SendMessageW(window, WM_COMMAND, deleteNoteId, 0);
        const bool deleteOk = project.tracks.front().notes.empty();
        SendMessageW(window, WM_COMMAND, undoId, 0);
        const bool undoOk = project.tracks.front().notes.size() == 1 && project.tracks.front().notes.front() == edited;
        const auto before = project;
        execute(window, focusId);
        execute(window, toggleBrowserId);
        execute(window, toggleInspectorId);
        execute(window, toggleMixerId);
        execute(window, resetLayoutId);
        const bool viewOk = project == before && inspectorShown && browserShown && mixerShown &&
                            !focused && IsWindowEnabled(field(window, stopId));
        const auto area = arrangeRect(window);
        const auto x = area.left + 102 + (area.right - area.left - 110) / 2;
        SendMessageW(window, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(x, area.top + 42));
        const bool locateOk = playFrom == frameAtTick(project.bars * beatsPerBar * ticksPerBeat / 2, project.tempo);
        DestroyWindow(window);
        return editOk && updateOk && deleteOk && undoOk && viewOk && locateOk ? 0 : 1;
    }
    ShowWindow(window, show);
    ACCEL shortcuts[] = {{FVIRTKEY | FCONTROL, 'Z', undoId}, {FVIRTKEY | FCONTROL, 'O', openId},
                         {FVIRTKEY | FCONTROL | FSHIFT, 'S', saveId}, {FVIRTKEY | FCONTROL, 'F', queryFocusId}};
    const auto accelerator = CreateAcceleratorTableW(shortcuts, static_cast<int>(std::size(shortcuts)));
    MSG message{};
    int result;
    while ((result = GetMessageW(&message, nullptr, 0, 0)) > 0) {
        if (message.hwnd == field(window, queryId) && message.message == WM_KEYDOWN && message.wParam == VK_RETURN) {
            SendMessageW(window, WM_COMMAND, commandId, 0);
            continue;
        }
        if (accelerator && TranslateAcceleratorW(window, accelerator, &message)) continue;
        if (!IsDialogMessageW(window, &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    if (accelerator) DestroyAcceleratorTable(accelerator);
    return result == -1 ? 1 : static_cast<int>(message.wParam);
}
