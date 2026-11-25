#include "clip_edit.hpp"
#include "edit_history.hpp"
#include "timeline_view.hpp"

#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool valid, const char* reason) {
    if (!valid) throw std::runtime_error(reason);
}
}

int main() {
    TimelineView view;
    view.resize(1600);
    check(view.pixel(800, 500) == 250 && view.frame(250, 500) == 800, "Fit must map the whole Session.");
    view.zoom(1600, 800, true);
    check(view.first() == 400 && view.end() == 1200 && view.pixel(800, 500) == 250, "Zoom must preserve the anchor.");
    view.scroll(1600, true);
    view.scroll(1600, true);
    check(view.first() == 800 && view.pixel(0, 500) < 0 && view.frame(500, 500) == 1600, "Scrolling must clamp to the Session.");
    for (unsigned i = 0; i < 10; ++i) view.zoom(1600, 1599, true);
    check(view.magnification() == 16 && view.span() == 100, "Magnification must be bounded.");
    view.resize(20);
    check(view.end() <= 20 && view.span() == 1, "A shortened Session must clamp the viewport.");

    Project project;
    project.assets.emplace_back(1, "Trimmed source", Samples(100, 8000));
    project.tracks.push_back({1, "Audio 1", Instrument::audio, false, 100, {}, {{9, 1, 30, 7, 19}}});
    project.tracks.push_back({4, "Instrument", Instrument::keys, false, 100, {}, {}});
    project.tracks.push_back({5, "Audio 2", Instrument::audio, false, 100, {}, {}});
    const auto original = project;
    const auto* audio = project.assets.front().stereo().data();
    bool refused = false;
    try { moveClipToTrack(project, 9, 4, 500); } catch (const std::runtime_error&) { refused = true; }
    check(refused && project == original, "Incompatible drops must preserve the Session.");
    EditHistory history;
    check(history.execute(project, [](Project& p) { moveClipToTrack(p, 9, 5, 200); }), "Compatible drops must commit.");
    check(project.tracks[0].clips.empty() && project.tracks[2].clips.front() == AudioClip{9, 1, 200, 7, 19} &&
          project.assets.front().stereo().data() == audio, "Clip identity and source range must survive a cross-track move.");
    check(history.undo(project).has_value() && project == original, "Undo must restore placement and track membership.");
}
