#include "session.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool valid, const char* reason) {
    if (!valid) throw std::runtime_error(reason);
}
}

int main() {
    Project project;
    project.bars = 1;
    project.assets.emplace_back(1, "Automation PCM", Samples(2000, 10000));
    project.tracks.push_back({8, "Source", Instrument::audio, false, 100, {}, {{1, 1, 0, 0, 1000}}});
    const std::array lanes{FaderLane{8, {{100, 0, -100}, {200, 100, 0}, {600, 100, 100}}}};
    const PreparedAutomation automation(project, lanes);
    const SessionAudio audio(project);
    const auto reference = audio.renderProject(project, &automation);
    check(reference[0] == 0 && reference[300] == 5000 && reference[301] == 2500, "Volume and pan must interpolate independently.");
    check(reference[400] == 10000 && reference[401] == 10000 && reference[1200] == 0 && reference[1201] == 10000,
          "Fader points must settle at their exact frames.");
    PlaybackMixer mixer(audio, {}, 111);
    mixer.attachAutomation(&automation);
    std::array<std::int16_t, 702> chunk{};
    check(mixer.read(chunk) == chunk.size() && std::ranges::equal(chunk, std::span(reference).subspan(222, chunk.size())),
          "Seeks and block splits must share the offline fader curve.");
    PlaybackMixer loop(audio, {}, 477);
    loop.attachAutomation(&automation);
    const PlaybackLoop range{111, 480};
    check(loop.setLoopRegion(range) && loop.read(chunk) == chunk.size(), "Could not render the automated loop.");
    for (std::size_t i = 0; i < chunk.size(); ++i) {
        const auto from = playbackFrame(sessionFrames(project), 477, i / channelCount, range);
        check(chunk[i] == reference[from * channelCount + i % channelCount], "Automation must locate again when the loop wraps.");
    }
    project.tracks.front().muted = true;
    const auto muted = audio.renderProject(project, &automation);
    check(std::ranges::all_of(muted, [](auto sample) { return sample == 0; }), "Automation must respect explicit mute.");

    auto bad = lanes;
    bad[0].points[1].frame = 100;
    bool refused = false;
    try { const PreparedAutomation invalid(project, bad); } catch (const std::runtime_error&) { refused = true; }
    check(refused, "Coincident or unordered automation points must be rejected.");
}
