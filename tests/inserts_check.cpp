#include "edit_history.hpp"
#include "session.hpp"
#include "session_autosave.hpp"

#include <algorithm>
#include <array>
#include <fstream>
#include <random>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}
template<class Function>
void rejected(Function&& function) {
    try { function(); } catch (const std::runtime_error&) { return; }
    throw std::runtime_error("Expected a rejected effect operation.");
}
Project fixture() {
    Project project;
    project.bars = 1;
    project.assets.emplace_back(1, "Source", Samples(3000, 12000));
    project.tracks.push_back({1, "Audio", Instrument::audio, false, 100, {}, {{1, 1, 0, 0, 1500}}});
    return project;
}
void commandsAndProcessing() {
    auto project = fixture();
    const SessionAudio snapshot(project);
    const auto dry = snapshot.renderProject(project);
    EditHistory history;
    std::uint32_t gain = 0;
    history.execute(project, [&](Project& draft) {
        gain = editInserts(draft.masterInserts, {InsertAction::add, 0, InsertKind::gain});
        editInserts(draft.masterInserts, {InsertAction::parameter, gain, InsertKind::gain, 0, -60});
    }, EditImpact::restartProcessing);
    const auto effected = snapshot.renderProject(project);
    check(effected[0] == 6014, "Master gain must apply before PCM quantization.");
    check(history.undo(project) == EditImpact::restartProcessing && snapshot.renderProject(project) == dry, "Undo must restore dry PCM.");
    check(history.redo(project) == EditImpact::restartProcessing && snapshot.renderProject(project) == effected, "Redo must restore processed PCM.");

    auto rack = prepareInserts(project);
    MixerParameterMailbox mailbox;
    mailbox.publish(mixerParameters(project));
    PlaybackMixer mixer(snapshot, mailbox.readLatest(), 0, nullptr, &mailbox);
    mixer.attachInserts(rack.get());
    std::array<std::int16_t, 2> initial{};
    mixer.read(initial);
    check(initial[0] == effected[0], "Streaming must start at the saved sound.");
    history.execute(project, [&](Project& draft) { editInserts(draft.masterInserts, {InsertAction::toggleBypass, gain}); },
                    EditImpact::liveMixer);
    mailbox.publish(mixerParameters(project));
    std::array<std::int16_t, 2 * PlaybackMixer::rampFrames + 2> ramp{};
    mixer.read(ramp);
    check(ramp[0] == effected[0] && ramp[2] > ramp[0] && ramp.back() == dry[0],
          "Live bypass must fade without restarting the render cursor.");
    check(history.undo(project) == EditImpact::liveMixer, "Bypass Undo must be live.");
    mailbox.publish(mixerParameters(project));
    mixer.read(ramp);
    check(ramp[0] == dry[0] && ramp.back() == effected[0], "Live Undo must restore the effect with a fade.");

    const auto before = project;
    rejected([&] { history.execute(project, [&](Project& draft) {
        editInserts(draft.masterInserts, {InsertAction::parameter, gain, InsertKind::gain, 0, 9999});
    }); });
    check(project == before, "Invalid parameters must leave the Session unchanged.");

    const auto compressor = editInserts(project.masterInserts, {InsertAction::add, 0, InsertKind::compressor});
    const auto gainFirst = snapshot.renderProject(project);
    editInserts(project.masterInserts, {InsertAction::earlier, compressor});
    check(project.masterInserts[0].id == compressor && project.masterInserts[1].id == gain &&
          snapshot.renderProject(project) != gainFirst, "Reorder must preserve IDs and affect sound.");
    editInserts(project.masterInserts, {InsertAction::remove, compressor});
    editInserts(project.masterInserts, {InsertAction::toggleEnabled, gain});
    check(snapshot.renderProject(project) == dry, "Disabled effects must leave the dry signal intact.");

    const auto delay = editInserts(project.tracks[0].inserts, {InsertAction::add, 0, InsertKind::delay});
    editInserts(project.tracks[0].inserts, {InsertAction::parameter, delay, InsertKind::delay, 0, 1});
    editInserts(project.tracks[0].inserts, {InsertAction::parameter, delay, InsertKind::delay, 2, 100});
    const auto wet = snapshot.renderProject(project);
    check(wet[0] == 0 && wet[48 * channelCount] == dry[0], "Track delay must run before track gain and before the master bus.");
    check(wet[1505 * channelCount] != 0, "Effect state must keep rendering through dry gaps.");
    project.tracks[0].muted = true;
    const auto muted = snapshot.renderProject(project);
    check(std::ranges::all_of(muted, [](int value) { return value == 0; }), "Track mute must control effect tails too.");
    project.tracks[0].muted = false;

    auto streamed = prepareInserts(project);
    PlaybackMixer streaming(snapshot, mixerParameters(project));
    streaming.attachInserts(streamed.get());
    Samples actual(wet.size());
    std::size_t at = 0;
    while (at < actual.size()) {
        const auto count = std::min<std::size_t>(actual.size() - at, 134);
        const auto written = streaming.read(std::span(actual).subspan(at, count));
        check(written == count, "Unexpected effect render length.");
        at += written;
    }
    check(actual == wet && streaming.finished(), "Playback and export must agree across unequal block sizes.");
    auto fresh = prepareInserts(project);
    PlaybackMixer seek(snapshot, mixerParameters(project), 1505);
    seek.attachInserts(fresh.get());
    seek.read(initial);
    check(initial == std::array<std::int16_t, 2>{}, "Cold seek resets effect state.");
    auto loopRack = prepareInserts(project);
    PlaybackMixer loop(snapshot, mixerParameters(project), sessionFrames(project) - 1, nullptr, nullptr, true);
    loop.attachInserts(loopRack.get());
    loop.read(ramp);
    check(ramp[0] == 0 && ramp[49 * channelCount] == dry[0], "Looping must feed new source frames through the existing chain.");

    auto over = project;
    editInserts(over.masterInserts, {InsertAction::remove, gain});
    std::array<InsertList*, 2> buses{&over.masterInserts, &over.tracks[0].inserts};
    for (auto* bus : buses) {
        while (bus->size() < maxInsertsPerBus) {
            const auto id = editInserts(*bus, {InsertAction::add, 0, InsertKind::delay});
            editInserts(*bus, {InsertAction::parameter, id, InsertKind::delay, 0, 2000});
        }
    }
    rejected([&] { auto invalid = prepareInserts(over); });
}

std::string legacyV3() {
    std::string bytes = "SONOSESS";
    auto number = [&](unsigned value, unsigned width = 4) {
        for (unsigned i = 0; i < width; ++i) bytes.push_back(static_cast<char>(value >> (8 * i)));
    };
    number(3); number(6); bytes += "Legacy";
    number(120); number(1); number(100, 1); number(0); number(0);
    return bytes;
}

void persistence() {
    const auto root = std::filesystem::temp_directory_path() / ("sonoravell-inserts-" + std::to_string(std::random_device{}()));
    std::filesystem::create_directories(root);
    struct Cleanup {
        std::filesystem::path path;
        ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
    } cleanup{root};
    const auto legacy = root / "legacy.sonora";
    const auto raw = legacyV3();
    std::ofstream(legacy, std::ios::binary).write(raw.data(), raw.size());
    auto imported = openProject(legacy);
    check(imported.masterInserts.empty() && imported.masterVolume == 100, "V3 must use dry defaults.");
    rejected([&] { saveProject(legacy, imported); });
    std::ifstream original(legacy, std::ios::binary);
    check(std::string(std::istreambuf_iterator<char>(original), {}) == raw, "Migration must preserve the original bytes.");

    auto project = fixture();
    const auto id = editInserts(project.masterInserts, {InsertAction::add, 0, InsertKind::eq});
    editInserts(project.masterInserts, {InsertAction::parameter, id, InsertKind::eq, 1, -80});
    editInserts(project.tracks[0].inserts, {InsertAction::add, 0, InsertKind::compressor});
    editInserts(project.tracks[0].inserts, {InsertAction::toggleBypass, 1});
    const auto v4 = root / "project.sonora";
    saveProject(v4, project);
    const auto reopened = openProject(v4);
    check(reopened == project && SessionAudio(reopened).renderProject(reopened) == SessionAudio(project).renderProject(project),
          "Save/reopen must retain settings and PCM.");
    SessionAutosave autosave;
    autosave.checkpoint(root / "recovery", project);
    const auto slot = std::filesystem::directory_iterator(root / "recovery")->path() / "Checkpoint A.sonora";
    check(openProject(slot) == project, "Autosave must restore insert chains.");

    auto duplicate = project;
    duplicate.masterInserts.push_back(duplicate.masterInserts.front());
    rejected([&] { saveProject(v4, duplicate); });
    check(openProject(v4) == project, "An invalid replacement must preserve the named Session.");

    auto damage = root / "damage.sonora";
    std::filesystem::copy_file(v4, damage);
    constexpr std::streamoff listBytes = 1 + 4 + 2 + (4 * 4);
    std::fstream file(damage, std::ios::in | std::ios::out | std::ios::binary);
    file.seekp(-listBytes + 1 + 4, std::ios::end);
    file.put(static_cast<char>(0xff));
    file.close();
    rejected([&] { (void)openProject(damage); });
    std::filesystem::resize_file(damage, std::filesystem::file_size(damage) - 6);
    rejected([&] { (void)openProject(damage); });
}
}

int main() {
    commandsAndProcessing();
    persistence();
}
