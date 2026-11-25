#pragma once

#include "project.hpp"

#include <array>
#include <memory>
#include <vector>

namespace sonoravell {
inline constexpr unsigned sourceBlockFrames = 256;
inline constexpr unsigned sourceBlockSamples = sourceBlockFrames * channelCount;

enum class SourceStorage { sparseBlocks, denseReference };

// Filled on the control thread in Session event order. Playback receives a
// const snapshot and only reads precomputed blocks. Null spans are silence.
class PreparedTrack {
public:
    PreparedTrack(std::size_t samples, SourceStorage storage)
        : tiles(storage == SourceStorage::sparseBlocks ? (samples + sourceBlockSamples - 1) / sourceBlockSamples : 0),
          dense(storage == SourceStorage::denseReference ? samples : 0) {}

    void add(std::size_t sample, float value) {
        if (!dense.empty()) {
            dense[sample] += value;
        } else if (value != 0.f) {
            auto& tile = tiles[sample / sourceBlockSamples];
            if (!tile) {
                tile = std::make_unique<Tile>();
                ++allocated;
            }
            (*tile)[sample % sourceBlockSamples] += value;
        }
    }

    const float* block(std::size_t index) const noexcept {
        if (!dense.empty()) return dense.data() + index * sourceBlockSamples;
        const auto& tile = tiles[index];
        return tile ? tile->data() : nullptr;
    }

    std::size_t preparedBytes() const noexcept {
        return dense.capacity() * sizeof(float) + tiles.capacity() * sizeof(std::unique_ptr<Tile>) +
               allocated * sizeof(Tile);
    }

private:
    using Tile = std::array<float, sourceBlockSamples>;
    std::vector<std::unique_ptr<Tile>> tiles;
    std::vector<float> dense;
    std::size_t allocated = 0;
};
}
