#pragma once

#include "project.hpp"

namespace sonoravell {
// Autosave uses independent version-1 Session files. It never takes the path
// of an open or named project as a write target.
class SessionAutosave {
public:
    void checkpoint(const std::filesystem::path& root, const Project& project);
    void startSession() noexcept;

private:
    std::filesystem::path directory;
    bool nextSlot = false;
};
}
