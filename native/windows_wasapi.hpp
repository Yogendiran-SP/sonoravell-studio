#pragma once

#include "audio_endpoints.hpp"
#include "shared_render.hpp"
#include "stream_clock.hpp"

namespace sonoravell {
struct WasapiOutputConfig {
    SharedRenderConfig stream;
    AudioEndpointChoice output;
};

struct WasapiOutputReport {
    SharedRenderReport stream;
    AudioEndpointChoice requested;
    AudioEndpointInfo resolved;
    StreamClock clock{};
};

// Enumerates active render endpoints for the control thread. A failed
// enumeration throws; an empty inventory is a successful empty result.
std::vector<AudioEndpointInfo> listWasapiRenderEndpoints();

WasapiOutputReport runWasapiOutput(PlaybackMixer& mixer, WasapiOutputConfig config,
                                  std::atomic<unsigned>& played,
                                  std::stop_token stop, std::uint64_t attempt = 0,
                                  std::atomic<bool>* ready = nullptr) noexcept;
}
