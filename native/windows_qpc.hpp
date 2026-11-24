#pragma once

#include "stream_clock.hpp"

#include <windows.h>

#include <limits>

namespace sonoravell {
class WindowsQpc {
public:
    WindowsQpc() noexcept {
        LARGE_INTEGER value{};
        if (QueryPerformanceFrequency(&value) && value.QuadPart > 0) {
            frequency = static_cast<std::uint64_t>(value.QuadPart);
        }
    }

    std::optional<QpcTime> now() const noexcept {
        LARGE_INTEGER value{};
        if (!frequency || !QueryPerformanceCounter(&value) || value.QuadPart <= 0) return {};
        const auto counter = static_cast<std::uint64_t>(value.QuadPart);
        const auto seconds = counter / frequency;
        const auto fraction = counter % frequency;
        constexpr auto largestWhole = std::numeric_limits<std::uint64_t>::max() / qpcTicksPerSecond - 1;
        if (seconds > largestWhole || fraction > largestWhole) return {};
        return QpcTime{seconds * qpcTicksPerSecond + fraction * qpcTicksPerSecond / frequency};
    }

private:
    std::uint64_t frequency = 0;
};
}
