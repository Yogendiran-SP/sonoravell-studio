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
}
