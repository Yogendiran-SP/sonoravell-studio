#pragma once

#include "audio_endpoints.hpp"
#include "shared_capture.hpp"

namespace sonoravell {
struct WasapiInputConfig {
    CaptureStreamConfig stream;
    AudioEndpointChoice input;
};

struct WasapiInputReport {
    CaptureStreamReport stream;
    AudioEndpointChoice requested;
    AudioEndpointInfo resolved;
};

std::vector<AudioEndpointInfo> listWasapiCaptureEndpoints();

// Called only by the capture worker. The event is a borrowed Windows HANDLE.
WasapiInputReport runWasapiCapture(CaptureSink&, WasapiInputConfig, unsigned limit, void* stopEvent,
                                   std::atomic<bool>* ready = nullptr) noexcept;
}
