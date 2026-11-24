#pragma once

#include <algorithm>
#include <cstdint>
#include <optional>

namespace sonoravell {
struct PeriodRange {
    unsigned fundamental, minimum, maximum;
};

inline std::optional<unsigned> chooseSharedPeriod(unsigned requested, PeriodRange range) noexcept {
    if (!requested || !range.fundamental || !range.minimum || range.minimum > range.maximum) return {};
    const std::uint64_t step = range.fundamental;
    const auto first = (range.minimum + step - 1) / step;
    const auto last = range.maximum / step;
    if (first > last) return {};
    const auto nearest = (requested + step / 2) / step;
    return static_cast<unsigned>(std::clamp(nearest, first, last) * step);
}
}
