#pragma once

#include <array>
#include <algorithm>
#include <cstdint>
#include <optional>
#include <span>

namespace sonoravell {
inline constexpr unsigned defaultPanelWidth = 173;
inline constexpr unsigned maxPanelWidth = 277;
inline constexpr unsigned panelWidthStep = 26;

struct WorkspaceLayout {
    bool inspector = true;
    bool browser = true;
    bool mixer = true;
    bool focus = false;
    unsigned inspectorWidth = defaultPanelWidth;
    unsigned browserWidth = defaultPanelWidth;
    bool operator==(const WorkspaceLayout&) const = default;
};

using WorkspaceBytes = std::array<std::uint8_t, 9>;

inline WorkspaceBytes encodeWorkspace(WorkspaceLayout layout) noexcept {
    const auto width = [](unsigned value) { return std::clamp(value, defaultPanelWidth, maxPanelWidth); };
    const auto left = width(layout.inspectorWidth);
    const auto right = width(layout.browserWidth);
    return {'S', 'N', 'L', 1,
            static_cast<std::uint8_t>(layout.inspector | (layout.browser << 1) | (layout.mixer << 2) | (layout.focus << 3)),
            static_cast<std::uint8_t>(left & 255), static_cast<std::uint8_t>(left >> 8),
            static_cast<std::uint8_t>(right & 255), static_cast<std::uint8_t>(right >> 8)};
}

inline std::optional<WorkspaceLayout> decodeWorkspace(std::span<const std::uint8_t> bytes) noexcept {
    if (bytes.size() != WorkspaceBytes{}.size() || bytes[0] != 'S' || bytes[1] != 'N' || bytes[2] != 'L' ||
        bytes[3] != 1 || bytes[4] > 15) return {};
    const auto left = static_cast<unsigned>(bytes[5] | (bytes[6] << 8));
    const auto right = static_cast<unsigned>(bytes[7] | (bytes[8] << 8));
    if (left < defaultPanelWidth || left > maxPanelWidth || right < defaultPanelWidth || right > maxPanelWidth) return {};
    const auto bits = bytes[4];
    return WorkspaceLayout{(bits & 1) != 0, (bits & 2) != 0, (bits & 4) != 0, (bits & 8) != 0, left, right};
}
}
