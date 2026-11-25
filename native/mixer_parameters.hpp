#pragma once

#include "project.hpp"

#include <array>
#include <atomic>

namespace sonoravell {
struct StereoGain {
    double left = 1.;
    double right = 1.;
    bool operator==(const StereoGain&) const = default;
};

struct MixerParameters {
    std::array<StereoGain, maxTracks> tracks{};
    double master = 1.;
    unsigned masterBypass = 0;
    std::array<unsigned, maxTracks> trackBypass{};
    bool operator==(const MixerParameters&) const = default;
};

MixerParameters mixerParameters(const Project& project) noexcept;

// Single control-thread publisher and one render consumer. Each owns a
// private slot. Exchange transfers ownership of the third slot, and the
// pending bit lets the consumer retain its current slot across quiet blocks.
class MixerParameterMailbox {
public:
    void publish(const MixerParameters& values) noexcept {
        slots[back] = values;
        back = middle.exchange(back | pending, std::memory_order_acq_rel) & indexMask;
    }

    const MixerParameters& readLatest() noexcept {
        if (middle.load(std::memory_order_acquire) & pending) {
            front = middle.exchange(front, std::memory_order_acq_rel) & indexMask;
        }
        return slots[front];
    }

private:
    static constexpr unsigned pending = 4;
    static constexpr unsigned indexMask = pending - 1;
    static_assert(std::atomic<unsigned>::is_always_lock_free);
    std::array<MixerParameters, 3> slots{};
    std::atomic<unsigned> middle{1};
    unsigned back = 2;
    unsigned front = 0;
};
}
