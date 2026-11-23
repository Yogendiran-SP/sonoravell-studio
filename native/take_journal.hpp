#pragma once

#include "project.hpp"

#include <cstdio>
#include <memory>
#include <span>

namespace sonoravell {
// Storage operates on the writer or control thread. Record at most 200 ms per block.
inline constexpr unsigned takeBlockFrames = sampleRate / 5;
inline constexpr auto takeExtension = ".sntake";

struct RecoveredTake {
    std::uint32_t startTick = 0;
    Samples stereo;
    bool finalized = false;
};

class TakeWriter {
public:
    // Creates a new file and fails if the filename is already in use.
    TakeWriter(const std::filesystem::path& path, std::uint32_t startTick);
    void append(std::span<const std::int16_t> mono);
    void finalize();

private:
    void writeRecord(std::span<const std::int16_t> mono);
    void sync();

    std::unique_ptr<std::FILE, int (*)(std::FILE*)> file{nullptr, std::fclose};
    std::size_t frames = 0;
    bool failed = false;
    bool finalized = false;
};

// Returns the contiguous, checksummed prefix. An interrupted or damaged tail
// never becomes a silent gap in recovered audio.
RecoveredTake recoverTake(const std::filesystem::path& path);
}
