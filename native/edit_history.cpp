#include "edit_history.hpp"

#include <type_traits>

namespace sonoravell {
static_assert(std::is_nothrow_move_constructible_v<Project> && std::is_nothrow_swappable_v<Project>);

void EditHistory::commit(Project& project, Project&& draft, EditImpact impact) noexcept {
    for (auto i = cursor; i < count; ++i) entries[i].reset();
    if (cursor == limit) {
        for (std::size_t i = 1; i < limit; ++i) entries[i - 1] = std::move(entries[i]);
        --cursor;
    }
    entries[cursor++] = Entry{std::move(project), impact};
    count = cursor;
    project = std::move(draft);
}

std::optional<EditImpact> EditHistory::undo(Project& project) noexcept {
    if (!canUndo()) return {};
    auto& entry = *entries[--cursor];
    std::swap(project, entry.alternate);
    return entry.impact;
}

std::optional<EditImpact> EditHistory::redo(Project& project) noexcept {
    if (!canRedo()) return {};
    auto& entry = *entries[cursor++];
    std::swap(project, entry.alternate);
    return entry.impact;
}

void EditHistory::clear() noexcept {
    for (auto& entry : entries) entry.reset();
    cursor = count = 0;
}
}
