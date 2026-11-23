#include "session.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string_view>

using namespace sonoravell;

void check(bool condition, std::string_view message) {
    if (condition) return;
    std::cerr << message << '\n';
    std::exit(1);
}

int main() {
    const auto notes = afterHours();
    check(notes.size() == 240, "Demo score note count changed");
    check(std::ranges::all_of(notes, [](const Note& note) {
        return note.startBeat >= 0 && note.startBeat + note.lengthBeats <= demoBars * 4;
    }), "Demo note extends beyond the arrangement");

    const SessionAudio demo(afterHoursProject());
    const auto mix = demo.render({});
    check(mix.size() == 1772308, "Unexpected demo playback length");
    check(mix == demo.render({}), "Render must repeat within the same build");
    check(std::ranges::any_of(mix, [](auto sample) { return sample != 0; }), "Mix is silent");
    const auto silence = demo.render({true, true, true, true});
    check(silence.size() == mix.size() && std::ranges::all_of(silence, [](auto sample) { return sample == 0; }),
          "Muting all tracks must preserve length and produce silence");
    for (unsigned track = 0; track < trackNames.size(); ++track) {
        TrackMutes mutes{};
        mutes[track] = true;
        check(demo.render(mutes) != mix, "Every track must contribute to the mix");
    }

    constexpr std::size_t blockFrames = 512;
    constexpr std::size_t blockSamples = blockFrames * channelCount;
    constexpr std::size_t rampSamples = PlaybackMixer::muteRampFrames * channelCount;
    const TrackMutes keysMuted{true, false, false, false};
    const auto withoutKeys = demo.render(keysMuted);
    Samples block(blockSamples);
    PlaybackMixer playback(demo, {});
    check(playback.read(block, {}) == blockSamples && std::ranges::equal(block, std::span(mix).first(blockSamples)),
          "Playback starts at the original mix");
    check(playback.read(block, keysMuted) == blockSamples, "Mute request continues playback");
    check(std::ranges::equal(std::span(block).first(channelCount),
                            std::span(mix).subspan(blockSamples, channelCount)),
          "Mute fade starts at the current gain");
    check(std::ranges::equal(std::span(block).subspan(rampSamples),
                            std::span(withoutKeys).subspan(blockSamples + rampSamples, blockSamples - rampSamples)),
          "Muted track drops out after the fade without moving the playhead");
    check(playback.read(block, {}) == blockSamples, "Unmute request continues playback");
    check(std::ranges::equal(std::span(block).first(channelCount),
                            std::span(withoutKeys).subspan(2 * blockSamples, channelCount)),
          "Unmute fade starts at the current gain");
    check(std::ranges::equal(std::span(block).subspan(rampSamples),
                            std::span(mix).subspan(2 * blockSamples + rampSamples, blockSamples - rampSamples)),
          "Unmuting restores the original mix at the current playhead");
    std::size_t consumed = 3 * blockSamples;
    while (!playback.finished()) {
        const auto count = playback.read(block, {});
        check(count > 0 && std::ranges::equal(std::span(block).first(count), std::span(mix).subspan(consumed, count)),
              "Buffer order and final partial buffer preserve the original mix");
        consumed += count;
    }
    check(consumed == mix.size() && playback.read(block, {}) == 0, "Playback ends exactly once");

    std::ostringstream output;
    writeWave(output, mix);
    const auto wave = output.str();
    const auto read32 = [&](unsigned offset) {
        std::uint32_t value = 0;
        for (unsigned byte = 0; byte < 4; ++byte) {
            value |= static_cast<std::uint32_t>(static_cast<unsigned char>(wave[offset + byte])) << (8 * byte);
        }
        return value;
    };
    check(wave.size() == 44 + mix.size() * 2, "Incorrect WAV length");
    check(wave.starts_with("RIFF") && wave.substr(8, 8) == "WAVEfmt " && wave.substr(36, 4) == "data",
          "Missing WAV headers");
    check(read32(4) == wave.size() - 8 && read32(24) == sampleRate && read32(40) == wave.size() - 44,
          "Incorrect RIFF, sample rate or data size fields");
}
