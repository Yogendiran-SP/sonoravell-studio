#pragma once

#include "take_journal.hpp"

#include <algorithm>
#include <array>
#include <atomic>

namespace sonoravell {
inline constexpr unsigned captureBlockFrames = sampleRate / 50;
static_assert(takeBlockFrames % captureBlockFrames == 0);

struct CaptureBlock {
    std::array<std::int16_t, captureBlockFrames> samples;
    unsigned count = 0;
};

// One producer and one consumer. Neither waits or allocates. Full is reported
// to the producer so the take can stop without silently skipping samples.
class TakeQueue {
public:
    bool push(std::span<const std::int16_t> input) noexcept {
        return input.size() <= captureBlockFrames && pushPacket(input);
    }

    // Publish the whole packet or none of it, including packets that span slots.
    bool pushPacket(std::span<const std::int16_t> input) noexcept {
        if (input.empty() || input.size() > takeBlockFrames) return false;
        auto write = head.load(std::memory_order_relaxed);
        const auto read = tail.load(std::memory_order_acquire);
        const auto slots = (input.size() + captureBlockFrames - 1) / captureBlockFrames;
        if (slots > (read + blocks.size() - write - 1) % blocks.size()) return false;
        while (!input.empty()) {
            auto& block = blocks[write];
            const auto count = std::min(input.size(), block.samples.size());
            std::ranges::copy(input.first(count), block.samples.begin());
            block.count = static_cast<unsigned>(count);
            input = input.subspan(count);
            write = (write + 1) % blocks.size();
        }
        head.store(write, std::memory_order_release);
        return true;
    }

    bool pop(CaptureBlock& output) noexcept {
        const auto read = tail.load(std::memory_order_relaxed);
        if (read == head.load(std::memory_order_acquire)) return false;
        output = blocks[read];
        tail.store((read + 1) % blocks.size(), std::memory_order_release);
        return true;
    }

    bool empty() const noexcept { return head.load(std::memory_order_acquire) == tail.load(std::memory_order_acquire); }

private:
    // About five seconds of mono PCM at 48 kHz.
    std::array<CaptureBlock, 256> blocks{};
    std::atomic<std::size_t> head{0}, tail{0};
};
}
