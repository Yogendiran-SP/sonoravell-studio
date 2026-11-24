#pragma once

#include "audio_endpoints.hpp"
#include "shared_render.hpp"

namespace sonoravell {
struct WasapiOutputConfig {
    SharedRenderConfig stream;
    AudioEndpointChoice output;
};

struct WasapiOutputReport {
    SharedRenderReport stream;
    AudioEndpointChoice requested;
    AudioEndpointInfo resolved;
};

// Enumerates active render endpoints for the control thread. A failed
// enumeration throws; an empty inventory is a successful empty result.
std::vector<AudioEndpointInfo> listWasapiRenderEndpoints();

WasapiOutputReport runWasapiOutput(PlaybackMixer& mixer, WasapiOutputConfig config,
                                  const std::atomic<unsigned>& muteMask, std::atomic<unsigned>& played,
                                  std::stop_token stop) noexcept;
}
