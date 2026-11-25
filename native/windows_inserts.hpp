#pragma once

#include "inserts.hpp"

#include <windows.h>
#include <functional>

namespace sonoravell {
using EditInsert = std::function<std::uint32_t(const InsertCommand&)>;

void showInsertEditor(HWND owner, const InsertList& list, EditInsert edit);
void refreshInsertEditor(const InsertList& list, bool editable);
bool insertEditorMessage(MSG& message);
}
