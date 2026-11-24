#pragma once

#include "render_endpoints.hpp"
#include "shared_render.hpp"

namespace sonoravell {
struct WasapiOutputConfig {
    SharedRenderConfig stream;
    RenderEndpointChoice output;
};

struct WasapiOutputReport {
    SharedRenderReport stream;
    RenderEndpointChoice requested;
    RenderEndpointInfo resolved;
};

// Enumerates active render endpoints for the control thread. A failed
// enumeration throws; an empty inventory is a successful empty result.
std::vector<RenderEndpointInfo> listWasapiRenderEndpoints();

WasapiOutputReport runWasapiOutput(PlaybackMixer& mixer, WasapiOutputConfig config,
                                  const std::atomic<unsigned>& muteMask, std::atomic<unsigned>& played,
                                  std::stop_token stop) noexcept;
}
