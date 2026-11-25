#include "instruments.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>

using namespace sonoravell;

int main() {
    constexpr MidiNote note{0, 960, 38, 110};
    for (const auto type : {Instrument::keys, Instrument::bass, Instrument::drums, Instrument::pluck}) {
        constexpr std::size_t frames = 503;
        std::array<float, 2 * frames> reference{}, actual{};
        BuiltinVoice wide(type, note, 777, frames), small(type, note, 777, frames);
        const auto first = wide.read(reference);
        const auto rest = wide.read(std::span(reference).subspan(first));
        std::size_t at = 0;
        while (!small.finished()) at += small.read(std::span(actual).subspan(at).first(std::min<std::size_t>(100, actual.size() - at)));
        if (first != sourceBlockSamples || first + rest != reference.size() || !wide.finished() || actual != reference ||
            reference.front() != 0.f || reference.back() != 0.f || std::ranges::all_of(reference, [](float x) { return x == 0.f; })) {
            throw std::runtime_error("The voice must preserve PCM and state across block boundaries.");
        }
    }
}
