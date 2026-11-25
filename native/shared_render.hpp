#pragma once

#include "session.hpp"

#include <atomic>
#include <cstdint>
#include <stop_token>

namespace sonoravell {
enum class RenderError {
    none, unsupportedFormat, unsupportedPeriod, deviceUnavailable, deviceInvalidated, timeout, invalidBuffer, driver
};

enum class RenderStage { open, prime, start, stream, drain, stop };
enum class RenderEnd { completed, cancelled, failed };

struct SharedRenderConfig {
    // Zero requests the system event period. Other values are client frames.
    unsigned requestedFrames = 0;
};

struct SharedRenderReport {
    RenderEnd end = RenderEnd::completed;
    RenderStage stage = RenderStage::open;
    RenderError error = RenderError::none;
    std::uint32_t nativeError = 0;
    unsigned mixRate = 0, mixChannels = 0;
    unsigned requestedFrames = 0, selectedPeriodFrames = 0, bufferFrames = 0;
    bool conversionEnabled = false;
    unsigned emptyBufferEvents = 0;
    unsigned waitTimeouts = 0;
    unsigned deviceInvalidations = 0;
    std::uint64_t submittedFrames = 0;
};

class SharedRenderEndpoint {
public:
    virtual ~SharedRenderEndpoint() = default;
    virtual RenderError open(SharedRenderConfig config, SharedRenderReport& report) noexcept = 0;
    virtual RenderError padding(unsigned& frames) noexcept = 0;
    virtual RenderError acquire(unsigned frames, std::span<std::int16_t>& output) noexcept = 0;
    virtual RenderError release(unsigned frames) noexcept = 0;
    virtual RenderError start() noexcept = 0;
    virtual RenderError stop() noexcept = 0;
    virtual RenderError wait(std::stop_token stop, bool& cancelled) noexcept = 0;
    virtual std::uint32_t nativeError() const noexcept = 0;
};

// Single worker owns the endpoint and mixer. The loop uses only prepared
// device buffers and atomics. The endpoint owns its platform resources.
SharedRenderReport renderShared(SharedRenderEndpoint& endpoint, PlaybackMixer& mixer,
                                SharedRenderConfig config, std::atomic<std::uint64_t>& played, std::stop_token stop,
                                std::atomic<bool>* ready = nullptr) noexcept;
}
