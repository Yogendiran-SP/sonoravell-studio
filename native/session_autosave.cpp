#include "session_autosave.hpp"

#include <chrono>
#include <random>
#include <stdexcept>

namespace sonoravell {
void SessionAutosave::checkpoint(const std::filesystem::path& root, const Project& project) {
    if (directory.empty()) {
        std::filesystem::create_directories(root);
        const auto stamp = std::chrono::system_clock::now().time_since_epoch().count();
        for (int i = 0; i < 20; ++i) {
            const auto candidate = root / ("Session-" + std::to_string(stamp) + "-" + std::to_string(std::random_device{}()));
            if (std::filesystem::create_directory(candidate)) {
                directory = candidate;
                break;
            }
        }
        if (directory.empty()) throw std::runtime_error("Could not create a Session recovery folder.");
    }
    saveProject(directory / (nextSlot ? "Checkpoint B.sonora" : "Checkpoint A.sonora"), project);
    nextSlot = !nextSlot;
}

void SessionAutosave::startSession() noexcept {
    directory.clear();
    nextSlot = false;
}
}
