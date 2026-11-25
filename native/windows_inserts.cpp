#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "windows_inserts.hpp"

#include <algorithm>
#include <cerrno>
#include <cwchar>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>

namespace sonoravell {
namespace {
enum Control { insertList = 1, typeList, add, earlier, later, remove, enable, bypass, parameterList, number, apply, notice };

HWND editor = nullptr;
InsertList view;
EditInsert commit;
std::uint32_t selection = 0;
bool editable = false;

LRESULT control(HWND window, int id, UINT message, WPARAM w = 0, LPARAM l = 0) {
    return SendDlgItemMessageW(window, id, message, w, l);
}

void addText(HWND window, int id, const wchar_t* text) {
    control(window, id, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(text));
}

const EffectInsert* selected() {
    const auto item = std::ranges::find(view, selection, &EffectInsert::id);
    return item == view.end() ? nullptr : &*item;
}

void showValue(HWND window) {
    const auto* item = selected();
    const auto parameter = control(window, parameterList, CB_GETCURSEL);
    if (!item || parameter < 0 || static_cast<std::size_t>(parameter) >= insertParameters(item->kind).size()) {
        SetDlgItemTextW(window, number, L"");
        return;
    }
    SetDlgItemInt(window, number, static_cast<UINT>(item->values[parameter]), TRUE);
    const auto& spec = insertParameters(item->kind)[parameter];
    const auto range = L"Range " + std::to_wstring(spec.minimum) + L" to " + std::to_wstring(spec.maximum);
    SetDlgItemTextW(window, notice, range.c_str());
}

void redraw(HWND window, bool resetParameter) {
    const auto parameter = resetParameter ? 0 : control(window, parameterList, CB_GETCURSEL);
    control(window, insertList, CB_RESETCONTENT);
    auto row = -1;
    for (std::size_t i = 0; i < view.size(); ++i) {
        const auto& item = view[i];
        auto label = std::to_wstring(i + 1) + L"   " + insertName(item.kind);
        if (!item.enabled) label += L" (disabled)";
        else if (item.bypassed) label += L" (bypassed)";
        addText(window, insertList, label.c_str());
        if (item.id == selection) row = static_cast<int>(i);
    }
    if (row < 0) {
        row = view.empty() ? -1 : 0;
        selection = view.empty() ? 0 : view.front().id;
    }
    control(window, insertList, CB_SETCURSEL, row);
    EnableWindow(GetDlgItem(window, add), editable && view.size() < maxInsertsPerBus);
    const auto* item = selected();
    for (int id : {remove, enable, bypass, parameterList, number, apply}) EnableWindow(GetDlgItem(window, id), editable && item);
    EnableWindow(GetDlgItem(window, earlier), editable && row > 0);
    EnableWindow(GetDlgItem(window, later), editable && row >= 0 && row + 1 < static_cast<int>(view.size()));
    SetDlgItemTextW(window, enable, item && !item->enabled ? L"Enable" : L"Disable");
    SetDlgItemTextW(window, bypass, item && item->bypassed ? L"Engage" : L"Bypass");
    control(window, parameterList, CB_RESETCONTENT);
    SetDlgItemTextW(window, notice, item ? L"" : L"Add an effect to this bus.");
    if (item) {
        const auto schema = insertParameters(item->kind);
        for (const auto& spec : schema) addText(window, parameterList, spec.label);
        control(window, parameterList, CB_SETCURSEL, std::clamp<LRESULT>(parameter, 0, schema.size() - 1));
    }
    showValue(window);
    if (!editable) SetDlgItemTextW(window, notice, L"Effect edits are locked while recording.");
}

void makeControl(HWND window, int id, const wchar_t* type, const wchar_t* title, DWORD style,
                 int x, int y, int width, int height, DWORD edge = 0) {
    const auto handle = CreateWindowExW(edge, type, title, WS_CHILD | WS_VISIBLE | style, x, y, width, height,
                                        window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
                                        GetModuleHandleW(nullptr), nullptr);
    SendMessageW(handle, WM_SETFONT, reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)), TRUE);
}

void initialize(HWND window) {
    constexpr auto combo = WS_TABSTOP | CBS_DROPDOWNLIST | WS_VSCROLL;
    makeControl(window, insertList, L"COMBOBOX", L"", combo, 12, 15, 322, 200);
    makeControl(window, earlier, L"BUTTON", L"Move up", WS_TABSTOP, 12, 46, 76, 26);
    makeControl(window, later, L"BUTTON", L"Move down", WS_TABSTOP, 94, 46, 78, 26);
    makeControl(window, enable, L"BUTTON", L"Disable", WS_TABSTOP, 178, 46, 74, 26);
    makeControl(window, bypass, L"BUTTON", L"Bypass", WS_TABSTOP, 258, 46, 76, 26);
    makeControl(window, parameterList, L"COMBOBOX", L"", combo, 12, 84, 166, 180);
    makeControl(window, number, L"EDIT", L"", WS_TABSTOP | ES_AUTOHSCROLL, 186, 83, 65, 25, WS_EX_CLIENTEDGE);
    control(window, number, EM_SETLIMITTEXT, 11);
    makeControl(window, apply, L"BUTTON", L"Apply", WS_TABSTOP, 258, 83, 76, 26);
    makeControl(window, typeList, L"COMBOBOX", L"", combo, 12, 120, 166, 150);
    makeControl(window, add, L"BUTTON", L"Add", WS_TABSTOP, 186, 119, 65, 26);
    makeControl(window, remove, L"BUTTON", L"Remove", WS_TABSTOP, 258, 119, 76, 26);
    makeControl(window, notice, L"STATIC", L"", 0, 12, 157, 322, 38);
    for (auto kind : {InsertKind::gain, InsertKind::eq, InsertKind::compressor, InsertKind::delay}) {
        addText(window, typeList, insertName(kind));
    }
    control(window, typeList, CB_SETCURSEL, 0);
}

InsertCommand action(HWND window, unsigned button) {
    switch (button) {
    case add: return {InsertAction::add, 0, static_cast<InsertKind>(control(window, typeList, CB_GETCURSEL))};
    case remove: return {InsertAction::remove, selection};
    case enable: return {InsertAction::toggleEnabled, selection};
    case bypass: return {InsertAction::toggleBypass, selection};
    case earlier: return {InsertAction::earlier, selection};
    case later: return {InsertAction::later, selection};
    case apply: {
        wchar_t buffer[16]{};
        GetDlgItemTextW(window, number, buffer, static_cast<int>(std::size(buffer)));
        wchar_t* end = nullptr;
        errno = 0;
        const auto value = std::wcstol(buffer, &end, 10);
        if (errno || end == buffer || *end || value < std::numeric_limits<int>::min() ||
            value > std::numeric_limits<int>::max()) throw std::runtime_error("Enter an integer in the listed range.");
        return {InsertAction::parameter, selection, InsertKind::gain,
                static_cast<unsigned>(control(window, parameterList, CB_GETCURSEL)), static_cast<int>(value)};
    }
    default: throw std::runtime_error("Unknown effect action.");
    }
}

LRESULT CALLBACK editorProcedure(HWND window, UINT message, WPARAM w, LPARAM l) {
    switch (message) {
    case WM_CREATE: initialize(window); return 0;
    case WM_KEYDOWN:
        if (w != VK_ESCAPE) break;
        ShowWindow(window, SW_HIDE);
        return 0;
    case WM_CLOSE: ShowWindow(window, SW_HIDE); return 0;
    case WM_NCDESTROY:
        editor = nullptr;
        commit = {};
        break;
    case WM_COMMAND:
        try {
            const auto id = LOWORD(w);
            const auto selectedRow = control(window, insertList, CB_GETCURSEL);
            if (id == insertList && HIWORD(w) == CBN_SELCHANGE && selectedRow >= 0 &&
                static_cast<std::size_t>(selectedRow) < view.size()) {
                selection = view[selectedRow].id;
                redraw(window, true);
            } else if (id == parameterList && HIWORD(w) == CBN_SELCHANGE) {
                showValue(window);
            } else if (HIWORD(w) == BN_CLICKED && editable && commit &&
                       (id == add || id == earlier || id == later || id == remove || id == enable || id == bypass || id == apply)) {
                const auto command = action(window, id);
                selection = commit(command);
                redraw(window, id == add || id == remove);
            }
        } catch (const std::exception&) {
            SetDlgItemTextW(window, notice, L"Effect edit rejected. Check the listed range or Session effect limits.");
        }
        return 0;
    }
    return DefWindowProcW(window, message, w, l);
}
}

void showInsertEditor(HWND owner, const wchar_t* title, const InsertList& list, EditInsert edit) {
    if (!editor) {
        constexpr wchar_t name[] = L"SonoravellInsertEditor";
        WNDCLASSW wc{};
        wc.lpfnWndProc = editorProcedure;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
        wc.hbrBackground = GetSysColorBrush(COLOR_BTNFACE);
        wc.lpszClassName = name;
        if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
            throw std::runtime_error("Could not initialize the Effects window.");
        }
        editor = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_CONTROLPARENT, name, title,
                                 WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                                 CW_USEDEFAULT, CW_USEDEFAULT, 364, 242, owner, nullptr, wc.hInstance, nullptr);
        if (!editor) throw std::runtime_error("Could not open the Effects window.");
    }
    SetWindowTextW(editor, title);
    commit = std::move(edit);
    selection = 0;
    refreshInsertEditor(list, true);
    ShowWindow(editor, SW_SHOW);
    SetFocus(GetDlgItem(editor, insertList));
}

void hideInsertEditor() noexcept {
    if (editor) ShowWindow(editor, SW_HIDE);
    commit = {};
    selection = 0;
}

void refreshInsertEditor(const InsertList& list, bool canEdit) {
    if (!editor) return;
    view = list;
    editable = canEdit;
    redraw(editor, false);
}

bool insertEditorMessage(MSG& message) {
    if (!editor || (message.hwnd != editor && !IsChild(editor, message.hwnd))) return false;
    if (message.message == WM_KEYDOWN && message.wParam == VK_ESCAPE) {
        ShowWindow(editor, SW_HIDE);
        return true;
    }
    return IsDialogMessageW(editor, &message) != FALSE;
}
}
