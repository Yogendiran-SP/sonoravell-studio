#include "clip_edit.hpp"
#include "edit_history.hpp"
#include "session.hpp"
#include "session_autosave.hpp"
#include "take_journal.hpp"
#include "workspace_layout.hpp"

#include <algorithm>
#include <array>
#include <fstream>
#include <random>
#include <sstream>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool passed, const char* reason) {
    if (!passed) throw std::runtime_error(reason);
}

std::string exportWave(const Project& project) {
    const SessionAudio snapshot(project);
    std::ostringstream wave;
    writeWave(wave, snapshot.renderProject(project));
    return wave.str();
}
}

int main() {
    const auto dir = std::filesystem::temp_directory_path() / ("sonoravell-alpha-" + std::to_string(std::random_device{}()));
    check(std::filesystem::create_directory(dir), "Could not create the alpha fixture directory.");
    struct Cleanup {
        std::filesystem::path path;
        ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
    } cleanup{dir};
    Project project;
    project.name = "Offline alpha song";
    project.bars = 2;
    std::ostringstream source;
    writeWave(source, Samples(4800, 3600));
    std::istringstream wav(source.str());
    project.assets.push_back(readWave(wav, 1, "Imported WAV"));
    project.tracks.push_back({1, "Import", Instrument::audio, false, 100, {}, {wholeAudioClip(1, project.assets.front(), 0)}});
    project.tracks.push_back({2, "MIDI", Instrument::keys, false, 80, {{ticksPerBeat, ticksPerBeat, 60, 97}}, {}});
    project.tracks.push_back({3, "Take", Instrument::audio, false, 100, {}, {}});

    const auto takePath = dir / "interrupted.sntake";
    {
        TakeWriter writer(takePath, ticksPerBeat / 2);
        constexpr std::array<std::int16_t, 4> captured{1000, -1000, 456, -800};
        writer.append(captured);
    }
    auto take = recoverTake(takePath);
    check(!take.finalized && take.stereo == Samples{1000,1000,-1000,-1000,456,456,-800,-800}, "Take recovery lost verified samples.");
    project.assets.emplace_back(2, "Recovered Take", std::move(take.stereo));
    project.tracks.back().clips.push_back(wholeAudioClip(2, project.assets.back(), take.startTick));

    EditHistory history;
    history.execute(project, [](Project& draft) {
        moveClipToTrack(draft, 1, 3, 0);
        editAudioClip(draft, 1, ClipEdit::trimEnd, 48);
        draft.tracks[2].pan = -25;
        const auto effect = editInserts(draft.tracks[2].inserts, {InsertAction::add, 0, InsertKind::gain});
        editInserts(draft.tracks[2].inserts, {InsertAction::parameter, effect, InsertKind::gain, 0, 30});
        editInserts(draft.masterInserts, {InsertAction::add, 0, InsertKind::compressor});
        draft.masterVolume = 85;
    });
    const auto edited = project;
    check(history.undo(project).has_value() && history.redo(project).has_value() && project == edited, "The Session edit history failed.");
    const auto named = dir / "song.sonora";
    saveProject(named, project);
    const auto reference = exportWave(project);
    const auto reopened = openProject(named);
    check(reopened == project && exportWave(reopened) == reference, "Reopening changed the Session mix or WAV output.");

    const SessionAudio prepared(project);
    const PlaybackLoop loop{100, 650};
    for (unsigned i = 0; i < 16; ++i) {
        auto inserts = prepareInserts(project);
        PlaybackMixer mixer(prepared, mixerParameters(project), i * 97);
        mixer.attachInserts(inserts.get());
        check(mixer.setLoopRegion(loop), "Could not restore the selected loop.");
        std::array<std::int16_t, 512> buffer{};
        for (std::size_t b = 0; b < 8; ++b) check(mixer.read(buffer) == buffer.size(), "An independent playback attempt lost frames.");
    }

    const auto prior = openProject(named);
    auto invalid = project;
    invalid.masterInserts[0].values[0] = 70000;
    bool refused = false;
    try { saveProject(named, invalid); } catch (const std::runtime_error&) { refused = true; }
    check(refused && openProject(named) == prior, "A failed save touched the previous Session.");
    SessionAutosave autosave;
    autosave.checkpoint(dir / "checkpoints", project);
    const auto root = std::filesystem::directory_iterator(dir / "checkpoints")->path();
    check(exportWave(openProject(root / "Checkpoint A.sonora")) == reference, "The autosave lost the mix or recovered clip.");

    const WorkspaceLayout layout{true, false, true, false, 225, 199};
    check(decodeWorkspace(encodeWorkspace(layout)) == layout && project == edited, "Workspace state must stay independent of the Session.");
}
