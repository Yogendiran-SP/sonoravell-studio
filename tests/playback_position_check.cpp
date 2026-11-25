#include "playback_position.hpp"
#include "session.hpp"

#include <array>
#include <limits>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}
}

int main() {
    check(playbackFrame(0, 0, 100, true) == 0 && playbackFrame(10, 9, 17, true) == 6,
          "Loop position must wrap through zero.");
    const auto large = std::numeric_limits<std::uint64_t>::max();
    check(playbackFrame(10, 9, large, true) == (9 + large % 10) % 10 &&
          playbackFrame(10, 9, large, false) == 10, "Long-running counters must not overflow the Session position.");
    Project project;
    project.bars = 1;
    project.assets.emplace_back(1, "Loop cue", Samples{3000, -2100, 6000, 7100});
    project.tracks.push_back({1, "Cue", Instrument::audio, false, 100, {}, {{1, 1, 0, 0, 2}}});
    const SessionAudio audio(project);
    const auto size = sessionFrames(project);
    PlaybackMixer looping(audio, {}, size - 1, nullptr, nullptr, true);
    std::array<std::int16_t, 8> read;
    check(looping.remainingFrames() == size && looping.read(read) == read.size() &&
          read == std::array<std::int16_t, 8>{0, 0, 3000, -2100, 6000, 7100, 0, 0} && !looping.finished(),
          "A device buffer that crosses the loop seam must contain tail and head without fabricated frames.");
    PlaybackMixer resume(audio, {}, playbackFrame(size, size - 1, 2, true), nullptr, nullptr, true);
    std::array<std::int16_t, 2> frame{};
    check(resume.read(frame) == 2 && frame == std::array<std::int16_t, 2>{6000, 7100},
          "A new playback attempt must start at the actual mapped resume frame.");
    PlaybackMixer oneShot(audio, {}, size - 1);
    check(oneShot.read(read) == 2 && oneShot.finished(), "One-shot render and export must retain EOF.");

    Project regionProject;
    regionProject.bars = 1;
    Samples signal(2000);
    for (unsigned i = 0; i < signal.size(); ++i) signal[i] = static_cast<std::int16_t>(i);
    regionProject.assets.emplace_back(7, "Region signal", std::move(signal));
    regionProject.tracks.push_back({1, "Audio", Instrument::audio, false, 100, {}, {{1, 7, 0, 0, 1000}}});
    const SessionAudio regionAudio(regionProject);
    const auto written = regionAudio.renderProject(regionProject);
    const PlaybackLoop region{123, 613};
    PlaybackMixer exact(regionAudio, {}, 611);
    check(exact.setLoopRegion(region), "A region may use unaligned sample endpoints.");
    check(!exact.setLoopRegion({1, 10}), "An invalid loop must be rejected without moving the cursor.");
    Samples requested(5 * region.end);
    auto count = exact.read(requested);
    check(count == requested.size() - requested.size() % channelCount, "A loop must fill whole device frames.");
    const auto total = sessionFrames(regionProject);
    for (std::size_t i = 0; i < count; ++i) {
        const auto frame = playbackFrame(total, 611, i / channelCount, region);
        check(requested[i] == written[frame * channelCount + i % channelCount], "Loop PCM and renderer cursor must wrap together.");
    }
    PlaybackMixer outside(regionAudio, {}, 800);
    check(outside.setLoopRegion(region) && outside.read(frame) == 2 && frame[0] == written[region.first * channelCount],
          "Playback from outside the region must begin at its first frame.");
    check(playbackFrame(total, 800, 0, region) == region.first, "The playhead must map the normalized loop entry.");
}
