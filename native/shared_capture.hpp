#pragma once

#include "take_journal.hpp"

#include <cstddef>
#include <optional>

namespace sonoravell {
enum class CaptureEncoding { unsupported, pcm16, float32 };
enum class CaptureError {
    none, deviceUnavailable, unsupportedFormat, unsupportedBuffer, deviceInvalidated,
    discontinuity, missingPosition, invalidPacket, timeout, driver, queueFull, storage
};
enum class CaptureStage { open, start, wait, acquire, packet, release, queue, stop };
enum class CaptureEnd { limit, stopped, interrupted };

struct CaptureStamp {
    std::uint64_t deviceFrame;
    std::uint64_t qpc100ns;
};

struct CaptureTiming {
    std::optional<CaptureStamp> first, last;
    std::optional<std::uint64_t> firstDeviceFrame, lastDeviceFrame;
    unsigned unreliableTimestamps = 0;
    std::optional<double> driftPpm() const noexcept;
};

struct CaptureStreamConfig {
    unsigned requestedFrames = 0; // Zero lets Windows choose the event period.
};

struct CaptureStreamReport {
    CaptureEnd end = CaptureEnd::interrupted;
    CaptureError error = CaptureError::none;
    CaptureStage stage = CaptureStage::open;
    std::uint32_t nativeError = 0;
    CaptureEncoding encoding = CaptureEncoding::unsupported;
    unsigned rate = 0, channels = 0, bufferFrames = 0, requestedPeriodFrames = 0, selectedPeriodFrames = 0;
    unsigned acceptedFrames = 0, silentFrames = 0;
    CaptureTiming timing;
};

struct CapturePacket {
    std::span<const std::byte> bytes;
    unsigned frames = 0;
    bool silent = false, discontinuity = false, timestampError = false;
    std::optional<std::uint64_t> deviceFrame, qpc100ns;
};

class SharedCaptureEndpoint {
public:
    virtual ~SharedCaptureEndpoint() = default;
    virtual CaptureError open(CaptureStreamConfig, CaptureStreamReport&) noexcept = 0;
    virtual CaptureError start() noexcept = 0;
    virtual CaptureError wait() noexcept = 0;
    virtual bool stoppedByUserOrWriter() const noexcept = 0;
    // A successful nonempty acquisition must be paired with a release.
    virtual CaptureError acquire(CapturePacket&) noexcept = 0;
    virtual CaptureError release(unsigned frames) noexcept = 0;
    virtual CaptureError stop() noexcept = 0;
    virtual std::uint32_t nativeError() const noexcept = 0;
};

class CaptureSink {
public:
    virtual ~CaptureSink() = default;
    virtual CaptureError push(std::span<const std::int16_t>) noexcept = 0;
};

CaptureStreamReport captureShared(SharedCaptureEndpoint&, CaptureSink&, CaptureStreamConfig,
                                  unsigned frameLimit) noexcept;
const char* captureErrorText(CaptureError) noexcept;
const char* captureStageText(CaptureStage) noexcept;
}
