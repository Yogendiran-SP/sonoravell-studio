#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <commdlg.h>
#include <mmsystem.h>

#include "duplex_qualification.hpp"
#include "arrangement.hpp"
#include "clip_edit.hpp"
#include "edit_history.hpp"
#include "session.hpp"
#include "playback_position.hpp"
#include "piano_roll.hpp"
#include "workspace_layout.hpp"
#include "session_autosave.hpp"
#include "windows_audio.hpp"
#include "windows_inserts.hpp"
#include "windows_capture.hpp"
#include "windows_devices.hpp"
#include "windows_qpc.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cwchar>
#include <cwctype>
#include <exception>
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
    startDuplexId, duplexReportId, redoId, clipListId, splitClipId, trimStartId, trimEndId, duplicateClipId, deleteClipId,
    mixerId, volumeLabelId, volumeId, volumeApplyId, muteId, statusId,
    trackNameId, renameTrackId, duplicateTrackId, trackUpId, trackDownId, addAudioTrackId, clipRangeId,
    gridBeatId, gridQuarterId, gridSixteenthId, gridOffId, placeOnTrackId,
    soloId, panLabelId, panId, masterLabelId, masterId, masterApplyId, meterId,
    beginnerLayoutId, intermediateLayoutId, advancedLayoutId, proLayoutId, arrangeLayoutId, mixLayoutId, recordLayoutId, composeLayoutId,
    loopId, rewindId, widerInspectorId, narrowerInspectorId, widerBrowserId, narrowerBrowserId,
    saveLayoutId, openLayoutId, pianoRollId, velocityUpId, velocityDownId, metronomeId, masterEffectsId
};

Project project = afterHoursProject();
std::shared_ptr<const SessionAudio> prepared;
Output audio;
Capture capture;
DuplexTransport duplex;
struct DuplexProgress {
    std::uint64_t attempt = 0;
    unsigned sessionTick = 0;
    bool inputExited = false, outputExited = false;
    std::optional<QpcTime> settledAt;
};
DuplexProgress duplexProgress;
std::wstring lastDuplexDiagnostics;
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
EditHistory history;
std::uint32_t selectedClipId = 0;
constexpr std::array gridSteps{0u, ticksPerBeat, ticksPerBeat / 4, ticksPerBeat / 16};
unsigned gridIndex = 1;
struct ClipDrag {
    std::uint32_t clipId;
    ClipEdit operation;
    unsigned anchor;
    int startX;
    unsigned target;
    bool moved = false;
};
std::optional<ClipDrag> clipDrag;
bool pianoRoll = false;
unsigned rollLowestPitch = 48;
struct NoteDrag {
    int track;
    std::size_t index;
    MidiNote initial;
    MidiNote preview;
    int startX;
    int startY;
    bool resize;
};
std::optional<NoteDrag> noteDrag;
struct CachedWaveform {
    AudioAsset asset;
    WaveformPeaks peaks;
};
std::vector<CachedWaveform> waveformCache;

void refreshWaveforms() {
    std::vector<CachedWaveform> next;
    next.reserve(project.assets.size());
    for (const auto& asset : project.assets) {
        const auto existing = std::ranges::find_if(waveformCache, [&](const CachedWaveform& entry) {
            return &asset.stereo() == &entry.asset.stereo();
        });
        next.push_back({asset, existing == waveformCache.end() ? WaveformPeaks(asset) : existing->peaks});
    }
    waveformCache.swap(next);
}
bool dirty = false;
bool autosavePending = false;
ULONGLONG autosaveAfter = 0;
SessionAutosave autosave;
bool focused = false;
bool inspectorShown = true, browserShown = true, mixerShown = true;
unsigned inspectorWidth = defaultPanelWidth, browserWidth = defaultPanelWidth;
bool workspaceCheck = false;
constexpr wchar_t workspaceKey[] = L"Software\\Sonoravell Studio";
constexpr wchar_t workspaceValue[] = L"WorkspaceLayout";
constexpr std::array workspaceLayouts{
    WorkspaceLayout{true, true, false},  // Beginner
    WorkspaceLayout{true, false, true},  // Intermediate
    WorkspaceLayout{false, true, true},  // Advanced
    WorkspaceLayout{true, true, true},   // Pro
    WorkspaceLayout{true, false, false}, // Arrange
    WorkspaceLayout{false, false, true}, // Mix
    WorkspaceLayout{true, true, true},   // Record: input setup and take recovery
    WorkspaceLayout{true, false, false, false, defaultPanelWidth + 2 * panelWidthStep} // Compose
};
unsigned playFrom = 0;
bool paused = false;
bool loopPlayback = false;
bool metronomePlayback = false;
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

int selectedTrack(HWND window);

void showInspectorEventControls(HWND window) {
    const auto index = selectedTrack(window);
    const bool audioTrack = index >= 0 && static_cast<std::size_t>(index) < project.tracks.size() &&
                            project.tracks[index].instrument == Instrument::audio;
    const bool visible = inspectorShown && !focused;
    for (int id : {pitchLabelId, pitchId, lengthLabelId, lengthId, noteListId, noteId, updateNoteId, deleteNoteId}) {
        ShowWindow(field(window, id), visible && !audioTrack ? SW_SHOW : SW_HIDE);
    }
    for (int id : {clipListId, splitClipId, trimStartId, trimEndId, moveId, duplicateClipId, deleteClipId, clipRangeId}) {
        ShowWindow(field(window, id), visible && audioTrack ? SW_SHOW : SW_HIDE);
    }
}

WorkspaceLayout currentLayout() noexcept {
    return {inspectorShown, browserShown, mixerShown, focused, inspectorWidth, browserWidth};
}

void applyLayout(const WorkspaceLayout& layout) noexcept {
    inspectorShown = layout.inspector;
    browserShown = layout.browser;
    mixerShown = layout.mixer;
    focused = layout.focus;
    inspectorWidth = layout.inspectorWidth;
    browserWidth = layout.browserWidth;
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
    for (int id : {recordId, playId, stopId, undoId, redoId}) {
        place(id, buttonX, 47, 62, 29);
        buttonX += 66;
    }
    place(tempoLabelId, 350, 53, 82, 20);
    place(tempoId, 430, 47, 52, 26);
    place(tempoApplyId, 490, 47, 57, 28);
    const int queryWidth = std::clamp(width - 765, 28, 143);
    place(loopId, 619, 47, 50, 28);
    place(deviceId, 549, 47, 66, 28);
    place(queryId, width - 96 - queryWidth, 47, queryWidth, 27);
    place(commandId, width - 91, 47, 78, 28);

    const auto show = [&](std::initializer_list<int> ids, bool visible) {
        for (int id : ids) ShowWindow(field(window, id), visible && !focused ? SW_SHOW : SW_HIDE);
    };
    show({inspectorId, trackLabelId, trackListId, beatLabelId, beatId, trackNameId, renameTrackId, removeId}, inspectorShown);
    showInspectorEventControls(window);
    show({browserId, importId, addTrackId, addAudioTrackId, assetListId, placeId, recoverId}, browserShown);
    show({mixerId, volumeLabelId, volumeId, volumeApplyId, muteId, soloId,
          panLabelId, panId, masterLabelId, masterId, masterApplyId, meterId}, mixerShown);
    const int inspectorExtra = static_cast<int>(inspectorWidth - defaultPanelWidth);
    const int browserExtra = static_cast<int>(browserWidth - defaultPanelWidth);
    place(inspectorId, 10, 91, inspectorWidth, height - 176);
    place(trackLabelId, 22, 122, 145, 18);
    place(trackListId, 22, 143, 148 + inspectorExtra, 280);
    place(beatLabelId, 22, 184, 105, 22);
    place(beatId, 126, 180, 45, 24);
    place(pitchLabelId, 22, 219, 100, 22);
    place(pitchId, 126, 215, 45, 24);
    place(lengthLabelId, 22, 251, 100, 22);
    place(lengthId, 126, 247, 45, 24);
    place(noteListId, 22, 277, 148 + inspectorExtra, 240);
    place(noteId, 22, 309, 148, 27);
    place(updateNoteId, 22, 343, 70, 27);
    place(deleteNoteId, 99, 343, 71, 27);
    place(clipListId, 22, 215, 148 + inspectorExtra, 200);
    place(splitClipId, 22, 250, 148 + inspectorExtra, 27);
    place(trimStartId, 22, 284, 70, 27);
    place(trimEndId, 99, 284, 71, 27);
    place(moveId, 22, 318, 70, 27);
    place(duplicateClipId, 99, 318, 71, 27);
    place(deleteClipId, 22, 352, 148, 27);
    place(clipRangeId, 22, 383, 148 + inspectorExtra, 25);
    place(trackNameId, 22, 412, 91, 24);
    place(renameTrackId, 116, 412, 54, 24);
    place(removeId, 22, 440, 148, 25);
    place(browserId, width - 183 - browserExtra, 91, browserWidth, height - 176);
    place(importId, width - 171 - browserExtra, 124, 148 + browserExtra, 28);
    place(addTrackId, width - 171 - browserExtra, 162, 91 + browserExtra, 28);
    place(addAudioTrackId, width - 76, 162, 53, 28);
    place(recoverId, width - 171 - browserExtra, 200, 148 + browserExtra, 28);
    place(assetListId, width - 171 - browserExtra, 242, 148 + browserExtra, height - 491);
    place(placeId, width - 171 - browserExtra, height - 241, 148 + browserExtra, 28);
    place(mixerId, 10, height - 77, width - 20, 50);
    place(volumeLabelId, 25, height - 53, 63, 18);
    place(volumeId, 88, height - 58, 38, 24);
    place(panLabelId, 136, height - 53, 26, 18);
    place(panId, 164, height - 58, 42, 24);
    place(volumeApplyId, 213, height - 60, 48, 28);
    place(muteId, 272, height - 57, 53, 23);
    place(soloId, 327, height - 57, 52, 23);
    place(masterLabelId, 393, height - 53, 65, 18);
    place(masterId, 460, height - 58, 38, 24);
    place(masterApplyId, 505, height - 60, 48, 28);
    place(meterId, 569, height - 61, width - 596, 30);
    place(statusId, 14, height - 21, width - 30, 18);
    InvalidateRect(window, nullptr, TRUE);
}

RECT arrangeRect(HWND window) {
    RECT rect{};
    GetClientRect(window, &rect);
    return {focused || !inspectorShown ? 12 : static_cast<LONG>(inspectorWidth + 17), 96,
            rect.right - (focused || !browserShown ? 12 : static_cast<LONG>(browserWidth + 17)),
            rect.bottom - (focused || !mixerShown ? 28 : 87)};
}

void fill(HDC dc, const RECT& rect, COLORREF color) {
    const auto brush = CreateSolidBrush(color);
    if (brush) {
        FillRect(dc, &rect, brush);
        DeleteObject(brush);
    }
}

void drawMasterMeter(const DRAWITEMSTRUCT& item) {
    const auto dc = item.hDC;
    const auto area = item.rcItem;
    FillRect(dc, &area, GetSysColorBrush(COLOR_BTNFACE));
    SetBkMode(dc, TRANSPARENT);
    SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
    SetTextColor(dc, GetSysColor(COLOR_BTNTEXT));
    const auto levels = audio.state() == Output::State::playing ? audio.meter() : 0u;
    for (int channel = 0; channel < 2; ++channel) {
        const auto y = area.top + channel * 14;
        TextOutW(dc, area.left + 2, y, channel ? L"R" : L"L", 1);
        RECT bar{area.left + 17, y + 4, area.right - 2, y + 11};
        FillRect(dc, &bar, GetSysColorBrush(COLOR_3DSHADOW));
        const auto peak = (levels >> (channel * 16)) & 0xffffu;
        bar.right = bar.left + static_cast<LONG>((bar.right - bar.left) * peak / 32767);
        fill(dc, bar, peak >= 32767 ? RGB(212, 79, 57) : RGB(35, 144, 112));
    }
}

int arrangementRowHeight(const RECT& panel) {
    const int height = std::max(20, static_cast<int>(panel.bottom - panel.top - 65));
    return std::min(38, height / static_cast<int>(std::max<std::size_t>(1, project.tracks.size())));
}

unsigned timelineEndTick() {
    constexpr auto clockScale = 60u * sampleRate;
    const auto end = static_cast<std::uint64_t>(totalFrames) * project.tempo * ticksPerBeat;
    return static_cast<unsigned>((end + clockScale - 1) / clockScale);
}

int timelineX(const RECT& panel, unsigned frame) {
    const int left = panel.left + 102;
    const int width = std::max(1L, panel.right - left - 8);
    return left + static_cast<int>(static_cast<std::uint64_t>(std::min(frame, totalFrames)) * width / totalFrames);
}

RECT arrangementBlock(const RECT& panel, int top, int rowHeight, unsigned first, unsigned end) {
    const int left = timelineX(panel, first);
    return {left, top + 4, std::min(static_cast<int>(panel.right - 8), std::max(left + 2, timelineX(panel, end))),
            top + rowHeight - 4};
}

void drawWaveform(HDC dc, RECT rect, const AudioClip& clip) {
    const auto item = std::ranges::find(waveformCache, clip.assetId, [](const CachedWaveform& entry) {
        return entry.asset.id;
    });
    const int width = rect.right - rect.left;
    const int height = rect.bottom - rect.top;
    if (item == waveformCache.end() || width < 4 || height < 4) return;
    const auto center = rect.top + height / 2;
    const auto ratio = [&](int x) {
        return clip.sourceFrame + static_cast<unsigned>(static_cast<std::uint64_t>(x) * clip.frameCount / width);
    };
    const auto oldPen = SelectObject(dc, GetStockObject(DC_PEN));
    SetDCPenColor(dc, RGB(233, 245, 255));
    for (int x = 1; x < width; x += 3) {
        const auto first = ratio(x - 1);
        const auto end = std::max(first + 1, ratio(std::min(x + 2, width)));
        const int half = static_cast<int>(item->peaks.peak(first, end)) * (height / 2 - 1) / 32768;
        MoveToEx(dc, rect.left + x, center - half, nullptr);
        LineTo(dc, rect.left + x, center + half + 1);
    }
    SelectObject(dc, oldPen);
}

RECT noteBox(const RECT& panel, const MidiNote& note) {
    const auto top = panel.top + 58;
    const auto height = panel.bottom - top;
    const auto row = rollPitchCount - 1 - (static_cast<int>(note.pitch) - static_cast<int>(rollLowestPitch));
    const auto left = timelineX(panel, frameAtTick(note.tick, project.tempo));
    const auto right = timelineX(panel, frameAtTick(note.tick + note.length, project.tempo));
    return {left, top + row * height / rollPitchCount, std::max(left + 2, right),
            top + (row + 1) * height / rollPitchCount};
}

const Track* rollTrack(HWND window) {
    const int index = selectedTrack(window);
    if (index < 0 || index >= static_cast<int>(project.tracks.size())) return nullptr;
    const auto& track = project.tracks[index];
    return track.instrument == Instrument::audio ? nullptr : &track;
}

std::optional<std::size_t> hitNote(HWND window, POINT point) {
    const auto panel = arrangeRect(window);
    const auto* track = rollTrack(window);
    if (!track || point.x < panel.left + 102 || point.x >= panel.right - 8 || point.y < panel.top + 58 ||
        point.y >= panel.bottom) return {};
    for (std::size_t i = track->notes.size(); i != 0; --i) {
        const auto box = noteBox(panel, track->notes[i - 1]);
        if (PtInRect(&box, point)) return i - 1;
    }
    return {};
}

void drawPianoRoll(HWND window, HDC dc, RECT panel) {
    const int left = panel.left + 102;
    const int top = panel.top + 58;
    const auto* track = rollTrack(window);
    constexpr wchar_t hint[] = L"Piano Roll   /   Ctrl+P to return";
    TextOutW(dc, panel.left + 8, panel.top + 7, hint, static_cast<int>(std::size(hint) - 1));
    if (!track) {
        constexpr wchar_t select[] = L"Select an instrument track.";
        TextOutW(dc, panel.left + 8, top, select, static_cast<int>(std::size(select) - 1));
        return;
    }
    for (int row = 0; row < rollPitchCount; ++row) {
        const auto pitch = rollLowestPitch + rollPitchCount - 1 - row;
        const auto name = std::to_wstring(pitch);
        const RECT band{panel.left + 4, top + row * (panel.bottom - top) / rollPitchCount,
                        panel.right - 8, top + (row + 1) * (panel.bottom - top) / rollPitchCount};
        if (pitch % 12 == 1 || pitch % 12 == 3 || pitch % 12 == 6 || pitch % 12 == 8 || pitch % 12 == 10) {
            FillRect(dc, &band, GetSysColorBrush(COLOR_3DLIGHT));
        }
        if (pitch % 12 == 0) TextOutW(dc, left - 38, band.top, name.c_str(), static_cast<int>(name.size()));
    }
    const auto ticks = timelineEndTick();
    const auto step = std::max(ticksPerBeat, gridSteps[gridIndex]);
    int priorX = left - 7;
    for (unsigned tick = 0; tick < ticks; tick += step) {
        const auto x = timelineX(panel, frameAtTick(tick, project.tempo));
        if (x - priorX < 7) continue;
        const RECT line{x, top, x + 1, panel.bottom};
        FillRect(dc, &line, GetSysColorBrush(COLOR_3DSHADOW));
        priorX = x;
        if (tick % (beatsPerBar * ticksPerBeat) == 0) {
            const auto label = std::to_wstring(tick / (beatsPerBar * ticksPerBeat) + 1);
            TextOutW(dc, x + 3, panel.top + 37, label.c_str(), static_cast<int>(label.size()));
        }
    }
    const auto selection = SendMessageW(field(window, noteListId), CB_GETCURSEL, 0, 0);
    for (std::size_t i = 0; i < track->notes.size(); ++i) {
        const auto& note = noteDrag && noteDrag->track == selectedTrack(window) && noteDrag->index == i
            ? noteDrag->preview : track->notes[i];
        if (note.pitch < rollLowestPitch || note.pitch >= rollLowestPitch + rollPitchCount) continue;
        const auto box = noteBox(panel, note);
        fill(dc, box, static_cast<std::size_t>(selection) == i ? RGB(30, 91, 157) : RGB(72, 80 + note.velocity, 151));
    }
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
    const int gridTop = panel.top + 58;
    const int height = std::max(20, static_cast<int>(panel.bottom - gridTop - 7));
    const int rowHeight = arrangementRowHeight(panel);
    auto ruler = RECT{left, panel.top + 31, panel.right - 8, gridTop};
    FillRect(dc, &ruler, GetSysColorBrush(COLOR_BTNFACE));
    const auto xOf = [&](unsigned frame) {
        return timelineX(panel, frame);
    };
    SetTextColor(dc, GetSysColor(COLOR_WINDOWTEXT));
    if (pianoRoll) {
        drawPianoRoll(window, dc, panel);
        const auto cursor = playbackFrame(totalFrames, playFrom,
            audio.state() == Output::State::playing ? audio.framesPlayed() : 0, loopPlayback && !duplex.active());
        const auto x = timelineX(panel, cursor);
        fill(dc, {x, ruler.top, x + 1, panel.bottom}, RGB(220, 105, 39));
        RestoreDC(dc, savedDc);
        EndPaint(window, &paint);
        return;
    }
    constexpr std::array gridLabels{L"Grid off", L"Grid 1 beat", L"Grid 1/4 beat", L"Grid 1/16 beat"};
    const std::wstring title = std::wstring(L"Arrange  |  ") + gridLabels[gridIndex];
    TextOutW(dc, panel.left + 8, panel.top + 7, title.c_str(), static_cast<int>(title.size()));
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
            const auto rect = arrangementBlock(panel, top, rowHeight, first, last);
            fill(dc, rect, track.muted ? GetSysColor(COLOR_GRAYTEXT) : color);
        };
        for (const auto& note : track.notes) {
            block(frameAtTick(note.tick, project.tempo), frameAtTick(note.tick + note.length, project.tempo), RGB(86, 185, 156));
        }
        for (const auto& clip : track.clips) {
            const auto start = frameAtTick(clip.tick, project.tempo);
            const auto rect = arrangementBlock(panel, top, rowHeight, start, start + clip.frameCount);
            const bool chosen = static_cast<int>(index) == selected && clip.id == selectedClipId;
            fill(dc, rect, chosen ? RGB(30, 91, 157) : track.muted ? GetSysColor(COLOR_GRAYTEXT) : RGB(82, 143, 207));
            drawWaveform(dc, rect, clip);
            if (chosen && rect.right - rect.left >= 14) {
                const RECT leftHandle{rect.left, rect.top, rect.left + 2, rect.bottom};
                const RECT rightHandle{rect.right - 2, rect.top, rect.right, rect.bottom};
                FillRect(dc, &leftHandle, GetSysColorBrush(COLOR_HIGHLIGHTTEXT));
                FillRect(dc, &rightHandle, GetSysColorBrush(COLOR_HIGHLIGHTTEXT));
            }
        }
        RECT line{panel.left + 5, top + rowHeight - 1, panel.right - 8, top + rowHeight};
        FillRect(dc, &line, GetSysColorBrush(COLOR_BTNFACE));
    }
    int lastLine = left - 8;
    const auto step = gridSteps[gridIndex];
    const auto endTick = timelineEndTick();
    for (unsigned tick = step; step && tick < endTick; tick += step) {
        const auto x = xOf(frameAtTick(tick, project.tempo));
        if (x - lastLine < 8) continue;
        RECT line{x, ruler.top, x + 1, ruler.bottom};
        FillRect(dc, &line, GetSysColorBrush(COLOR_3DLIGHT));
        lastLine = x;
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
    const int x = xOf(playbackFrame(totalFrames, playFrom, playing ? audio.framesPlayed() : 0, loopPlayback && !duplex.active()));
    const RECT playhead{x, ruler.top, x + (playing ? 2 : 1), gridTop + height};
    fill(dc, playhead, RGB(220, 105, 39));
    if (clipDrag && clipDrag->moved) {
        const int target = xOf(frameAtTick(clipDrag->target, project.tempo));
        const RECT guide{target, ruler.top, target + 2, gridTop + height};
        FillRect(dc, &guide, GetSysColorBrush(COLOR_HIGHLIGHT));
    }
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

void pickClip(HWND window) {
    const auto index = selectedTrack(window);
    const auto clipIndex = SendMessageW(field(window, clipListId), CB_GETCURSEL, 0, 0);
    if (index < 0 || clipIndex < 0 || static_cast<std::size_t>(index) >= project.tracks.size()) return;
    const auto& clips = project.tracks[index].clips;
    if (static_cast<std::size_t>(clipIndex) >= clips.size()) return;
    const auto& clip = clips[clipIndex];
    selectedClipId = clip.id;
    SetDlgItemTextW(window, beatId, beatText(clip.tick).c_str());
    const auto range = L"Source frames " + std::to_wstring(clip.sourceFrame) + L"–" +
                       std::to_wstring(clip.sourceFrame + clip.frameCount) + L" (end excluded)";
    SetDlgItemTextW(window, clipRangeId, range.c_str());
    const auto panel = arrangeRect(window);
    InvalidateRect(window, &panel, FALSE);
}

void refreshTrack(HWND window) {
    const int index = selectedTrack(window);
    const bool selected = index >= 0 && index < static_cast<int>(project.tracks.size());
    const bool safeToEdit = selected && !capture.active();
    for (int id : {volumeId, volumeApplyId, muteId, soloId, panId}) EnableWindow(field(window, id), safeToEdit);
    EnableWindow(field(window, beatId), !capture.active());
    bool instrument = false, audioClip = false, hasNotes = false;
    const auto noteList = field(window, noteListId);
    SendMessageW(noteList, CB_RESETCONTENT, 0, 0);
    const auto clipList = field(window, clipListId);
    SendMessageW(clipList, CB_RESETCONTENT, 0, 0);
    SetDlgItemTextW(window, clipRangeId, L"");
    SetDlgItemTextW(window, trackNameId, selected ? wide(project.tracks[index].name).c_str() : L"");
    SetDlgItemTextW(window, lengthId, L"1");
    if (selected) {
        const auto& track = project.tracks[index];
        instrument = track.instrument != Instrument::audio;
        audioClip = !track.clips.empty();
        SetDlgItemInt(window, volumeId, track.volume, FALSE);
        CheckDlgButton(window, muteId, track.muted ? BST_CHECKED : BST_UNCHECKED);
        CheckDlgButton(window, soloId, track.solo ? BST_CHECKED : BST_UNCHECKED);
        SetDlgItemInt(window, panId, static_cast<UINT>(track.pan), TRUE);
        SetDlgItemTextW(window, beatId, beatText(audioClip ? track.clips.front().tick : 0).c_str());
        int activeClip = 0;
        for (std::size_t i = 0; i < track.clips.size(); ++i) {
            const auto& clip = track.clips[i];
            const auto item = L"Clip " + std::to_wstring(clip.id) + L" | Beat " + beatText(clip.tick);
            SendMessageW(clipList, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(item.c_str()));
            if (clip.id == selectedClipId) activeClip = static_cast<int>(i);
        }
        if (audioClip) {
            SendMessageW(clipList, CB_SETCURSEL, activeClip, 0);
            pickClip(window);
        }
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
        CheckDlgButton(window, soloId, BST_UNCHECKED);
        SetDlgItemTextW(window, panId, L"");
    }
    EnableWindow(field(window, pitchId), safeToEdit && instrument);
    EnableWindow(field(window, noteId), safeToEdit && instrument);
    EnableWindow(field(window, lengthId), safeToEdit && instrument);
    for (int id : {noteListId, updateNoteId, deleteNoteId}) EnableWindow(field(window, id), safeToEdit && hasNotes);
    for (int id : {clipListId, splitClipId, trimStartId, trimEndId, moveId, duplicateClipId, deleteClipId}) {
        EnableWindow(field(window, id), safeToEdit && audioClip);
    }
    for (int id : {removeId, trackNameId, renameTrackId}) EnableWindow(field(window, id), safeToEdit);
    showInspectorEventControls(window);
}

void refreshTransport(HWND window) {
    const bool playing = audio.state() == Output::State::playing;
    SetDlgItemTextW(window, playId, playing && !capture.active() ? L"Pause" : paused ? L"Resume" : L"Play");
    CheckDlgButton(window, loopId, loopPlayback ? BST_CHECKED : BST_UNCHECKED);
    EnableWindow(field(window, loopId), !capture.active() && !playing);
}

void refresh(HWND window, int index) {
    refreshTransport(window);
    refreshWaveforms();
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
    SetDlgItemInt(window, masterId, project.masterVolume, FALSE);
    for (int id : {newId, demoId, openId, saveId, exportId, playId, recordId, importId, addTrackId, addAudioTrackId, tempoApplyId, recoverId, deviceId, masterId, masterApplyId}) {
        EnableWindow(field(window, id), !capture.active());
    }
    EnableWindow(field(window, undoId), !capture.active() && history.canUndo());
    EnableWindow(field(window, redoId), !capture.active() && history.canRedo());
    refreshTrack(window);
    refreshInsertEditor(project.masterInserts, !capture.active());
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

void applyEditedProject(HWND window, int index, EditImpact impact) {
    if (impact != EditImpact::liveMixer) {
        audio.stop();
        paused = false;
    }
    if (impact == EditImpact::rebuildAudio) prepared.reset();
    totalFrames = sessionFrames(project);
    playFrom = std::min(playFrom, totalFrames - 1);
    audio.setMixer(mixerParameters(project));
    markDirty();
    refresh(window, index);
}

void edit(HWND window, auto&& command, int index, EditImpact impact = EditImpact::rebuildAudio) {
    if (history.execute(project, std::forward<decltype(command)>(command), impact)) {
        applyEditedProject(window, index, impact);
    } else {
        refresh(window, index);
    }
}

std::uint32_t editMasterInsert(HWND window, const InsertCommand& command) {
    if (capture.active()) throw std::runtime_error("Stop recording before editing effects.");
    auto selection = command.id;
    edit(window, [&](Project& draft) { selection = editInserts(draft.masterInserts, command); }, selectedTrack(window),
         command.action == InsertAction::toggleBypass ? EditImpact::liveMixer : EditImpact::restartProcessing);
    return selection;
}

void replayEdit(HWND window, bool redo) {
    const int index = selectedTrack(window);
    const auto impact = redo ? history.redo(project) : history.undo(project);
    if (!impact) return;
    applyEditedProject(window, index, *impact);
    status(window, redo ? L"Redid the edit." : L"Undid the edit.");
}

void installProject(HWND window, Project next) {
    audio.stop();
    prepared.reset();
    project = std::move(next);
    paused = false;
    playFrom = 0;
    totalFrames = sessionFrames(project);
    playFrom = std::min(playFrom, totalFrames - 1);
    audio.setMixer(mixerParameters(project));
    dirty = false;
    autosavePending = false;
    autosave.startSession();
    history.clear();
    selectedClipId = 0;
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

const std::shared_ptr<const SessionAudio>& renderedSession() {
    if (!prepared) prepared = std::make_shared<const SessionAudio>(project);
    return prepared;
}

void addAudio(HWND window, AudioAsset asset, unsigned tick) {
    if (project.tracks.size() >= maxTracks || project.assets.size() >= maxAssets) {
        throw std::runtime_error("The Session is at its track or audio source limit.");
    }
    edit(window, [&](Project& draft) {
        const auto clip = wholeAudioClip(newAudioClipId(draft), asset, tick);
        Track track{newIdFor(draft.tracks), asset.name, Instrument::audio, false, 100, {}, {clip}};
        draft.assets.push_back(std::move(asset));
        draft.tracks.push_back(std::move(track));
    }, static_cast<int>(project.tracks.size()));
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

void finishTake(HWND window, CaptureResult result) {
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
         {addTrackId, L"Add instrument"}, {placeId, L"Place audio source on new track"}, {placeOnTrackId, L"Place audio source on selected track"}, {recoverId, L"Recover recorded take..."}, {recordId, L"Record"}, {playId, L"Play / Pause / Resume"}, {stopId, L"Stop"}, {loopId, L"Toggle loop playback"}, {rewindId, L"Seek to start"},
        {startDuplexId, L"Record with playback (experimental)"}, {duplexReportId, L"Last experimental duplex diagnostics..."},
         {exportId, L"Export WAV..."}, {undoId, L"Undo edit"}, {redoId, L"Redo edit"}, {focusId, L"Toggle Focus"}, {noteId, L"Add MIDI note"},
         {updateNoteId, L"Update MIDI note"}, {deleteNoteId, L"Delete MIDI note"}, {moveId, L"Move audio clip"},
         {trimStartId, L"Trim audio clip start"}, {trimEndId, L"Trim audio clip end"}, {splitClipId, L"Split audio clip"},
         {duplicateClipId, L"Duplicate audio clip"}, {deleteClipId, L"Delete audio clip"},
         {toggleInspectorId, L"Toggle Inspector"}, {toggleBrowserId, L"Toggle Browser"},
         {toggleMixerId, L"Toggle Mixer"}, {resetLayoutId, L"Reset workspace"},
         {addAudioTrackId, L"Add audio track"}, {renameTrackId, L"Rename track"}, {duplicateTrackId, L"Duplicate track"},
         {trackUpId, L"Move track up"}, {trackDownId, L"Move track down"},
         {gridBeatId, L"Grid: 1 beat"}, {gridQuarterId, L"Grid: 1/4 beat"}, {gridSixteenthId, L"Grid: 1/16 beat"},
         {gridOffId, L"Grid: Off"}, {beginnerLayoutId, L"Layout: Beginner"},
         {intermediateLayoutId, L"Layout: Intermediate"}, {advancedLayoutId, L"Layout: Advanced"},
         {proLayoutId, L"Layout: Pro"}, {arrangeLayoutId, L"Layout: Arrange"}, {mixLayoutId, L"Layout: Mix"},
         {recordLayoutId, L"Layout: Recording"}, {composeLayoutId, L"Layout: Composition"},
         {widerInspectorId, L"Layout: Widen Inspector"}, {narrowerInspectorId, L"Layout: Narrow Inspector"},
         {widerBrowserId, L"Layout: Widen Browser"}, {narrowerBrowserId, L"Layout: Narrow Browser"},
         {saveLayoutId, L"Save workspace layout as..."}, {openLayoutId, L"Open workspace layout..."},
         {pianoRollId, L"Toggle Piano Roll"}, {velocityUpId, L"Increase selected MIDI velocity"},
         {velocityDownId, L"Decrease selected MIDI velocity"}, {metronomeId, L"Toggle playback metronome"}, {masterEffectsId, L"Master Effects..."}}) {
        if (!query.empty() && lowercase(entry.second).find(query) == std::wstring::npos) continue;
        const auto action = field(window, entry.first);
        const bool needsIdle = entry.first == saveLayoutId || entry.first == openLayoutId || entry.first == masterEffectsId;
        const bool available = entry.first == startDuplexId ? useWasapi && useWasapiCapture && !capture.active()
            : (!needsIdle || !capture.active()) && (!action || IsWindowEnabled(action));
        AppendMenuW(menu, MF_STRING | (available ? MF_ENABLED : MF_GRAYED),
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

void execute(HWND window, int id);

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
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING | (useWasapi && useWasapiCapture ? MF_ENABLED : MF_GRAYED),
                startDuplexId, L"Record with playback (experimental)");
    AppendMenuW(menu, MF_STRING, duplexReportId, L"Last experimental duplex diagnostics...");
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
    case startDuplexId:
    case duplexReportId:
        execute(window, selected);
        break;
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

void startPlayback(HWND window) {
    auto inserts = prepareInserts(project);
    audio.setMixer(mixerParameters(project));
    if (useWasapi) audio.play(renderedSession(), std::move(inserts), playFrom, WAVE_MAPPER, wasapiConfig, {}, loopPlayback, metronomePlayback);
    else audio.play(renderedSession(), std::move(inserts), playFrom, resolveWindowsAudioEndpoint(AudioDirection::output, outputChoice),
                    {}, {}, loopPlayback, metronomePlayback);
    paused = false;
    refreshTransport(window);
}

void applyDuplexActions(const DuplexActions& actions) {
    if (actions.stopCapture) capture.requestStop();
    if (actions.stopRender) audio.requestStop();
}

void startDuplex(HWND window, unsigned tick, unsigned capacity) {
    if (!useWasapi || !useWasapiCapture) {
        status(window, L"Select WASAPI shared for both playback and recording in Devices first.");
        return;
    }
    const auto snapshot = renderedSession();
    auto inserts = prepareInserts(project);
    auto output = wasapiConfig;
    const auto notices = std::make_shared<DuplexNotices>();
    audio.stop();
    const bool captureLaunched = capture.startDuplex(capacity, tick, wasapiInputConfig, duplex, notices);
    duplexProgress = {notices->attempt(), tick};
    paused = false;
    playFrom = frameAtTick(tick, project.tempo);
    if (captureLaunched) {
        try {
            audio.setMixer(mixerParameters(project));
            audio.play(snapshot, std::move(inserts), playFrom, WAVE_MAPPER, std::move(output), notices);
        } catch (...) {
            notices->renderExited(RenderError::driver);
        }
    } else {
        notices->renderExited(RenderError::none);
    }
    refresh(window, selectedTrack(window));
    status(window, L"Starting experimental playback and recording. Press Stop to finish the take.");
}

std::wstring duplexEndpoint(const AudioEndpointInfo* resolved, const AudioEndpointChoice& requested) {
    if (resolved && !resolved->id.empty()) return resolved->name + L" (" + resolved->id + L")";
    if (requested) return requested->name + L" (" + requested->id + L")";
    return L"Windows default (unresolved)";
}

void pollDuplex(HWND window) {
    const auto previous = duplex.state();
    const auto update = duplex.poll();
    applyDuplexActions(update.actions);
    if (update.renderExited) audio.stop();
    const auto outcome = duplex.outcome();
    if (update.renderExited && outcome.renderError != RenderError::none && !update.actions.takeReady) {
        status(window, L"WASAPI output failed. Capture can continue. See duplex diagnostics after Stop.");
    } else if (duplex.state() != previous) {
        if (duplex.state() == DuplexState::running) status(window, L"Playing the Session and recording an experimental take.");
        if (duplex.state() == DuplexState::captureOnly) status(window, L"Playback ended. Recording continues until Stop or the take limit.");
    }
    duplexProgress.inputExited |= update.captureExited;
    duplexProgress.outputExited |= update.renderExited;
    if ((update.captureExited || update.renderExited) && duplexProgress.inputExited && duplexProgress.outputExited) {
        duplexProgress.settledAt = WindowsQpc{}.now();
    }
    if (!update.actions.takeReady) return;

    CaptureResult result;
    try {
        result = capture.finish();
    } catch (...) {
        duplex.retire();
        throw;
    }
    duplex.retire();
    const auto& render = audio.lastWasapiRun();
    const auto* pairedOutput = render && render->clock.attempt() == duplexProgress.attempt ? &*render : nullptr;
    const auto* input = result.wasapi ? &*result.wasapi : nullptr;
    const auto relation = input && pairedOutput && duplexProgress.settledAt
        ? correlateClocks(input->stream.timing.clock, pairedOutput->clock, *duplexProgress.settledAt) : std::nullopt;
    const auto exported = input && pairedOutput && duplexProgress.settledAt && !outcome.storageFailed
        ? saveDuplexQualificationEvidence(result.path, result.take, playFrom, input->stream, pairedOutput->stream,
                                           pairedOutput->clock, *duplexProgress.settledAt)
        : DuplexEvidenceStatus::unqualified;
    const auto inputLabel = duplexEndpoint(input ? &input->resolved : nullptr, wasapiInputConfig.input);
    const auto outputLabel = duplexEndpoint(pairedOutput ? &pairedOutput->resolved : nullptr, wasapiConfig.output);
    lastDuplexDiagnostics = L"Attempt: " + std::to_wstring(duplexProgress.attempt) +
        L"\nSession start tick: " + std::to_wstring(duplexProgress.sessionTick) +
        L"\nSession playback start frame: " + std::to_wstring(playFrom) +
        L"\nInput: " + inputLabel + L"\nInput error: " + wide(captureErrorText(outcome.captureError)) +
        L"\nOutput: " + outputLabel + L"\nOutput error: " + renderErrorText(outcome.renderError) +
        L"\nStorage write failed: " + (outcome.storageFailed ? L"Yes" : L"No") +
        L"\nVerified take frames: " + std::to_wstring(result.take.stereo.size() / channelCount) +
        L"\n\nClock estimates (capture relative to output): " + (relation
            ? L"start offset " + std::to_wstring(relation->captureStartOffsetSeconds * 1000.0) + L" ms, drift " +
                std::to_wstring(relation->captureRelativeDriftPpm) + L" ppm" : L"insufficient qualified overlap") +
        L"\nRound-trip latency: unmeasured";
    lastDuplexDiagnostics += L"\nPaired clock sidecar: ";
    switch (exported) {
    case DuplexEvidenceStatus::saved: lastDuplexDiagnostics += L"Saved next to the take journal"; break;
    case DuplexEvidenceStatus::unqualified: lastDuplexDiagnostics += L"Insufficient qualified evidence"; break;
    case DuplexEvidenceStatus::writeFailed: lastDuplexDiagnostics += L"Could not write evidence. The take is available."; break;
    }
    if (input) {
        const auto& stream = input->stream;
        lastDuplexDiagnostics += L"\nInput buffer request / selected / allocated (frames): " +
            std::to_wstring(stream.requestedPeriodFrames) + L" / " + std::to_wstring(stream.selectedPeriodFrames) +
            L" / " + std::to_wstring(stream.bufferFrames);
    }
    if (pairedOutput) {
        const auto& stream = pairedOutput->stream;
        lastDuplexDiagnostics += L"\nOutput buffer request / selected / allocated (frames): " +
            std::to_wstring(stream.requestedFrames) + L" / " + std::to_wstring(stream.selectedPeriodFrames) +
            L" / " + std::to_wstring(stream.bufferFrames) +
            L"\nEmpty render-buffer events (suspected underruns): " + std::to_wstring(stream.emptyBufferEvents);
    }
    if (input) lastDuplexDiagnostics += L"\n\nInput clock" + clockDiagnostics(input->stream.timing.clock);
    if (pairedOutput) lastDuplexDiagnostics += L"\n\nOutput clock" + clockDiagnostics(pairedOutput->clock);
    const bool recovered = !result.take.stereo.empty();
    finishTake(window, std::move(result));
    if (outcome.storageFailed || outcome.captureError != CaptureError::none || outcome.renderError != RenderError::none) {
        status(window, recovered ? L"Experimental take recovered. See duplex diagnostics for endpoint and storage errors."
                                 : L"Experimental take stopped without recoverable audio. See duplex diagnostics.");
    }
}

void loadCurrentLayout() {
    if (workspaceCheck) return;
    WorkspaceBytes buffer{};
    DWORD size = static_cast<DWORD>(buffer.size());
    if (RegGetValueW(HKEY_CURRENT_USER, workspaceKey, workspaceValue, RRF_RT_REG_BINARY, nullptr,
                    buffer.data(), &size) == ERROR_SUCCESS && size == buffer.size()) {
        if (const auto saved = decodeWorkspace(std::span(buffer).first(size))) applyLayout(*saved);
    }
}

void showLayout(HWND window) {
    SetDlgItemTextW(window, focusId, focused ? L"Full view" : L"Focus");
    layout(window);
}

void changeLayout(HWND window) {
    showLayout(window);
    if (workspaceCheck) return;
    const auto bytes = encodeWorkspace(currentLayout());
    HKEY key = nullptr;
    auto result = RegCreateKeyExW(HKEY_CURRENT_USER, workspaceKey, 0, nullptr, REG_OPTION_NON_VOLATILE,
                                 KEY_SET_VALUE, nullptr, &key, nullptr);
    if (result == ERROR_SUCCESS) {
        result = RegSetValueExW(key, workspaceValue, 0, REG_BINARY, bytes.data(), static_cast<DWORD>(bytes.size()));
        RegCloseKey(key);
    }
    if (result != ERROR_SUCCESS) status(window, L"Workspace applied. Windows could not save the local layout.");
}

void transferLayout(HWND window, bool save) {
    constexpr wchar_t filter[] = L"Sonoravell layouts (*.sonoravell-layout)\0*.sonoravell-layout\0\0";
    const auto path = selectFile(window, save, filter, L"sonoravell-layout");
    if (path.empty()) return;
    if (save) {
        const auto bytes = encodeWorkspace(currentLayout());
        const auto file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Could not create a new layout. Choose a new filename.");
        DWORD written = 0;
        const bool ok = WriteFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr) &&
                        written == bytes.size() && FlushFileBuffers(file);
        CloseHandle(file);
        if (!ok) throw std::runtime_error("Could not finish writing the layout.");
        status(window, L"Workspace layout saved.");
        return;
    }
    std::array<std::uint8_t, WorkspaceBytes{}.size() + 1> bytes{};
    std::ifstream stream(path, std::ios::binary);
    stream.read(reinterpret_cast<char*>(bytes.data()), bytes.size());
    const auto saved = decodeWorkspace(std::span(bytes).first(static_cast<std::size_t>(stream.gcount())));
    if (!saved || stream.bad()) throw std::runtime_error("Invalid or unsupported workspace layout.");
    applyLayout(*saved);
    changeLayout(window);
}

void clearClipDrag(HWND window) {
    if (!clipDrag) return;
    clipDrag.reset();
    if (GetCapture() == window) ReleaseCapture();
    const auto panel = arrangeRect(window);
    InvalidateRect(window, &panel, FALSE);
}

void updateClipDrag(HWND window, int x) {
    if (!clipDrag) return;
    const auto delta = x - clipDrag->startX;
    if (std::abs(delta) < 4) {
        clipDrag->moved = false;
    } else {
        const auto panel = arrangeRect(window);
        const unsigned bound = clipDrag->operation == ClipEdit::trimEnd ? maxTimelineTick + 1 : maxTimelineTick;
        clipDrag->target = dragTimelineTick(clipDrag->anchor, delta, panel.right - panel.left - 110,
                                            timelineEndTick(), bound, gridSteps[gridIndex]);
        clipDrag->moved = clipDrag->target != clipDrag->anchor;
    }
    const auto panel = arrangeRect(window);
    InvalidateRect(window, &panel, FALSE);
}

void stageClipDrag(const AudioClip& clip, const RECT& box, int x) {
    auto operation = ClipEdit::move;
    auto anchor = clip.tick;
    if (box.right - box.left >= 14) {
        if (x < box.left + 5) operation = ClipEdit::trimStart;
        else if (x >= box.right - 5) {
            operation = ClipEdit::trimEnd;
            const auto end = frameAtTick(clip.tick, project.tempo) + clip.frameCount;
            constexpr auto divisor = 60u * sampleRate;
            anchor = static_cast<unsigned>((static_cast<std::uint64_t>(end) * project.tempo * ticksPerBeat +
                                            divisor / 2) / divisor);
        }
    }
    clipDrag = ClipDrag{clip.id, operation, anchor, x, anchor};
}

void clearNoteDrag(HWND window) {
    if (!noteDrag) return;
    noteDrag.reset();
    if (GetCapture() == window) ReleaseCapture();
    const auto panel = arrangeRect(window);
    InvalidateRect(window, &panel, FALSE);
}

void selectRollNote(HWND window, std::size_t index) {
    SendMessageW(field(window, noteListId), CB_SETCURSEL, index, 0);
    pickNote(window);
}

void pianoPress(HWND window, POINT point) {
    if (capture.active() || !rollTrack(window)) return;
    const auto panel = arrangeRect(window);
    const auto top = panel.top + 58;
    const int left = panel.left + 102;
    const int width = panel.right - left - 8;
    if (point.x < left || point.x >= left + width || point.y < top || point.y >= panel.bottom) return;
    const int index = selectedTrack(window);
    if (const auto hit = hitNote(window, point)) {
        const auto note = project.tracks[index].notes[*hit];
        const auto box = noteBox(panel, note);
        noteDrag = NoteDrag{index, *hit, note, note, point.x, point.y,
                            box.right - box.left >= 12 && point.x >= box.right - 5};
        selectRollNote(window, *hit);
        SetFocus(window);
        SetCapture(window);
        if (GetCapture() != window) clearNoteDrag(window);
        InvalidateRect(window, &panel, FALSE);
        return;
    }
    const auto projected = (static_cast<std::uint64_t>(point.x - left) * timelineEndTick() + width / 2) / width;
    const auto tick = snapTimelineTick(static_cast<unsigned>(projected), maxTimelineTick, gridSteps[gridIndex]);
    const auto length = std::min(gridSteps[gridIndex] ? gridSteps[gridIndex] : ticksPerBeat / 4, maxTimelineTick - tick);
    const auto pitch = rollPitchAt(point.y - top, panel.bottom - top, rollLowestPitch);
    const auto noteIndex = project.tracks[index].notes.size();
    edit(window, [&](Project& draft) { draft.tracks[index].notes.push_back({tick, length, static_cast<std::uint8_t>(pitch), 96}); }, index);
    selectRollNote(window, noteIndex);
    SetFocus(window);
}

void updateNoteDrag(HWND window, int x, int y) {
    if (!noteDrag) return;
    const auto panel = arrangeRect(window);
    const auto top = panel.top + 58;
    const auto initial = noteDrag->initial;
    const auto startTick = noteDrag->resize ? initial.tick + initial.length : initial.tick;
    const auto dx = x - noteDrag->startX;
    const auto tick = dragTimelineTick(startTick, std::abs(dx) < 3 ? 0 : dx, panel.right - panel.left - 110,
                                       timelineEndTick(), maxTimelineTick + 1, gridSteps[gridIndex]);
    const auto originPitch = rollPitchAt(noteDrag->startY - top, panel.bottom - top, rollLowestPitch);
    const auto pointerPitch = rollPitchAt(y - top, panel.bottom - top, rollLowestPitch);
    const auto pitch = std::abs(y - noteDrag->startY) < 3 ? initial.pitch
        : std::clamp(static_cast<int>(initial.pitch + pointerPitch) - static_cast<int>(originPitch), 0, 127);
    noteDrag->preview = rollNoteEdit(initial, tick, pitch, noteDrag->resize);
    InvalidateRect(window, &panel, FALSE);
}

void editVelocity(HWND window, std::size_t note, int steps) {
    const auto* track = rollTrack(window);
    if (!track || note >= track->notes.size() || capture.active()) return;
    const int index = selectedTrack(window);
    edit(window, [=](Project& draft) { changeVelocity(draft.tracks[index].notes[note], steps); }, index);
    selectRollNote(window, note);
    status(window, (L"Velocity " + std::to_wstring(project.tracks[index].notes[note].velocity)).c_str());
}

void execute(HWND window, int id) {
    clearClipDrag(window);
    clearNoteDrag(window);
    if (id == pianoRollId) {
        pianoRoll = !pianoRoll;
        const auto panel = arrangeRect(window);
        InvalidateRect(window, &panel, FALSE);
        return;
    }
    if (id == velocityUpId || id == velocityDownId) {
        const auto note = SendMessageW(field(window, noteListId), CB_GETCURSEL, 0, 0);
        if (note >= 0) editVelocity(window, static_cast<std::size_t>(note), id == velocityUpId ? 1 : -1);
        return;
    }
    if (id == commandId) { showCommands(window); return; }
    if (id == queryFocusId) { SetFocus(field(window, queryId)); return; }
    if (id >= beginnerLayoutId && id <= composeLayoutId) {
        applyLayout(workspaceLayouts[id - beginnerLayoutId]);
        changeLayout(window);
        return;
    }
    if (id >= widerInspectorId && id <= narrowerBrowserId) {
        const bool left = id == widerInspectorId || id == narrowerInspectorId;
        auto& width = left ? inspectorWidth : browserWidth;
        const bool grow = id == widerInspectorId || id == widerBrowserId;
        width = std::clamp(grow ? width + panelWidthStep : width - panelWidthStep, defaultPanelWidth, maxPanelWidth);
        changeLayout(window);
        return;
    }
    if (id == saveLayoutId || id == openLayoutId) {
        if (!capture.active()) transferLayout(window, id == saveLayoutId);
        return;
    }
    if (id == focusId || id == toggleInspectorId || id == toggleBrowserId || id == toggleMixerId || id == resetLayoutId) {
        if (id == focusId) focused = !focused;
        else {
            if (id == toggleInspectorId) inspectorShown = focused || !inspectorShown;
            if (id == toggleBrowserId) browserShown = focused || !browserShown;
            if (id == toggleMixerId) mixerShown = focused || !mixerShown;
            if (id == resetLayoutId) applyLayout({});
            focused = false;
        }
        changeLayout(window);
        return;
    }
    if (id >= gridBeatId && id <= gridOffId) {
        gridIndex = id == gridOffId ? 0 : static_cast<unsigned>(id - gridBeatId + 1);
        const auto panel = arrangeRect(window);
        InvalidateRect(window, &panel, FALSE);
        return;
    }
    if (id == stopId) {
        if (duplex.active()) {
            applyDuplexActions(duplex.stop());
            status(window, L"Stopping both streams and settling the take journal...");
        } else if (capture.active()) {
            capture.requestStop();
            status(window, L"Finishing the recording on disk...");
        } else {
            audio.stop();
            paused = false;
            refreshTransport(window);
            const auto rect = arrangeRect(window);
            InvalidateRect(window, &rect, FALSE);
            status(window, L"Stopped.");
        }
        return;
    }
    if (capture.active()) return;
    if (id == masterEffectsId) {
        showInsertEditor(window, project.masterInserts, [window](const InsertCommand& command) {
            return editMasterInsert(window, command);
        });
        return;
    }
    if (id == metronomeId) {
        if (audio.state() == Output::State::playing) {
            status(window, L"Pause or stop to change the playback metronome.");
        } else {
            metronomePlayback = !metronomePlayback;
            status(window, metronomePlayback ? L"Playback metronome on." : L"Playback metronome off.");
        }
        return;
    }
    if (id == loopId) {
        if (audio.state() != Output::State::playing) loopPlayback = !loopPlayback;
        refreshTransport(window);
        return;
    }
    if (id == rewindId) {
        playFrom = 0;
        if (audio.state() == Output::State::playing) startPlayback(window);
        const auto panel = arrangeRect(window);
        InvalidateRect(window, &panel, FALSE);
        return;
    }
    if (id == duplexReportId) {
        if (lastDuplexDiagnostics.empty()) status(window, L"Finish an experimental duplex take to view diagnostics.");
        else MessageBoxW(window, lastDuplexDiagnostics.c_str(), L"Experimental duplex diagnostics", MB_OK | MB_ICONINFORMATION);
        return;
    }
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
            const auto samples = renderedSession()->renderProject(project);
            std::ofstream file(path, std::ios::binary);
            writeWave(file, samples);
            file.close();
            if (!file) throw std::runtime_error("Could not finish the WAV export.");
            status(window, L"Exported 48 kHz stereo WAV.");
        }
    } else if (id == playId) {
        if (audio.state() == Output::State::playing) {
            audio.stop();
            playFrom = std::min(totalFrames - 1, playbackFrame(totalFrames, playFrom, audio.framesPlayed(), loopPlayback));
            paused = true;
            refreshTransport(window);
            const auto panel = arrangeRect(window);
            InvalidateRect(window, &panel, FALSE);
            status(window, L"Paused.");
            return;
        }
        startPlayback(window);
        status(window, L"Playing Session.");
    } else if (id == recoverId) {
        auto directory = takeRecoveryDirectory();
        std::filesystem::create_directories(directory);
        constexpr wchar_t takeFilter[] = L"Sonoravell recorded takes\0*.sntake\0";
        const auto path = selectFile(window, false, takeFilter, L"sntake", directory.c_str());
        if (!path.empty()) addRecoveredTake(window, recoverTake(path), false);
    } else if (id == recordId || id == startDuplexId) {
        if (project.tracks.size() >= maxTracks || project.assets.size() >= maxAssets) {
            throw std::runtime_error("The Session is at its track or audio source limit.");
        }
        const auto takeTick = beatInput(window, beatId, false);
        const auto capacity = recordingCapacity(project, takeTick);
        if (!capacity) throw std::runtime_error("No recording capacity at that beat. Choose an earlier start or a smaller Session.");
        if (id == startDuplexId) { startDuplex(window, takeTick, capacity); return; }
        audio.stop();
        paused = false;
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
    } else if (id == placeId || id == placeOnTrackId) {
        const auto source = SendMessageW(field(window, assetListId), LB_GETCURSEL, 0, 0);
        if (source < 0 || static_cast<std::size_t>(source) >= project.assets.size()) return;
        const bool newTrack = id == placeId;
        const auto destination = newTrack ? static_cast<int>(project.tracks.size()) : selectedTrack(window);
        if (newTrack && project.tracks.size() >= maxTracks) throw std::runtime_error("The Session is at its track limit.");
        if (!newTrack && (destination < 0 || project.tracks[destination].instrument != Instrument::audio)) {
            throw std::runtime_error("Select an audio track to receive the source.");
        }
        const auto tick = beatInput(window, beatId, false);
        edit(window, [&](Project& draft) {
            const auto& asset = draft.assets[source];
            const auto clip = wholeAudioClip(newAudioClipId(draft), asset, tick);
            if (newTrack) draft.tracks.push_back({newIdFor(draft.tracks), asset.name, Instrument::audio, false, 100, {}, {clip}});
            else draft.tracks[destination].clips.push_back(clip);
        }, destination);
        status(window, L"Placed a clip from the Audio Pool.");
    } else if (id == addTrackId || id == addAudioTrackId) {
        if (project.tracks.size() >= maxTracks) throw std::runtime_error("The Session is at its track limit.");
        const bool isAudio = id == addAudioTrackId;
        edit(window, [isAudio](Project& draft) {
            const auto id = newIdFor(draft.tracks);
            const auto name = (isAudio ? "Audio " : "Instrument ") + std::to_string(id);
            draft.tracks.push_back({id, name, isAudio ? Instrument::audio : Instrument::keys, false, 100, {}, {}});
        }, static_cast<int>(project.tracks.size()));
        status(window, isAudio ? L"Added an empty audio track." : L"Added an instrument. Set Start beat and Pitch, then choose Add note.");
    } else if (id == undoId || id == redoId) {
        replayEdit(window, id == redoId);
    } else if (id == masterApplyId) {
        const auto level = value(window, masterId, 0, 100, "Enter a master level from 0 to 100 percent.");
        edit(window, [level](Project& draft) { draft.masterVolume = level; }, selectedTrack(window), EditImpact::liveMixer);
        status(window, L"Updated the master level.");
    } else if (id == tempoApplyId) {
        const auto tempo = value(window, tempoId, 30, 300, "Set tempo between 30 and 300 BPM.");
        edit(window, [tempo](Project& draft) { draft.tempo = tempo; }, selectedTrack(window));
        status(window, L"Updated tempo.");
    } else {
        const int index = selectedTrack(window);
        if (index < 0 || index >= static_cast<int>(project.tracks.size())) return;
        const auto& track = project.tracks[index];
        if (id == muteId || id == soloId) {
            const auto state = IsDlgButtonChecked(window, id) == BST_CHECKED;
            edit(window, [=](Project& draft) {
                auto& selected = draft.tracks[index];
                if (id == muteId) selected.muted = state;
                else selected.solo = state;
            }, index, EditImpact::liveMixer);
        } else if (id == renameTrackId) {
            wchar_t name[202]{};
            const auto size = GetDlgItemTextW(window, trackNameId, name, static_cast<int>(std::size(name)));
            const auto bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name, size, nullptr, 0, nullptr, nullptr);
            if (bytes <= 0 || bytes > 200) throw std::runtime_error("Enter a track name of 1 to 200 UTF-8 bytes.");
            std::string utf8(bytes, '\0');
            WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name, size, utf8.data(), bytes, nullptr, nullptr);
            edit(window, [&](Project& draft) { renameTrack(draft, index, std::move(utf8)); }, index);
        } else if (id == duplicateTrackId) {
            edit(window, [index](Project& draft) { duplicateTrack(draft, index); }, index + 1);
        } else if (id == trackUpId || id == trackDownId) {
            const auto next = index + (id == trackUpId ? -1 : 1);
            if (next < 0 || next >= static_cast<int>(project.tracks.size())) return;
            edit(window, [=](Project& draft) { moveTrack(draft, index, id == trackUpId); }, next);
        } else if (id == removeId) {
            if (MessageBoxW(window, L"Remove the selected track from this Session?", L"Remove track",
                            MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON2) != IDYES) return;
            edit(window, [index](Project& draft) { draft.tracks.erase(draft.tracks.begin() + index); }, index);
            status(window, L"Removed track. Undo can restore it.");
        } else if (id == volumeApplyId) {
            const auto volume = value(window, volumeId, 0, 100, "Enter a level from 0 to 100 percent.");
            BOOL converted = FALSE;
            const auto pan = static_cast<int>(GetDlgItemInt(window, panId, &converted, TRUE));
            if (!converted || pan < -100 || pan > 100) throw std::runtime_error("Enter pan from -100 to 100.");
            edit(window, [=](Project& draft) {
                draft.tracks[index].volume = volume;
                draft.tracks[index].pan = pan;
            }, index, EditImpact::liveMixer);
            status(window, L"Updated track volume and pan.");
        } else if ((id == noteId || id == updateNoteId || id == deleteNoteId) && track.instrument != Instrument::audio) {
            const auto selected = SendMessageW(field(window, noteListId), CB_GETCURSEL, 0, 0);
            if (id != noteId && (selected < 0 || static_cast<std::size_t>(selected) >= track.notes.size())) return;
            if (id == deleteNoteId) {
                edit(window, [=](Project& draft) {
                    auto& notes = draft.tracks[index].notes;
                    notes.erase(notes.begin() + selected);
                }, index);
                status(window, L"Deleted MIDI note.");
            } else {
                auto note = id == noteId ? MidiNote{0, ticksPerBeat, 60, 96} : track.notes[selected];
                note.tick = beatInput(window, beatId, false);
                note.length = beatInput(window, lengthId, true);
                note.pitch = static_cast<std::uint8_t>(value(window, pitchId, 0, 127, "Enter a MIDI pitch from 0 to 127."));
                edit(window, [=](Project& draft) {
                    auto& notes = draft.tracks[index].notes;
                    if (id == noteId) notes.push_back(note);
                    else notes[selected] = note;
                }, index);
                const auto noteIndex = id == noteId ? project.tracks[index].notes.size() - 1 : static_cast<std::size_t>(selected);
                SendMessageW(field(window, noteListId), CB_SETCURSEL, noteIndex, 0);
                pickNote(window);
                status(window, id == noteId ? L"Added MIDI note." : L"Updated MIDI note.");
            }
        } else if (!track.clips.empty()) {
            std::optional<ClipEdit> operation;
            switch (id) {
            case moveId: operation = ClipEdit::move; break;
            case trimStartId: operation = ClipEdit::trimStart; break;
            case trimEndId: operation = ClipEdit::trimEnd; break;
            case splitClipId: operation = ClipEdit::split; break;
            case duplicateClipId: operation = ClipEdit::duplicate; break;
            case deleteClipId: operation = ClipEdit::erase; break;
            }
            if (!operation) return;
            const auto target = *operation == ClipEdit::erase ? 0 : beatInput(window, beatId, false);
            auto selection = selectedClipId;
            edit(window, [&](Project& draft) { selection = editAudioClip(draft, selectedClipId, *operation, target); }, index);
            selectedClipId = selection;
            refreshTrack(window);
            status(window, L"Updated the audio clip. The Audio Pool source is preserved.");
        }
    }
}

void createWorkspace(HWND window) {
    addControl(window, titleId, L"STATIC", L"");
    for (const auto& entry : {std::pair<int, const wchar_t*>{newId, L"New"}, {demoId, L"Demo"}, {openId, L"Open..."},
         {saveId, L"Save as..."}, {exportId, L"Export..."}, {focusId, L"Focus"}, {recordId, L"Record"},
         {playId, L"Play"}, {stopId, L"Stop"}, {undoId, L"Undo"}, {redoId, L"Redo"}, {deviceId, L"Devices"}, {tempoApplyId, L"Set"}, {commandId, L"Commands"},
         {noteId, L"Add note"}, {updateNoteId, L"Update"}, {deleteNoteId, L"Delete"}, {moveId, L"Move clip"}, {splitClipId, L"Split at beat"},
         {trimStartId, L"Trim start"}, {trimEndId, L"Trim end"}, {duplicateClipId, L"Duplicate"},
         {deleteClipId, L"Delete audio clip"}, {removeId, L"Remove track..."},
         {importId, L"Import WAV..."}, {placeId, L"Place audio source on new track"}, {placeOnTrackId, L"Place audio source on selected track"}, {recoverId, L"Recover take..."},
         {addTrackId, L"Add instrument"}, {volumeApplyId, L"Apply"}}) {
        addControl(window, entry.first, L"BUTTON", entry.second, WS_TABSTOP);
    }
    addControl(window, tempoLabelId, L"STATIC", L"Tempo (BPM)");
    addControl(window, tempoId, L"EDIT", L"", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, inspectorId, L"BUTTON", L"Inspector", BS_GROUPBOX);
    addControl(window, trackLabelId, L"STATIC", L"Selected track");
    addControl(window, trackNameId, L"EDIT", L"", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    SendMessageW(field(window, trackNameId), EM_SETLIMITTEXT, 200, 0);
    addControl(window, renameTrackId, L"BUTTON", L"Rename", WS_TABSTOP | BS_PUSHBUTTON);
    addControl(window, addAudioTrackId, L"BUTTON", L"Audio", WS_TABSTOP | BS_PUSHBUTTON);
    addControl(window, clipRangeId, L"STATIC", L"");
    addControl(window, trackListId, L"COMBOBOX", L"", WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST);
    addControl(window, beatLabelId, L"STATIC", L"Start beat (0+)");
    addControl(window, beatId, L"EDIT", L"0", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, lengthLabelId, L"STATIC", L"Length (beats)");
    addControl(window, lengthId, L"EDIT", L"1", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, noteListId, L"COMBOBOX", L"", WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST);
    addControl(window, clipListId, L"COMBOBOX", L"", WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST);
    addControl(window, queryId, L"EDIT", L"", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    SendMessageW(field(window, queryId), EM_SETCUEBANNER, TRUE, reinterpret_cast<LPARAM>(L"Find a command"));
    addControl(window, pitchLabelId, L"STATIC", L"MIDI pitch");
    addControl(window, pitchId, L"EDIT", L"60", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, browserId, L"BUTTON", L"Browser", BS_GROUPBOX);
    addControl(window, assetListId, L"LISTBOX", L"", WS_TABSTOP | WS_VSCROLL | LBS_NOINTEGRALHEIGHT, WS_EX_CLIENTEDGE);
    addControl(window, mixerId, L"BUTTON", L"Mixer  /  Selected track", BS_GROUPBOX);
    addControl(window, volumeLabelId, L"STATIC", L"Volume (%)");
    addControl(window, volumeId, L"EDIT", L"100", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, loopId, L"BUTTON", L"Loop", WS_TABSTOP | BS_CHECKBOX);
    addControl(window, muteId, L"BUTTON", L"Mute", WS_TABSTOP | BS_AUTOCHECKBOX);
    addControl(window, soloId, L"BUTTON", L"Solo", WS_TABSTOP | BS_AUTOCHECKBOX);
    addControl(window, panLabelId, L"STATIC", L"Pan");
    addControl(window, panId, L"EDIT", L"0", WS_TABSTOP | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, masterLabelId, L"STATIC", L"Master (%)");
    addControl(window, masterId, L"EDIT", L"100", WS_TABSTOP | ES_NUMBER | ES_AUTOHSCROLL, WS_EX_CLIENTEDGE);
    addControl(window, masterApplyId, L"BUTTON", L"Apply", WS_TABSTOP | BS_PUSHBUTTON);
    addControl(window, meterId, L"STATIC", L"", SS_OWNERDRAW);
    addControl(window, statusId, L"STATIC", L"Ready.");
    refresh(window, 0);
    layout(window);
    SetTimer(window, transportTimer, 40, nullptr);
}

LRESULT CALLBACK windowProc(HWND window, UINT event, WPARAM wParam, LPARAM lParam) {
    try {
        switch (event) {
        case WM_CREATE:
            loadCurrentLayout();
            createWorkspace(window);
            showLayout(window);
            return 0;
        case WM_GETMINMAXINFO: {
            auto* limits = reinterpret_cast<MINMAXINFO*>(lParam);
            limits->ptMinTrackSize = {820, 600};
            return 0;
        }
        case WM_SIZE:
            clearClipDrag(window);
            clearNoteDrag(window);
            layout(window);
            return 0;
        case WM_DRAWITEM:
            if (wParam == meterId) {
                drawMasterMeter(*reinterpret_cast<const DRAWITEMSTRUCT*>(lParam));
                return TRUE;
            }
            break;
        case WM_PAINT:
            drawArrangement(window);
            return 0;
        case WM_MOUSEMOVE:
            if (noteDrag) { updateNoteDrag(window, GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)); return 0; }
            if (clipDrag) { updateClipDrag(window, GET_X_LPARAM(lParam)); return 0; }
            break;
        case WM_LBUTTONUP:
            if (noteDrag) {
                updateNoteDrag(window, GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
                const auto drag = *noteDrag;
                clearNoteDrag(window);
                if (!capture.active() && drag.initial != drag.preview) {
                    edit(window, [=](Project& draft) { draft.tracks[drag.track].notes[drag.index] = drag.preview; }, drag.track);
                    selectRollNote(window, drag.index);
                }
                return 0;
            }
            if (clipDrag) {
                updateClipDrag(window, GET_X_LPARAM(lParam));
                const auto drag = *clipDrag;
                clearClipDrag(window);
                if (drag.moved && !capture.active()) {
                    edit(window, [&](Project& draft) { editAudioClip(draft, drag.clipId, drag.operation, drag.target); },
                         selectedTrack(window));
                    status(window, L"Updated the audio clip. Undo restores its previous position or range.");
                }
                return 0;
            }
            break;
        case WM_CAPTURECHANGED:
        case WM_CANCELMODE:
            clearClipDrag(window);
            clearNoteDrag(window);
            break;
        case WM_KEYDOWN:
            if (wParam == VK_ESCAPE && (clipDrag || noteDrag)) {
                clearClipDrag(window);
                clearNoteDrag(window);
                return 0;
            }
            if (pianoRoll && wParam == VK_DELETE) { execute(window, deleteNoteId); return 0; }
            break;
        case WM_RBUTTONDOWN:
            if (pianoRoll && !capture.active()) {
                if (const auto note = hitNote(window, {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)})) {
                    selectRollNote(window, *note);
                    execute(window, deleteNoteId);
                }
                return 0;
            }
            break;
        case WM_MOUSEWHEEL:
            if (pianoRoll && !noteDrag) {
                const auto steps = GET_WHEEL_DELTA_WPARAM(wParam) / WHEEL_DELTA;
                if (GET_KEYSTATE_WPARAM(wParam) & MK_CONTROL) {
                    rollLowestPitch = static_cast<unsigned>(std::clamp(static_cast<int>(rollLowestPitch) + 12 * steps,
                                                                        0, 128 - rollPitchCount));
                    const auto panel = arrangeRect(window);
                    InvalidateRect(window, &panel, FALSE);
                } else {
                    POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
                    ScreenToClient(window, &point);
                    if (const auto note = hitNote(window, point); note && steps) editVelocity(window, *note, steps);
                }
                return 0;
            }
            break;
        case WM_LBUTTONDOWN: {
            const auto panel = arrangeRect(window);
            const auto x = GET_X_LPARAM(lParam);
            const auto y = GET_Y_LPARAM(lParam) - (panel.top + 58);
            const auto left = panel.left + 102;
            const auto width = panel.right - left - 8;
            if (x >= left && x < left + width && y >= -27 && y < 0 && !capture.active()) {
                const auto endTick = timelineEndTick();
                const auto target = (static_cast<std::uint64_t>(x - left) * endTick + width / 2) / width;
                const auto ticks = snapTimelineTick(static_cast<unsigned>(target), endTick, gridSteps[gridIndex]);
                playFrom = std::min(totalFrames - 1, frameAtTick(ticks, project.tempo));
                if (audio.state() == Output::State::playing) startPlayback(window);
                InvalidateRect(window, &panel, FALSE);
            } else if (pianoRoll) {
                pianoPress(window, {x, y + panel.top + 58});
            } else if (x >= panel.left && x < panel.right && y >= 0 && y < panel.bottom - panel.top - 58) {
                const int index = y / arrangementRowHeight(panel);
                if (index < static_cast<int>(project.tracks.size())) {
                    SendMessageW(field(window, trackListId), CB_SETCURSEL, index, 0);
                    const auto& clips = project.tracks[index].clips;
                    const auto rowHeight = arrangementRowHeight(panel);
                    const auto top = panel.top + 58 + index * rowHeight;
                    const POINT point{x, y + panel.top + 58};
                    for (auto it = clips.rbegin(); it != clips.rend(); ++it) {
                        const auto start = frameAtTick(it->tick, project.tempo);
                        const auto box = arrangementBlock(panel, top, rowHeight, start, start + it->frameCount);
                        if (PtInRect(&box, point)) {
                            selectedClipId = it->id;
                            if (!capture.active()) {
                                SetFocus(window);
                                SetCapture(window);
                                if (GetCapture() == window) stageClipDrag(*it, box, x);
                            }
                            break;
                        }
                    }
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
            } else if (id == clipListId && HIWORD(wParam) == CBN_SELCHANGE) {
                pickClip(window);
            } else if (lParam == 0 || HIWORD(wParam) == BN_CLICKED) {
                // Edit fields emit change/focus notifications while the Inspector
                // refreshes. Only buttons, menus and accelerators invoke actions.
                const auto control = field(window, id);
                if (!control || IsWindowEnabled(control)) execute(window, id);
            }
            return 0;
        }
        case WM_TIMER: {
            if (wParam != transportTimer) return 0;
            if (!focused && mixerShown) InvalidateRect(field(window, meterId), nullptr, FALSE);
            if (duplex.active()) {
                pollDuplex(window);
                const auto rect = arrangeRect(window);
                InvalidateRect(window, &rect, FALSE);
                return 0;
            }
            if (capture.finished()) finishTake(window, capture.finish());
            checkpointIfIdle(window);
            const auto state = audio.state();
            if (state == Output::State::completed || state == Output::State::failed) {
                audio.stop();
                paused = false;
                refreshTransport(window);
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
                if (duplex.active()) applyDuplexActions(duplex.stop());
                else capture.requestStop();
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
    workspaceCheck = std::wstring_view(GetCommandLineW()).ends_with(L" --workspace-check");
    const auto window = CreateWindowExW(0, type.lpszClassName, L"Sonoravell Studio", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                                         CW_USEDEFAULT, CW_USEDEFAULT, 1040, 700,
                                         nullptr, nullptr, instance, nullptr);
    if (!window) return 1;
    if (workspaceCheck) {
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
        startDuplex(window, 0, 960);
        if (duplex.active() || capture.active() || audio.state() != Output::State::stopped || project != savedProject) return 1;
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
        SendMessageW(window, WM_COMMAND, redoId, 0);
        const bool redoOk = project.tracks.front().notes.empty();
        addAudio(window, {1, "Clip fixture", Samples(200, 1234)}, 0);
        const auto* source = project.assets.front().stereo().data();
        SetDlgItemTextW(window, beatId, L"0.001");
        SendMessageW(window, WM_COMMAND, splitClipId, 0);
        const bool splitOk = project.tracks.back().clips.size() == 2 &&
                             project.tracks.back().clips.front().frameCount == frameAtTick(1, project.tempo);
        SendMessageW(window, WM_COMMAND, undoId, 0);
        const bool clipUndoOk = project.tracks.back().clips.size() == 1;
        SendMessageW(window, WM_COMMAND, redoId, 0);
        const bool clipRedoOk = project.tracks.back().clips.size() == 2 && project.assets.front().stereo().data() == source;
        SetDlgItemTextW(window, trackNameId, L"Edited audio name");
        SendMessageW(window, WM_COMMAND, renameTrackId, 0);
        SendMessageW(window, WM_COMMAND, duplicateTrackId, 0);
        SendMessageW(window, WM_COMMAND, trackUpId, 0);
        const bool tracksOk = selectedTrack(window) == 1 && project.tracks.size() == 3 &&
            project.tracks[1].name == "Edited audio name" && project.tracks[2].name == "Edited audio name" &&
            project.tracks[1].clips.front().id != project.tracks[2].clips.front().id && waveformCache.size() == 1;
        SendMessageW(window, WM_COMMAND, gridOffId, 0);
        const auto beforeGridClick = project;
        SendMessageW(window, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(area.left + 103, area.top + 42));
        const bool snapOk = playFrom && playFrom < frameAtTick(ticksPerBeat, project.tempo) && project == beforeGridClick;
        const auto priorLayout = project;
        const auto preparedBeforeLayout = prepared;
        execute(window, beginnerLayoutId);
        const bool beginnerOk = inspectorShown && browserShown && !mixerShown;
        execute(window, mixLayoutId);
        const bool mixLayoutOk = mixerShown && !inspectorShown && !browserShown;
        execute(window, arrangeLayoutId);
        const bool arrangeLayoutOk = inspectorShown && !mixerShown && !browserShown;
        execute(window, proLayoutId);
        const bool presetsOk = beginnerOk && mixLayoutOk && arrangeLayoutOk && mixerShown &&
            inspectorShown && browserShown && prepared == preparedBeforeLayout && project == priorLayout &&
            IsWindowEnabled(field(window, stopId));
        const auto beforeMixer = renderedSession();
        SetDlgItemInt(window, panId, static_cast<UINT>(-50), TRUE);
        execute(window, volumeApplyId);
        SetDlgItemInt(window, masterId, 65, FALSE);
        execute(window, masterApplyId);
        CheckDlgButton(window, soloId, BST_CHECKED);
        execute(window, soloId);
        const bool mixerOk = project.tracks[1].pan == -50 && project.masterVolume == 65 && project.tracks[1].solo;
        execute(window, undoId);
        const bool soloUndoOk = !project.tracks[1].solo && project.masterVolume == 65 && prepared == beforeMixer;
        const auto beforeTransport = project;
        execute(window, loopId);
        const bool toggled = loopPlayback && IsDlgButtonChecked(window, loopId) == BST_CHECKED;
        execute(window, rewindId);
        const bool rewound = playFrom == 0 && project == beforeTransport && prepared == beforeMixer;
        execute(window, loopId);
        const bool transportOk = toggled && rewound && !loopPlayback;
        execute(window, composeLayoutId);
        const auto composed = currentLayout();
        execute(window, widerInspectorId);
        const auto wider = currentLayout();
        execute(window, resetLayoutId);
        const bool persistedLayoutOk = !composed.browser && composed.inspector && wider.inspectorWidth > composed.inspectorWidth &&
            decodeWorkspace(encodeWorkspace(wider)) == wider && currentLayout() == WorkspaceLayout{} &&
            project == beforeTransport && prepared == beforeMixer && IsWindowEnabled(field(window, stopId));
        const auto beforeDrag = project;
        const auto lane = arrangeRect(window);
        const auto laneTop = lane.top + 58 + arrangementRowHeight(lane);
        const auto initialClip = project.tracks[1].clips.back();
        const auto frame = frameAtTick(initialClip.tick, project.tempo);
        const auto box = arrangementBlock(lane, laneTop, arrangementRowHeight(lane), frame, frame + initialClip.frameCount);
        const int xClip = (box.left + box.right) / 2;
        stageClipDrag(initialClip, box, xClip);
        SendMessageW(window, WM_COMMAND, MAKEWPARAM(beatId, EN_CHANGE), reinterpret_cast<LPARAM>(field(window, beatId)));
        SendMessageW(window, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(xClip + 35, laneTop + 7));
        const bool dragStaged = project == beforeDrag && clipDrag && clipDrag->moved;
        SendMessageW(window, WM_LBUTTONUP, 0, MAKELPARAM(xClip + 35, laneTop + 7));
        const bool dragCommitted = project != beforeDrag && !clipDrag &&
                               project.assets.front().stereo().data() == source;
        execute(window, undoId);
        const bool gesturesOk = dragStaged && dragCommitted && project == beforeDrag;
        stageClipDrag(initialClip, box, xClip);
        SendMessageW(window, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(xClip + 35, laneTop + 7));
        SendMessageW(window, WM_CANCELMODE, 0, 0);
        const bool dragCancelled = !clipDrag && project == beforeDrag;
        SendMessageW(field(window, trackListId), CB_SETCURSEL, 0, 0);
        refreshTrack(window);
        execute(window, pianoRollId);
        const auto pianoArea = arrangeRect(window);
        const int pianoX = pianoArea.left + 155;
        const int pianoY = pianoArea.top + 80;
        SendMessageW(window, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(pianoX, pianoY));
        const bool created = project.tracks[0].notes.size() == 1;
        execute(window, velocityUpId);
        const bool velocityOk = created && project.tracks[0].notes.front().velocity == 104;
        execute(window, deleteNoteId);
        const bool pianoOk = pianoRoll && velocityOk && project.tracks[0].notes.empty();
        const auto effectSnapshot = renderedSession();
        const auto gain = editMasterInsert(window, {InsertAction::add, 0, InsertKind::gain});
        editMasterInsert(window, {InsertAction::parameter, gain, InsertKind::gain, 0, -60});
        editMasterInsert(window, {InsertAction::toggleBypass, gain});
        execute(window, undoId);
        const bool insertOk = prepared == effectSnapshot && project.masterInserts.size() == 1 &&
            project.masterInserts.front().values[0] == -60 && !project.masterInserts.front().bypassed;
        DestroyWindow(window);
        return insertOk && editOk && updateOk && deleteOk && undoOk && viewOk && locateOk && redoOk && splitOk && clipUndoOk &&
               clipRedoOk && tracksOk && snapOk && presetsOk && mixerOk && soloUndoOk && transportOk && persistedLayoutOk && gesturesOk && dragCancelled && pianoOk ? 0 : 1;
    }
    ShowWindow(window, show);
    ACCEL shortcuts[] = {{FVIRTKEY | FCONTROL, 'Z', undoId}, {FVIRTKEY | FCONTROL, 'Y', redoId},
                         {FVIRTKEY | FCONTROL | FSHIFT, 'Z', redoId}, {FVIRTKEY | FCONTROL, VK_SPACE, playId},
                         {FVIRTKEY | FCONTROL, VK_HOME, rewindId}, {FVIRTKEY | FCONTROL, 'P', pianoRollId}, {FVIRTKEY | FCONTROL, 'M', metronomeId}, {FVIRTKEY | FCONTROL, 'O', openId},
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
        if (!insertEditorMessage(message) && !IsDialogMessageW(window, &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    if (accelerator) DestroyAcceleratorTable(accelerator);
    return result == -1 ? 1 : static_cast<int>(message.wParam);
}
