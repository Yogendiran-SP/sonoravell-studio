#include "session.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>

using namespace sonoravell;
void check(bool result, const char* why) {
    if (!result) throw std::runtime_error(why);
}

int main() {
    Project project;
    project.tempo = 117;
    project.bars = 1;
    const SessionAudio audio(project);
    const auto dry = audio.render({});
    check(std::ranges::none_of(dry, [](auto sample) { return sample; }), "Export must stay free from playback clicks.");

    PlaybackMixer click(audio, {}, 0, nullptr, nullptr, false, nullptr, true);
    Samples clicked(dry.size());
    check(click.read(clicked) == clicked.size(), "Click playback must finish at the Session boundary.");
    check(clicked[30] != 0 && clicked[30] == clicked[31] && clicked[1000] == 0,
          "The downbeat must be brief and centered.");
    const auto nextBeat = frameAtTick(ticksPerBeat, project.tempo);
    check(clicked[nextBeat * 2 - 1] == 0 && clicked[nextBeat * 2 + 30] != 0 &&
          clicked[nextBeat * 2 + 30] != clicked[30], "Quarter beats should follow Session tempo with a distinct accent.");
    PlaybackMixer seek(audio, {}, nextBeat + 6, nullptr, nullptr, false, nullptr, true);
    std::array<std::int16_t, 512> slice{};
    check(seek.read(slice) == slice.size() &&
          std::ranges::equal(slice, std::span(clicked).subspan((nextBeat + 6) * 2, slice.size())),
          "Seeking into a click must produce the identical remaining PCM.");
    PlaybackMixer wrap(audio, {}, sessionFrames(project) - 3, nullptr, nullptr, true, nullptr, true);
    const auto count = wrap.read(slice);
    check(count == slice.size() && std::ranges::equal(std::span(slice).subspan(6), std::span(clicked).first(count - 6)),
          "Loop wrap must play the accented beat again without changing timing.");
}
