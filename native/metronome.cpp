#include "metronome.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace sonoravell {
Metronome::Metronome(unsigned tempo, unsigned frames) {
    for (unsigned tick = 0;; tick += ticksPerBeat) {
        const auto position = frameAtTick(tick, tempo);
        if (position >= frames) break;
        positions.push_back(position);
    }
    for (unsigned i = 0; i < clickFrames; ++i) {
        const auto phase = 2. * std::numbers::pi * i / sampleRate;
        const auto envelope = .10 * std::pow(std::sin(std::numbers::pi * i / (clickFrames - 1)), 2);
        beat[i] = std::sin(950. * phase) * envelope;
        downbeat[i] = std::sin(1450. * phase) * envelope;
    }
}

void Metronome::add(std::span<double> stereo, unsigned firstFrame) const noexcept {
    const auto earliest = firstFrame < clickFrames ? 0u : firstFrame - clickFrames + 1;
    auto position = std::ranges::lower_bound(positions, earliest);
    const auto end = firstFrame + static_cast<unsigned>(stereo.size() / channelCount);
    for (; position != positions.end() && *position < end; ++position) {
        const auto& click = (position - positions.begin()) % beatsPerBar == 0 ? downbeat : beat;
        for (auto frame = std::max(firstFrame, *position); frame < std::min(end, *position + clickFrames); ++frame) {
            const auto offset = (frame - firstFrame) * channelCount;
            stereo[offset] += click[frame - *position];
            stereo[offset + 1] += click[frame - *position];
        }
    }
}

std::size_t Metronome::scheduledBytes() const noexcept {
    return sizeof(Metronome) + positions.capacity() * sizeof(unsigned);
}
}
