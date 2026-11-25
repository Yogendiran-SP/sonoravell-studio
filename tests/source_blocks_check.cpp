#include "session.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}
}

int main() {
    Project project;
    project.bars = 16;
    Samples data(2400);
    for (std::size_t i = 0; i < data.size(); ++i) data[i] = static_cast<std::int16_t>(static_cast<int>(i % 551) - 275);
    project.assets.emplace_back(1, "Ramp", std::move(data));
    project.tracks.push_back({1, "Clips", Instrument::audio, false, 75, {},
                              {{1, 1, 10, 2, 750}, {2, 1, 18, 3, 488}, {3, 1, 25 * ticksPerBeat, 0, 23}}});
    project.tracks.push_back({2, "Drums", Instrument::drums, false, 60, {{19, 100, 38, 85}}, {}});
    project.tracks.push_back({3, "Empty", Instrument::keys, false, 100, {}, {}});
    project.tracks[1].pan = 70;
    project.masterVolume = 82;
    const auto parameters = mixerParameters(project);
    const SessionAudio sparse(project);
    const SessionAudio dense(project, SourceStorage::denseReference);
    check(sparse.preparedBytes() < dense.preparedBytes() / 30, "Sparse fixture must omit quiet track PCM.");
    const auto reference = dense.render(parameters);
    check(reference == sparse.render(parameters), "Sparse sources must render bit-exact against the dense reference.");

    constexpr auto start = sourceBlockFrames - 3;
    PlaybackMixer mixer(sparse, parameters, start);
    std::array<std::int16_t, sourceBlockSamples * 2 + 1> block;
    auto consumed = start * channelCount;
    for (unsigned frames : {1u, 63u, 262u, 3u, 511u, 255u}) {
        const auto count = mixer.read(std::span(block).first(frames * channelCount + 1));
        check(count == frames * channelCount &&
              std::ranges::equal(std::span(block).first(count), std::span(reference).subspan(consumed, count)),
              "An unaligned request changed samples spanning source blocks.");
        consumed += count;
    }
    PlaybackMixer tail(sparse, parameters, sessionFrames(project) - 3);
    check(tail.read(block) == 3 * channelCount && tail.finished() && tail.read(block) == 0,
          "The partial source tile must end at the Session frame boundary.");
}
