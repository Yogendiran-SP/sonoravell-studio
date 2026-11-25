#include "project.hpp"
#include "session.hpp"
#include "session_autosave.hpp"

#include <bit>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool condition, const char* reason) {
    if (!condition) throw std::runtime_error(reason);
}

void rejects(auto&& action) {
    try {
        action();
    } catch (const std::runtime_error&) {
        return;
    }
    throw std::runtime_error("Expected an invalid file or draft to be rejected");
}

struct TemporaryDirectory {
    std::filesystem::path path = std::filesystem::temp_directory_path() /
        ("sonoravell-check-" + std::to_string(std::random_device{}()));
    TemporaryDirectory() { check(std::filesystem::create_directory(path), "Could not create fixture directory"); }
    ~TemporaryDirectory() {
        std::error_code ignored;
        std::filesystem::remove_all(path, ignored);
    }
};

std::string monoWave(unsigned sampleRate) {
    std::string wav = "RIFF";
    auto number = [&](unsigned value, unsigned bytes = 4) {
        for (unsigned i = 0; i < bytes; ++i) wav.push_back(static_cast<char>(value >> (i * 8)));
    };
    number(50);
    wav += "WAVEJUNK";
    number(1);
    number(0, 2);
    wav += "fmt ";
    number(16);
    number(1, 2);
    number(1, 2);
    number(sampleRate);
    number(sampleRate * 2);
    number(2, 2);
    number(16, 2);
    wav += "data";
    number(4);
    number(0, 2);
    number(32767, 2);
    return wav;
}
}

int main() {
    try {
        TemporaryDirectory directory;
        const auto session = directory.path / "project.sonora";
        auto demo = afterHoursProject();
        saveProject(session, demo);
        check(openProject(session) == demo, "Demo project did not round-trip");

        std::istringstream source(monoWave(44100));
        Project song;
        song.bars = 1;
        song.name = "Project fixture";
        song.assets.push_back(readWave(source, 9, "Mono source"));
        check(song.assets.front().stereo == Samples{0, 0, 30104, 30104, 32767, 32767},
              "44.1 kHz mono import did not resample and duplicate channels correctly");
        song.tracks.push_back({3, "Keys", Instrument::keys, false, 75, {{0, 960, 64, 100}}, {}});
        song.tracks.push_back({17, "Audio", Instrument::audio, false, 100, {}, {wholeAudioClip(1, song.assets.front(), 1920)}});
        saveProject(session, song);
        const auto reopened = openProject(session);
        check(reopened == song, "Replacing a Session lost edited MIDI or embedded audio");
        auto audio = SessionAudio(reopened).render(trackMutes(reopened));
        check(frameAtTick(1920, song.tempo) == 48000, "Beat to sample conversion is incorrect");
        check(audio[48001 * 2] != 0 && audio[48001 * 2] == audio[48001 * 2 + 1],
              "Imported audio did not play on both channels at its clip position");
        song.tracks.back().muted = true;
        const auto muted = SessionAudio(song).render(trackMutes(song));
        check(muted[48001 * 2] == 0, "Mute was ignored during export");

        song.tracks.back().clips.front().assetId = 99;
        rejects([&] { saveProject(session, song); });
        check(openProject(session) == reopened, "Failed save altered the last committed Session");

        const auto blocked = directory.path / "occupied";
        std::filesystem::create_directory(blocked);
        std::ofstream(blocked / "keep.txt") << "existing data";
        rejects([&] { saveProject(blocked, reopened); });
        check(std::filesystem::exists(blocked / "keep.txt"), "A failed replacement damaged existing files");
        for (const auto& item : std::filesystem::directory_iterator(directory.path)) {
            check(!item.path().filename().string().starts_with(".sonoravell-save-"), "Save staging was not cleaned up");
        }

        const auto recoveryRoot = directory.path / "Session recovery";
        SessionAutosave autosave;
        autosave.checkpoint(recoveryRoot, reopened);
        const auto slotDirectory = std::filesystem::directory_iterator(recoveryRoot)->path();
        const auto a = slotDirectory / "Checkpoint A.sonora";
        const auto b = slotDirectory / "Checkpoint B.sonora";
        auto edited = reopened;
        edited.tempo = 125;
        autosave.checkpoint(recoveryRoot, edited);
        check(openProject(a) == reopened && openProject(b) == edited, "Autosave did not retain both revisions");
        edited.tempo = 0;
        rejects([&] { autosave.checkpoint(recoveryRoot, edited); });
        check(openProject(a) == reopened && openProject(b).tempo == 125,
              "A failed autosave damaged a valid checkpoint");
        edited.tempo = 140;
        autosave.checkpoint(recoveryRoot, edited);
        check(openProject(a) == edited && openProject(b).tempo == 125,
              "Autosave retry overwrote the wrong checkpoint");
        const auto moved = slotDirectory / "last-good-B.sonora";
        std::filesystem::rename(b, moved);
        std::filesystem::create_directory(b);
        edited.tempo = 150;
        rejects([&] { autosave.checkpoint(recoveryRoot, edited); });
        check(openProject(a).tempo == 140 && openProject(moved).tempo == 125,
              "A failing filesystem replacement damaged an autosave revision");
        std::filesystem::remove(b);
        autosave.checkpoint(recoveryRoot, edited);
        check(openProject(a).tempo == 140 && openProject(b).tempo == 150,
              "A filesystem error advanced the autosave slot");
        check(openProject(session) == reopened, "Autosave modified the named Session");
        autosave.startSession();
        autosave.checkpoint(recoveryRoot, reopened);
        check(std::distance(std::filesystem::directory_iterator(recoveryRoot),
                            std::filesystem::directory_iterator{}) == 2,
              "Independent Sessions shared a recovery folder");

        check(recordingCapacity(reopened, 0) >= 60 * sampleRate, "A minimal Session cannot hold a 60 second recording");
        const auto endTick = maxBars * beatsPerBar * ticksPerBeat;
        check(recordingCapacity(reopened, endTick) == 0, "Recording capacity ignored the end of the timeline");

        auto badWave = monoWave(48000);
        badWave.pop_back();
        std::istringstream truncatedWave(badWave);
        rejects([&] { readWave(truncatedWave, 1, "Truncated"); });
        std::fstream future(session, std::ios::binary | std::ios::in | std::ios::out);
        future.seekp(8);
        future.put(99);
        future.close();
        rejects([&] { openProject(session); });
        std::filesystem::resize_file(session, 10);
        rejects([&] { openProject(session); });
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
