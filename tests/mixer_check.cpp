#include "edit_history.hpp"
#include "session.hpp"
#include "session_autosave.hpp"

#include <fstream>
#include <random>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool result, const char* message) {
    if (!result) throw std::runtime_error(message);
}

Project fixture() {
    Project project;
    project.bars = 1;
    project.assets.emplace_back(1, "Stereo", Samples{4000, -8000, 3000, 2000});
    project.tracks.push_back({1, "Left", Instrument::audio, false, 100, {}, {{1, 1, 0, 0, 1}}});
    project.tracks.push_back({2, "Right", Instrument::audio, false, 50, {}, {{2, 1, 0, 1, 1}}});
    return project;
}

void testMix() {
    auto project = fixture();
    project.tracks[0].pan = -100;
    project.tracks[1].pan = 100;
    project.masterVolume = 50;
    const auto render = [](const Project& entry) {
        const auto samples = SessionAudio(entry).render(trackMutes(entry));
        return std::array{samples[0], samples[1]};
    };
    check(render(project) == std::array<std::int16_t, 2>{2000, 500}, "Pan, volume, and master gain must compose.");
    EditHistory history;
    check(history.execute(project, [](Project& draft) { draft.tracks[1].solo = true; }, EditImpact::liveMute),
          "Solo must be editable.");
    check(render(project) == std::array<std::int16_t, 2>{0, 500}, "Solo must isolate the selected track.");
    history.undo(project);
    check(render(project) == std::array<std::int16_t, 2>{2000, 500}, "Undo must restore the solo mask.");
    history.redo(project);
    project.tracks[1].muted = true;
    check(render(project) == std::array<std::int16_t, 2>{0, 0}, "Explicit mute must also apply to a soloed track.");

    project.tracks[1].solo = project.tracks[1].muted = false;
    const SessionAudio snapshot(project);
    std::atomic<std::uint32_t> peaks{0};
    PlaybackMixer mixer(snapshot, trackMutes(project), 0, &peaks);
    std::array<std::int16_t, 2> frame{};
    check(mixer.read(frame, trackMutes(project)) == 2 && (peaks.load() & 0xffff) == 2000 &&
          (peaks.load() >> 16) == 500, "Meter must use the actual output PCM.");
    mixer.read(frame, trackMutes(project));
    check(peaks.load() == 0, "A silent buffer must clear both channel peaks.");
}

std::string legacyV2() {
    std::string data = "SONOSESS";
    const auto number = [&](unsigned value, unsigned bytes = 4) {
        for (unsigned i = 0; i < bytes; ++i) data.push_back(static_cast<char>(value >> (i * 8)));
    };
    const auto name = [&](std::string_view label) { number(static_cast<unsigned>(label.size())); data += label; };
    number(2); name("Mixer legacy"); number(120); number(1); number(1);
    number(7); name("Audio"); number(4, 1); number(0, 1); number(80, 1); number(0); number(1);
    number(9); number(13); number(0); number(1); number(1);
    number(1); number(13); name("Original"); number(4);
    number(100, 2); number(200, 2); number(300, 2); number(400, 2);
    return data;
}

void testFiles() {
    const auto root = std::filesystem::temp_directory_path() / ("sonoravell-mix-" + std::to_string(std::random_device{}()));
    check(std::filesystem::create_directory(root), "Could not create fixture location.");
    struct Cleanup {
        std::filesystem::path path;
        ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
    } cleanup{root};
    const auto legacy = root / "legacy.sonora";
    const auto bytes = legacyV2();
    std::ofstream(legacy, std::ios::binary).write(bytes.data(), bytes.size());
    auto project = openProject(legacy);
    check(project.masterVolume == 100 && project.tracks[0].pan == 0 && !project.tracks[0].solo &&
          project.tracks[0].clips[0] == AudioClip{9, 13, 0, 1, 1}, "V2 mixer defaults and trims must be preserved.");
    project.masterVolume = 60;
    project.tracks[0].pan = -45;
    project.tracks[0].solo = true;
    bool rejected = false;
    try { saveProject(legacy, project); } catch (const std::runtime_error&) { rejected = true; }
    std::ifstream input(legacy, std::ios::binary);
    check(rejected && std::string(std::istreambuf_iterator<char>(input), {}) == bytes, "Save As must preserve the v2 source.");

    const auto migrated = root / "v3.sonora";
    saveProject(migrated, project);
    check(openProject(migrated) == project, "V3 must persist mixer and trim settings.");
    SessionAutosave autosave;
    autosave.checkpoint(root / "recovery", project);
    const auto slot = std::filesystem::directory_iterator(root / "recovery")->path() / "Checkpoint A.sonora";
    check(openProject(slot) == project, "V3 recovery must retain mixer settings.");
    std::fstream invalid(migrated, std::ios::binary | std::ios::in | std::ios::out);
    invalid.seekp(8 + 4 + 4 + project.name.size() + 4 + 4);
    invalid.put(static_cast<char>(201));
    invalid.close();
    rejected = false;
    try { (void)openProject(migrated); } catch (const std::runtime_error&) { rejected = true; }
    check(rejected && openProject(slot) == project, "Corrupt mixer fields must be rejected without damaging recovery.");
}
}

int main() {
    testMix();
    testFiles();
}
