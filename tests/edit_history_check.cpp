#include "clip_edit.hpp"
#include "edit_history.hpp"
#include "session.hpp"

#include <iostream>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}
}

int main() {
    try {
        Project project;
        project.bars = 1;
        project.tracks.push_back({1, "Keys", Instrument::keys, false, 100, {}, {}});
        const auto blank = project;
        EditHistory history;
        history.execute(project, [](Project& draft) {
            draft.assets.emplace_back(1, "Source", Samples(200, 2300));
            draft.tracks.push_back({2, "Audio", Instrument::audio, false, 100, {},
                                    {wholeAudioClip(1, draft.assets.front(), 0)}});
        });
        const auto imported = project;
        const auto* pcm = project.assets.front().stereo().data();
        const SessionAudio playback(project);
        history.execute(project, [](Project& draft) { editAudioClip(draft, 1, ClipEdit::split, 2); });
        const auto split = project;
        history.execute(project, [](Project& draft) { draft.tracks[0].notes.push_back({0, 960, 50, 90}); });
        const auto note = project;
        history.execute(project, [](Project& draft) { draft.tracks[0].muted = true; }, EditImpact::liveMixer);
        history.execute(project, [](Project& draft) { draft.tracks[1].volume = 40; }, EditImpact::liveMixer);
        const auto mixed = project;
        history.execute(project, [](Project& draft) { draft.tracks.pop_back(); });
        check(project.assets.size() == 1 && project.assets.front().stereo().data() == pcm,
              "Removing a track must keep its shared source audio.");
        check(history.undo(project) == EditImpact::rebuildAudio && project == mixed, "Undo track removal.");
        check(history.undo(project) == EditImpact::liveMixer && project.tracks[1].volume == 100, "Undo level.");
        check(history.undo(project) == EditImpact::liveMixer && project == note, "Undo live mute.");
        check(history.undo(project) && project == split, "Undo note insertion.");
        check(history.undo(project) && project == imported && project.assets.front().stereo().data() == pcm, "Undo clip split.");
        check(history.undo(project) && project == blank && !history.undo(project), "Undo imported track and source.");
        check(history.redo(project) && project == imported && project.assets.front().stereo().data() == pcm,
              "Redo import must reuse its immutable samples.");
        const auto* beforeFailure = project.assets.front().stereo().data();
        bool rejected = false;
        try {
            history.execute(project, [](Project& draft) {
                draft.tracks[1].clips[0].sourceFrame = 9999;
            });
        } catch (const std::runtime_error&) { rejected = true; }
        check(rejected && project == imported && history.canRedo() && project.assets.front().stereo().data() == beforeFailure,
              "Validation failure must preserve the Session and redo branch.");
        check(!history.execute(project, [](Project&) {}) && history.canRedo(), "A no-op must not consume history.");
        check(history.redo(project) && project == split, "The previous redo branch must still work.");
        history.execute(project, [](Project& draft) { editAudioClip(draft, 1, ClipEdit::move, 9); });
        check(!history.canRedo() && project.assets.front().stereo().data() == pcm, "A fresh edit must discard redo without copying audio.");
        check(playback.render({})[0] == 2300 && SessionAudio(project).render({})[0] == 0,
              "An immutable already-built playback snapshot must survive the edit.");

        history.clear();
        for (unsigned i = 0; i < EditHistory::limit + 5; ++i) {
            history.execute(project, [](Project& draft) { ++draft.tempo; });
        }
        unsigned undoCount = 0;
        while (history.undo(project)) ++undoCount;
        check(undoCount == EditHistory::limit && project.tempo == blank.tempo + 5,
              "Bounded history must evict the oldest commands.");
        unsigned redoCount = 0;
        while (history.redo(project)) ++redoCount;
        check(redoCount == undoCount && project.tempo == blank.tempo + 5 + EditHistory::limit,
              "Redo must replay all retained commands.");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
