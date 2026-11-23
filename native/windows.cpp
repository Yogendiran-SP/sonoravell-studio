#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commdlg.h>
#include <mmsystem.h>

#include "session.hpp"
#include "windows_audio.hpp"

#include <algorithm>
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
    mixerId, volumeLabelId, volumeId, volumeApplyId, muteId, statusId
};

Project project = afterHoursProject();
std::unique_ptr<SessionAudio> prepared;
Output audio;
Capture capture;
std::function<void()> undo;
bool dirty = false;
bool focused = false;
unsigned takeTick = 0;
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
    place(commandId, width - 145, 47, 126, 28);

    for (int id : {inspectorId, trackLabelId, trackListId, beatLabelId, beatId, pitchLabelId, pitchId,
                   noteId, moveId, removeId, browserId, importId, addTrackId, assetListId, placeId,
                   mixerId, volumeLabelId, volumeId, volumeApplyId, muteId}) {
        ShowWindow(field(window, id), focused ? SW_HIDE : SW_SHOW);
    }
    place(inspectorId, 10, 91, 173, height - 176);
    place(trackLabelId, 22, 122, 145, 18);
    place(trackListId, 22, 143, 148, 280);
    place(beatLabelId, 22, 184, 105, 22);
    place(beatId, 126, 180, 45, 24);
    place(pitchLabelId, 22, 219, 100, 22);
    place(pitchId, 126, 215, 45, 24);
    place(noteId, 22, 252, 148, 27);
    place(moveId, 22, 289, 148, 27);
    place(removeId, 22, 326, 148, 27);
    place(browserId, width - 183, 91, 173, height - 176);
    place(importId, width - 171, 124, 148, 28);
    place(addTrackId, width - 171, 162, 148, 28);
    place(assetListId, width - 171, 209, 148, height - 458);
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
    return {focused ? 12 : 190, 96, rect.right - (focused ? 12 : 190), rect.bottom - (focused ? 28 : 87)};
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
    if (audio.state() == Output::State::playing) {
        const int x = xOf(audio.framesPlayed());
        const RECT playhead{x, ruler.top, x + 2, gridTop + height};
        fill(dc, playhead, RGB(220, 105, 39));
    }
    RestoreDC(dc, savedDc);
    EndPaint(window, &paint);
}

int selectedTrack(HWND window) {
    return static_cast<int>(SendMessageW(field(window, trackListId), CB_GETCURSEL, 0, 0));
}

void refreshTrack(HWND window) {
    const int index = selectedTrack(window);
    const bool selected = index >= 0 && index < static_cast<int>(project.tracks.size());
    const bool safeToEdit = selected && !capture.active();
    for (int id : {volumeId, volumeApplyId, muteId}) EnableWindow(field(window, id), safeToEdit);
    EnableWindow(field(window, beatId), !capture.active());
    bool instrument = false, audioClip = false;
    if (selected) {
        const auto& track = project.tracks[index];
        instrument = track.instrument != Instrument::audio;
        audioClip = !track.clips.empty();
        SetDlgItemInt(window, volumeId, track.volume, FALSE);
        CheckDlgButton(window, muteId, track.muted ? BST_CHECKED : BST_UNCHECKED);
        SetDlgItemInt(window, beatId, audioClip ? track.clips.front().tick / ticksPerBeat : 0, FALSE);
    } else {
        SetDlgItemTextW(window, volumeId, L"");
        CheckDlgButton(window, muteId, BST_UNCHECKED);
    }
    EnableWindow(field(window, pitchId), safeToEdit && instrument);
    EnableWindow(field(window, noteId), safeToEdit && instrument);
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
    for (int id : {newId, demoId, openId, saveId, exportId, playId, recordId, importId, addTrackId, tempoApplyId}) {
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

template<class Items>
std::uint32_t newIdFor(const Items& items) {
    for (std::uint32_t id = 1; id <= items.size() + 1; ++id) {
        if (std::ranges::none_of(items, [id](const auto& item) { return item.id == id; })) return id;
    }
    throw std::runtime_error("No free track or audio source ID.");
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
    audio.setMutes(trackMutes(project));
    undo = std::move(reverse);
    dirty = true;
    refresh(window, index);
}

void revert(HWND window) {
    if (!undo) return;
    const int index = selectedTrack(window);
    audio.stop();
    prepared.reset();
    undo();
    undo = {};
    dirty = true;
    totalFrames = sessionFrames(project);
    audio.setMutes(trackMutes(project));
    refresh(window, index);
    status(window, L"Undid the last edit.");
}

void installProject(HWND window, Project next) {
    audio.stop();
    prepared.reset();
    project = std::move(next);
    totalFrames = sessionFrames(project);
    audio.setMutes(trackMutes(project));
    dirty = false;
    undo = {};
    refresh(window, 0);
}

bool discardEdits(HWND window) {
    return !dirty || MessageBoxW(window, L"Discard changes since your last Session save?", L"Unsaved Session",
                                 MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON2) == IDYES;
}

std::filesystem::path selectFile(HWND window, bool save, const wchar_t* filter, const wchar_t* extension) {
    wchar_t path[32768]{};
    OPENFILENAMEW dialog{};
    dialog.lStructSize = sizeof(dialog);
    dialog.hwndOwner = window;
    dialog.lpstrFilter = filter;
    dialog.lpstrFile = path;
    dialog.nMaxFile = static_cast<DWORD>(std::size(path));
    dialog.lpstrDefExt = extension;
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

void finishTake(HWND window) {
    auto samples = capture.finish();
    if (!samples.empty()) {
        const auto id = newIdFor(project.assets);
        addAudio(window, {id, "Recording " + std::to_string(id), std::move(samples)}, takeTick);
        status(window, L"Recording added. Save Session to keep the take.");
    } else {
        refresh(window, selectedTrack(window));
        status(window, L"No microphone samples were captured.");
    }
}

void showCommands(HWND window) {
    const auto menu = CreatePopupMenu();
    if (!menu) return;
    for (const auto& entry : {std::pair<int, const wchar_t*>{newId, L"New Session"}, {demoId, L"Load demo"},
         {openId, L"Open Session..."}, {saveId, L"Save Session As..."}, {importId, L"Import WAV..."},
         {addTrackId, L"Add instrument"}, {placeId, L"Place audio source"}, {recordId, L"Record"}, {playId, L"Play"}, {stopId, L"Stop"},
         {exportId, L"Export WAV..."}, {undoId, L"Undo last edit"}, {focusId, L"Toggle Focus"}}) {
        AppendMenuW(menu, MF_STRING | (IsWindowEnabled(field(window, entry.first)) ? MF_ENABLED : MF_GRAYED),
                    entry.first, entry.second);
    }
    RECT rect{};
    GetWindowRect(field(window, commandId), &rect);
    TrackPopupMenu(menu, TPM_RIGHTALIGN | TPM_TOPALIGN, rect.right, rect.bottom, 0, window, nullptr);
    DestroyMenu(menu);
}

void execute(HWND window, int id) {
    if (id == commandId) { showCommands(window); return; }
    if (id == focusId) {
        focused = !focused;
        SetDlgItemTextW(window, focusId, focused ? L"Full view" : L"Focus");
        layout(window);
        return;
    }
    if (id == stopId) {
        if (capture.active()) finishTake(window);
        else {
            audio.stop();
            const auto rect = arrangeRect(window);
            InvalidateRect(window, &rect, FALSE);
            status(window, L"Stopped.");
        }
        return;
    }
    if (capture.active()) return;
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
    } else if (id == saveId) {
        const auto path = selectFile(window, true, sessionFilter, L"sonora");
        if (!path.empty()) {
            saveProject(path, project);
            dirty = false;
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
        audio.play(renderedSession());
        status(window, L"Playing Session.");
    } else if (id == recordId) {
        if (project.tracks.size() >= maxTracks || project.assets.size() >= maxAssets) {
            throw std::runtime_error("The Session is at its track or audio source limit.");
        }
        takeTick = value(window, beatId, 0, maxBars * beatsPerBar - 1, "Enter a valid record start beat.") * ticksPerBeat;
        const auto capacity = recordingCapacity(project, takeTick);
        if (!capacity) throw std::runtime_error("No recording capacity at that beat. Choose an earlier start or a smaller Session.");
        audio.stop();
        capture.start(capacity);
        refresh(window, selectedTrack(window));
        status(window, L"Recording the default microphone. Press Stop to keep the take.");
    } else if (id == importId) {
        const auto path = selectFile(window, false, wavFilter, L"wav");
        if (!path.empty()) {
            const auto tick = value(window, beatId, 0, maxBars * beatsPerBar - 1, "Enter a valid audio start beat.") * ticksPerBeat;
            std::ifstream file(path, std::ios::binary);
            addAudio(window, readWave(file, newIdFor(project.assets), audioName(path)), tick);
            status(window, L"Imported WAV into a new track.");
        }
    } else if (id == placeId) {
        const auto source = SendMessageW(field(window, assetListId), LB_GETCURSEL, 0, 0);
        if (source < 0 || static_cast<std::size_t>(source) >= project.assets.size()) return;
        if (project.tracks.size() >= maxTracks) throw std::runtime_error("The Session is at its track limit.");
        const auto tick = value(window, beatId, 0, maxBars * beatsPerBar - 1, "Enter a valid audio start beat.") * ticksPerBeat;
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
        } else if (id == noteId && track.instrument != Instrument::audio) {
            const auto tick = value(window, beatId, 0, maxBars * beatsPerBar - 1, "Enter a valid note start beat.") * ticksPerBeat;
            const auto pitch = value(window, pitchId, 0, 127, "Enter a MIDI pitch from 0 to 127.");
            track.notes.push_back({tick, ticksPerBeat, static_cast<std::uint8_t>(pitch), 96});
            edit(window, [index] { project.tracks[index].notes.pop_back(); }, index);
            status(window, L"Added a one-beat MIDI note.");
        } else if (id == moveId && !track.clips.empty()) {
            const auto previous = track.clips.front().tick;
            track.clips.front().tick = value(window, beatId, 0, maxBars * beatsPerBar - 1,
                                            "Enter a valid clip start beat.") * ticksPerBeat;
            edit(window, [index, previous] { project.tracks[index].clips.front().tick = previous; }, index);
            status(window, L"Moved the audio clip.");
        }
    }
}

void createWorkspace(HWND window) {
    addControl(window, titleId, L"STATIC", L"");
    for (const auto& entry : {std::pair<int, const wchar_t*>{newId, L"New"}, {demoId, L"Demo"}, {openId, L"Open..."},
         {saveId, L"Save as..."}, {exportId, L"Export..."}, {focusId, L"Focus"}, {recordId, L"Record"},
         {playId, L"Play"}, {stopId, L"Stop"}, {undoId, L"Undo"}, {tempoApplyId, L"Set"}, {commandId, L"Commands"},
         {noteId, L"Add note"}, {moveId, L"Move audio clip"}, {removeId, L"Remove track..."},
         {importId, L"Import WAV..."}, {placeId, L"Place audio source"},
         {addTrackId, L"Add instrument"}, {volumeApplyId, L"Apply"}}) {
        addControl(window, entry.first, L"BUTTON", entry.second, WS_TABSTOP);
    }
    addControl(window, tempoLabelId, L"STATIC", L"Tempo (BPM)");
    addControl(window, tempoId, L"EDIT", L"", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, inspectorId, L"BUTTON", L"Inspector", BS_GROUPBOX);
    addControl(window, trackLabelId, L"STATIC", L"Selected track");
    addControl(window, trackListId, L"COMBOBOX", L"", WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST);
    addControl(window, beatLabelId, L"STATIC", L"Start beat (0+)");
    addControl(window, beatId, L"EDIT", L"0", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
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
            if (x >= panel.left && x < panel.right && y >= 0) {
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
            } else if (id != muteId || HIWORD(wParam) == BN_CLICKED) {
                execute(window, id);
            }
            return 0;
        }
        case WM_TIMER: {
            if (wParam != transportTimer) return 0;
            if (capture.full()) finishTake(window);
            const auto state = audio.state();
            if (state == Output::State::completed || state == Output::State::failed) {
                audio.stop();
                status(window, state == Output::State::completed ? L"Playback complete." : L"Windows audio output failed.");
            }
            if (state != Output::State::stopped) {
                const auto rect = arrangeRect(window);
                InvalidateRect(window, &rect, FALSE);
            }
            return 0;
        }
        case WM_CLOSE:
            if (capture.active()) finishTake(window);
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
        execute(window, newId);
        execute(window, addTrackId);
        SetDlgItemInt(window, beatId, 2, FALSE);
        SetDlgItemInt(window, pitchId, 64, FALSE);
        execute(window, noteId);
        const bool editOk = project.tracks.size() == 1 && project.tracks.front().notes.size() == 1 &&
            project.tracks.front().notes.front().tick == 2 * ticksPerBeat && project.tracks.front().notes.front().pitch == 64;
        const auto before = project;
        execute(window, focusId);
        const bool viewOk = project == before && IsWindowEnabled(field(window, stopId));
        execute(window, undoId);
        const bool undoOk = project.tracks.front().notes.empty();
        DestroyWindow(window);
        return editOk && viewOk && undoOk ? 0 : 1;
    }
    ShowWindow(window, show);
    ACCEL shortcuts[] = {{FVIRTKEY | FCONTROL, 'Z', undoId}, {FVIRTKEY | FCONTROL, 'O', openId},
                         {FVIRTKEY | FCONTROL | FSHIFT, 'S', saveId}, {FVIRTKEY | FCONTROL, 'F', commandId}};
    const auto accelerator = CreateAcceleratorTableW(shortcuts, static_cast<int>(std::size(shortcuts)));
    MSG message{};
    int result;
    while ((result = GetMessageW(&message, nullptr, 0, 0)) > 0) {
        if (accelerator && TranslateAcceleratorW(window, accelerator, &message)) continue;
        if (!IsDialogMessageW(window, &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    if (accelerator) DestroyAcceleratorTable(accelerator);
    return result == -1 ? 1 : static_cast<int>(message.wParam);
}
