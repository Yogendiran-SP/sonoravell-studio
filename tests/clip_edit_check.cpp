#include "clip_edit.hpp"
#include "session.hpp"
#include "session_autosave.hpp"

#include <fstream>
#include <iostream>
#include <limits>
#include <random>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void rejects(auto&& operation) {
    try { operation(); }
    catch (const std::runtime_error&) { return; }
    throw std::runtime_error("Expected the invalid edit or Session to be rejected.");
}

std::string v1Fixture() {
    std::string data = "SONOSESS";
    const auto number = [&](unsigned value, unsigned bytes = 4) {
        for (unsigned i = 0; i < bytes; ++i) data.push_back(static_cast<char>(value >> (8 * i)));
    };
    const auto label = [&](const std::string& value) { number(static_cast<unsigned>(value.size())); data += value; };
    number(1); label("Legacy"); number(120); number(1); number(1);
    number(7); label("Audio"); number(4, 1); number(0, 1); number(100, 1); number(0); number(2);
    number(12); number(0); number(12); number(1);
    number(1); number(12); label("Shared"); number(4);
    number(1000, 2); number(1000, 2); number(2000, 2); number(2000, 2);
    return data;
}

Project fixture() {
    Project project;
    project.bars = 1;
    Samples stereo;
    for (int i = 0; i < 100; ++i) {
        stereo.push_back(static_cast<std::int16_t>(100 * (i + 1)));
        stereo.push_back(static_cast<std::int16_t>(-100 * (i + 1)));
    }
    project.assets.push_back({1, "Source", std::move(stereo)});
    project.tracks.push_back({1, "Audio", Instrument::audio, false, 100, {},
                              {wholeAudioClip(4, project.assets.front(), 2)}});
    return project;
}

void checkEdits() {
    auto project = fixture();
    const auto original = project;
    const auto render = [](const Project& p) { return SessionAudio(p).render(mixerParameters(p)); };
    const auto expected = render(project);
    const auto first = frameAtTick(2, project.tempo);
    check(first == 50 && expected[2 * first] == 100, "Initial audio occurs at its converted tick.");
    const auto right = editAudioClip(project, 4, ClipEdit::split, 4);
    check(right != 4 && project.tracks[0].clips[0].frameCount == 50 &&
          project.tracks[0].clips[1].sourceFrame == 50 && render(project) == expected,
          "Splitting must partition the samples with no overlap or gap.");
    editAudioClip(project, right, ClipEdit::trimStart, 5);
    check(project.tracks[0].clips[1] == AudioClip{right, 1, 5, 75, 25} && render(project)[200] == 0,
          "Start trim must move the start and preserve the right boundary.");
    editAudioClip(project, right, ClipEdit::trimStart, 4);
    editAudioClip(project, right, ClipEdit::trimEnd, 5);
    check(project.tracks[0].clips[1].frameCount == 25, "End trim must preserve the source start.");
    editAudioClip(project, right, ClipEdit::trimEnd, 6);
    check(render(project) == expected, "Previously trimmed audio must remain available.");
    const auto duplicate = editAudioClip(project, right, ClipEdit::duplicate, 4);
    check(duplicate != right && render(project)[200] == 10200, "Overlapping clips must add and keep independent IDs.");
    editAudioClip(project, duplicate, ClipEdit::move, 7);
    check(render(project)[350] == 5100 && render(project)[200] == 5100, "Move must change placement only.");
    editAudioClip(project, duplicate, ClipEdit::erase);
    check(render(project) == expected && project.assets == original.assets, "Deletion must keep the source unchanged.");

    const auto before = project;
    rejects([&] { editAudioClip(project, 4, ClipEdit::trimStart, 1); });
    rejects([&] { editAudioClip(project, right, ClipEdit::trimEnd, 7); });
    rejects([&] { editAudioClip(project, right, ClipEdit::split, 6); });
    rejects([&] { editAudioClip(project, right, ClipEdit::move, maxTimelineTick); });
    rejects([&] { editAudioClip(project, 100, ClipEdit::erase); });
    check(project == before, "A failed edit must leave the entire project unchanged.");

    project.tracks[0].clips[1].sourceFrame = std::numeric_limits<std::uint32_t>::max();
    rejects([&] { validateProject(project); });
    rejects([&] { editAudioClip(project, right, ClipEdit::split, 5); });
    project = before;
    project.tracks[0].clips[1].id = 4;
    rejects([&] { validateProject(project); });
    project = before;
    project.tracks[0].clips[1].assetId = 999;
    rejects([&] { validateProject(project); });
    rejects([&] { (void)frameAtTick(std::numeric_limits<std::uint32_t>::max(), 30); });
    rejects([&] { (void)frameAtTick(1, 0); });
}

void checkMigration(const std::filesystem::path& dir) {
    const auto legacy = dir / "legacy.sonora";
    const auto bytes = v1Fixture();
    std::ofstream(legacy, std::ios::binary).write(bytes.data(), bytes.size());
    const auto migrated = openProject(legacy);
    check(migrated.tracks[0].clips == std::vector<AudioClip>{{1, 12, 0, 0, 2}, {2, 12, 1, 0, 2}},
          "V1 must get stable whole-source clips in stored order.");
    const auto rendered = SessionAudio(migrated).render(mixerParameters(migrated));
    check(rendered[0] == 1000 && rendered[2] == 2000 && rendered[50] == 1000,
          "V1 playback and source samples must be preserved.");
    rejects([&] { saveProject(legacy, migrated); });
    std::ifstream original(legacy, std::ios::binary);
    check(std::string(std::istreambuf_iterator<char>(original), {}) == bytes, "Migration must preserve the original file.");

    auto edited = fixture();
    editAudioClip(edited, 4, ClipEdit::trimStart, 3);
    const auto latest = dir / "edited.sonora";
    saveProject(latest, edited);
    check(openProject(latest) == edited, "Round-trip must persist ID, source offset, length, and timeline tick.");
    SessionAutosave autosave;
    const auto recovery = dir / "recovery";
    autosave.checkpoint(recovery, edited);
    const auto folder = std::filesystem::directory_iterator(recovery)->path();
    check(openProject(folder / "Checkpoint A.sonora") == edited, "Autosave must preserve clip ranges.");

    auto corrupt = edited;
    corrupt.tracks[0].clips[0].frameCount = std::numeric_limits<std::uint32_t>::max();
    rejects([&] { saveProject(latest, corrupt); });
    check(openProject(latest) == edited, "A failed replacement must preserve the prior Session.");
    const auto torn = dir / "interrupted.sonora";
    std::filesystem::copy_file(latest, torn);
    std::filesystem::resize_file(torn, 64);
    rejects([&] { openProject(torn); });
}
}

int main() {
    try {
        checkEdits();
        const auto dir = std::filesystem::temp_directory_path() /
                         ("sonoravell-clips-" + std::to_string(std::random_device{}()));
        check(std::filesystem::create_directory(dir), "Could not create fixture directory.");
        struct Cleanup {
            std::filesystem::path path;
            ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
        } cleanup{dir};
        checkMigration(dir);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
