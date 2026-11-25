#pragma once

#include <algorithm>
#include <cstdint>

namespace sonoravell {
class TimelineView {
public:
    unsigned first() const noexcept { return start; }
    unsigned span() const noexcept { return length; }
    unsigned end() const noexcept { return start + length; }
    unsigned magnification() const noexcept { return scale; }

    void resize(unsigned total) noexcept {
        length = std::max(1u, total / scale);
        start = std::min(start, total - std::min(total, length));
    }

    void zoom(unsigned total, unsigned anchor, bool in) noexcept {
        const auto oldLength = length;
        const auto offset = std::clamp(anchor, start, end()) - start;
        scale = in ? std::min(scale * 2, 16u) : std::max(scale / 2, 1u);
        length = std::max(1u, total / scale);
        const auto offsetAfter = static_cast<unsigned>(static_cast<std::uint64_t>(offset) * length / oldLength);
        start = anchor - std::min(anchor, offsetAfter);
        resize(total);
    }

    void scroll(unsigned total, bool forward) noexcept {
        const auto maximum = total - std::min(total, length);
        const auto step = std::max(1u, length / 2);
        start = forward ? start + std::min(step, maximum - std::min(maximum, start)) : start - std::min(step, start);
        resize(total);
    }

    int pixel(unsigned frame, int width) const noexcept {
        return static_cast<int>((static_cast<std::int64_t>(frame) - start) * width / length);
    }

    unsigned frame(int pixel, int width) const noexcept {
        width = std::max(1, width);
        const auto offset = (static_cast<std::uint64_t>(std::clamp(pixel, 0, width)) * length + width / 2) / width;
        return start + static_cast<unsigned>(offset);
    }

private:
    unsigned start = 0, length = 1, scale = 1;
};
}
