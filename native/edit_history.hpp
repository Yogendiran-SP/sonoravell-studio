#pragma once

#include "project.hpp"

#include <array>
#include <functional>
#include <optional>
#include <utility>

namespace sonoravell {
enum class EditImpact { rebuildAudio, liveMixer };

class EditHistory {
public:
    static constexpr std::size_t limit = 24;

    // Commands operate on a draft with shared PCM. Failed validation leaves
    // the live Session and undo/redo cursor untouched.
    template<class Command>
    bool execute(Project& project, Command&& command, EditImpact impact = EditImpact::rebuildAudio) {
        Project draft = project;
        std::invoke(std::forward<Command>(command), draft);
        validateProject(draft);
        if (draft == project) return false;
        commit(project, std::move(draft), impact);
        return true;
    }

    bool canUndo() const noexcept { return cursor != 0; }
    bool canRedo() const noexcept { return cursor != count; }
    std::optional<EditImpact> undo(Project& project) noexcept;
    std::optional<EditImpact> redo(Project& project) noexcept;
    void clear() noexcept;

private:
    struct Entry {
        Project alternate;
        EditImpact impact;
    };
    void commit(Project& project, Project&& draft, EditImpact impact) noexcept;

    std::array<std::optional<Entry>, limit> entries;
    std::size_t cursor = 0, count = 0;
};
}
