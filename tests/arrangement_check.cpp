#include "arrangement.hpp"

#include <limits>
#include <stdexcept>

using namespace sonoravell;
void check(bool result) {
    if (!result) throw std::runtime_error("Arrangement regression");
}

int main() {
    Project project;
    project.assets.emplace_back(7, "Source", Samples{100, -200, 0, 0, 10, -32768, 30, 10});
    const auto* pcm = project.assets.front().stereo().data();
    project.tracks.push_back({1, "Audio", Instrument::audio, false, 95, {}, {{42, 7, 0, 1, 3}}});
    renameTrack(project, 0, "Voice");
    check(duplicateTrack(project, 0) == 1 && project.tracks[1].id != project.tracks[0].id);
    auto& copy = project.tracks[1].clips.front();
    check(copy.id != 42 && copy.sourceFrame == 1 && copy.frameCount == 3 && copy.assetId == 7);
    const auto copiedId = copy.id;
    check(moveTrack(project, 1, true) == 0 && project.tracks.front().clips.front().id == copiedId);
    check(moveTrack(project, 0, true) == 0 && project.assets.front().stereo().data() == pcm);
    validateProject(project);

    project.tracks[1].clips.front().id = std::numeric_limits<std::uint32_t>::max();
    const auto before = project;
    try { duplicateTrack(project, 0); } catch (const std::runtime_error&) {}
    check(project == before);
    try { renameTrack(project, 0, ""); } catch (const std::invalid_argument&) {}
    check(project == before);

    check(snapTimelineTick(479, 1920, 960) == 0);
    check(snapTimelineTick(480, 1920, 960) == 960);
    check(snapTimelineTick(1919, 1920, 960) == 960);
    check(snapTimelineTick(120, 1920, 240) == 240);
    check(snapTimelineTick(121, 1920, 0) == 121);
    check(snapTimelineTick(7000, 1920, 0) == 1919);
    check(snapTimelineTick(500, 0, 0) == 0);

    const WaveformPeaks peaks(project.assets.front());
    check(peaks.peak(0, 1) == 200 && peaks.peak(1, 2) == 0);
    check(peaks.peak(1, 3) == 32768 && peaks.peak(3, 200) == 30 && peaks.peak(4, 200) == 0);
    Samples longClip(2048, 0);
    longClip[4] = 360;
    longClip[36] = 480;
    const WaveformPeaks compact(AudioAsset(10, "Longer", std::move(longClip)));
    check(compact.peak(3, 4) == 360 && compact.peak(4, 16) == 0 && compact.peak(16, 32) == 480);
}
