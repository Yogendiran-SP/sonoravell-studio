#include "atomic_output.hpp"
#include "session.hpp"

#include <fstream>
#include <random>
#include <sstream>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool passed, const char* reason) {
    if (!passed) throw std::runtime_error(reason);
}
void rejects(auto&& operation) {
    try { operation(); } catch (const std::exception&) { return; }
    throw std::runtime_error("Expected the output operation to fail.");
}
std::string bytes(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);
    return {std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
}
}

int main() {
    const auto root = std::filesystem::temp_directory_path() / ("sonoravell-atomic-" + std::to_string(std::random_device{}()));
    check(std::filesystem::create_directory(root), "Could not create temporary output test directory.");
    struct Cleanup {
        std::filesystem::path root;
        ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(root, ignored); }
    } cleanup{root};

    const auto project = root / "session.sonora";
    const auto wave = root / "mix.wav";
    saveProject(project, {});
    saveWave(wave, {50, 50, 60, 60});
    const auto originalProject = bytes(project);
    const auto originalWave = bytes(wave);
    rejects([&] { saveWave(project, {11, 11}); });
    rejects([&] { saveProject(wave, {}); });
    check(bytes(project) == originalProject && bytes(wave) == originalWave,
          "Cross-format replacement must preserve both existing files.");

    const auto incomplete = root / "incomplete.sonora";
    std::ofstream(incomplete, std::ios::binary).write(originalProject.data(), originalProject.size() - 1);
    const auto prior = bytes(incomplete);
    rejects([&] { saveProject(incomplete, {}); });
    check(bytes(incomplete) == prior, "An unreadable current-version Session must remain available for recovery.");

    const auto incompleteWav = root / "incomplete.wav";
    std::ofstream(incompleteWav, std::ios::binary).write(originalWave.data(), 15);
    const auto partialWave = bytes(incompleteWav);
    rejects([&] { saveWave(incompleteWav, {10, 10}); });
    check(bytes(incompleteWav) == partialWave, "An incomplete WAV must remain available for recovery.");

    rejects([&] { writeLocalFileAtomically(wave, [](std::ostream& staged) {
        staged << "partially encoded stream";
        staged.setstate(std::ios::badbit);
    }, [](std::istream&) {}); });
    check(bytes(wave) == originalWave, "Failed staged encoding must leave the previous WAV byte-identical.");
    rejects([&] { writeLocalFileAtomically(root / "new.wav", [](std::ostream& staged) {
        staged << "partially encoded stream";
        throw std::runtime_error("Injected interruption before commit.");
    }, [](std::istream&) {}); });
    check(!std::filesystem::exists(root / "new.wav"), "A failed new export must not publish partial bytes.");
    rejects([&] { saveWave(wave, {8, 9, 10}); });
    check(bytes(wave) == originalWave, "Invalid PCM must leave the prior mix available.");

    const Samples updated{90, 90};
    saveWave(wave, updated);
    std::ostringstream expected;
    writeWave(expected, updated);
    check(bytes(wave) == expected.str(), "A valid staged WAV should replace a previous WAV exactly.");
    const auto symlink = root / "alias.wav";
    std::error_code error;
    std::filesystem::create_symlink(wave, symlink, error);
    if (!error) {
        rejects([&] { saveWave(symlink, {1, 1}); });
        check(std::filesystem::is_symlink(symlink) && bytes(wave) == expected.str(), "A linked destination must remain intact.");
    }
    for (const auto& item : std::filesystem::directory_iterator(root)) {
        check(!item.path().filename().string().starts_with(".sonoravell-save-"), "A staged output leaked temporary files.");
    }
}
