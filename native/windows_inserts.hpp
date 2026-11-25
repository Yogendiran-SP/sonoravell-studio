#pragma once

#include "inserts.hpp"

#include <windows.h>
#include <functional>

namespace sonoravell {
using EditInsert = std::function<std::uint32_t(const InsertCommand&)>;

void showInsertEditor(HWND owner, const wchar_t* title, const InsertList& list, EditInsert edit);
void hideInsertEditor() noexcept;
void refreshInsertEditor(const InsertList& list, bool editable);
bool insertEditorMessage(MSG& message);
}
