#pragma once

#include <algorithm>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace sonoravell {
struct RenderEndpointInfo {
    std::wstring id;
    std::wstring name;
};

using RenderEndpointChoice = std::optional<RenderEndpointInfo>;

inline const RenderEndpointInfo* findRenderEndpoint(std::span<const RenderEndpointInfo> endpoints,
                                                    std::wstring_view id) noexcept {
    const auto item = std::ranges::find(endpoints, id, &RenderEndpointInfo::id);
    return item == endpoints.end() ? nullptr : &*item;
}

// Labels are for display. Keep the ID even if two endpoints share a name.
inline void sortRenderEndpoints(std::vector<RenderEndpointInfo>& endpoints) {
    std::ranges::sort(endpoints, [](const auto& a, const auto& b) {
        if (a.name == b.name) return a.id < b.id;
        return a.name < b.name;
    });
}

// The default lookup runs only for a deliberate default choice.
template<class Explicit, class Default>
auto routeRenderEndpoint(const RenderEndpointChoice& choice, Explicit direct, Default systemDefault) {
    if (choice) return direct(choice->id);
    return systemDefault();
}
}
