#include "shared_capture.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>

namespace sonoravell {
namespace {
template<class Sample>
Sample loadSample(std::span<const std::byte> source, std::size_t index) noexcept {
    Sample value;
    std::memcpy(&value, source.data() + index * sizeof(value), sizeof(value));
    return value;
}

bool convert(const CapturePacket& packet, const CaptureStreamReport& report,
             std::span<std::int16_t> mono) noexcept {
    if (packet.silent) {
        std::ranges::fill(mono, 0);
        return true;
    }
    const auto width = report.encoding == CaptureEncoding::pcm16 ? sizeof(std::int16_t) : sizeof(float);
    if (packet.bytes.size() != packet.frames * report.channels * width) return false;
    for (std::size_t frame = 0; frame < mono.size(); ++frame) {
        const auto index = frame * report.channels;
        if (report.encoding == CaptureEncoding::pcm16) {
            int sample = loadSample<std::int16_t>(packet.bytes, index);
            if (report.channels == 2) sample = (sample + loadSample<std::int16_t>(packet.bytes, index + 1)) / 2;
            mono[frame] = static_cast<std::int16_t>(sample);
        } else {
            double sample = loadSample<float>(packet.bytes, index);
            if (report.channels == 2) sample = (sample + loadSample<float>(packet.bytes, index + 1)) / 2;
            if (!std::isfinite(sample)) return false;
            const auto scaled = std::lround(std::clamp(sample, -1.0, 1.0) * 32768.0);
            mono[frame] = static_cast<std::int16_t>(std::clamp(scaled, -32768L, 32767L));
        }
    }
    return true;
}
}

std::optional<double> CaptureTiming::driftPpm() const noexcept {
    if (!first || !last || last->qpc100ns <= first->qpc100ns ||
        last->deviceFrame <= first->deviceFrame) return {};
    const auto frames = static_cast<double>(last->deviceFrame - first->deviceFrame);
    const auto elapsed = static_cast<double>(last->qpc100ns - first->qpc100ns);
    return (frames * 10000000.0 / (elapsed * sampleRate) - 1.0) * 1000000.0;
}

CaptureStreamReport captureShared(SharedCaptureEndpoint& endpoint, CaptureSink& sink,
                                  CaptureStreamConfig config, unsigned limit) noexcept {
    CaptureStreamReport report;
    report.requestedPeriodFrames = config.requestedFrames;
    const auto fail = [&](CaptureStage stage, CaptureError error, std::uint32_t code = 0) {
        report.end = CaptureEnd::interrupted;
        report.error = error;
        report.stage = stage;
        report.nativeError = code;
    };
    if (endpoint.stoppedByUserOrWriter()) {
        report.end = CaptureEnd::stopped;
        return report;
    }
    const auto open = endpoint.open(config, report);
    if (open != CaptureError::none) {
        fail(CaptureStage::open, open, endpoint.nativeError());
        return report;
    }
    if (report.rate != sampleRate || (report.channels != 1 && report.channels != 2) ||
        (report.encoding != CaptureEncoding::pcm16 && report.encoding != CaptureEncoding::float32)) {
        fail(CaptureStage::open, CaptureError::unsupportedFormat);
        return report;
    }
    if (!report.bufferFrames || report.bufferFrames > takeBlockFrames) {
        fail(CaptureStage::open, CaptureError::unsupportedBuffer);
        return report;
    }
    if (!limit || endpoint.stoppedByUserOrWriter()) {
        report.end = limit ? CaptureEnd::stopped : CaptureEnd::limit;
        return report;
    }
    std::array<std::int16_t, takeBlockFrames> scratch;
    const auto start = endpoint.start();
    if (start != CaptureError::none) {
        fail(CaptureStage::start, start, endpoint.nativeError());
        return report;
    }
    std::optional<std::uint64_t> nextFrame;
    while (report.acceptedFrames < limit && !endpoint.stoppedByUserOrWriter()) {
        if (const auto error = endpoint.wait(); error != CaptureError::none) {
            fail(CaptureStage::wait, error, endpoint.nativeError());
            break;
        }
        // Drain all packets for this event. Each pass polls cancellation, and
        // the recorded frame limit also bounds work if the device never empties.
        while (!endpoint.stoppedByUserOrWriter() && report.acceptedFrames < limit) {
            CapturePacket packet;
            if (const auto error = endpoint.acquire(packet); error != CaptureError::none) {
                fail(CaptureStage::acquire, error, endpoint.nativeError());
                break;
            }
            if (!packet.frames) break;
            const auto mono = std::span(scratch).first(std::min({packet.frames, limit - report.acceptedFrames,
                                                                 static_cast<unsigned>(scratch.size())}));
            CaptureError error = CaptureError::none;
            if (packet.frames > report.bufferFrames) error = CaptureError::invalidPacket;
            else if (packet.discontinuity) error = CaptureError::discontinuity;
            else if (!packet.deviceFrame || *packet.deviceFrame > std::numeric_limits<std::uint64_t>::max() - packet.frames) {
                error = CaptureError::missingPosition;
            } else if (nextFrame && *packet.deviceFrame != *nextFrame) error = CaptureError::discontinuity;
            else if (!convert(packet, report, mono)) error = CaptureError::invalidPacket;

            const auto release = endpoint.release(error == CaptureError::none ? packet.frames : 0);
            if (error != CaptureError::none) {
                fail(CaptureStage::packet, error);
                break;
            }
            if (release != CaptureError::none) {
                fail(CaptureStage::release, release, endpoint.nativeError());
                break;
            }
            if (const auto result = sink.push(mono); result != CaptureError::none) {
                fail(CaptureStage::queue, result);
                break;
            }
            nextFrame = *packet.deviceFrame + packet.frames;
            report.acceptedFrames += static_cast<unsigned>(mono.size());
            if (packet.silent) report.silentFrames += static_cast<unsigned>(mono.size());
            report.timing.lastDeviceFrame = packet.deviceFrame;
            if (!report.timing.firstDeviceFrame) report.timing.firstDeviceFrame = packet.deviceFrame;
            if (packet.timestampError || !packet.qpc100ns || !*packet.qpc100ns ||
                (report.timing.last && *packet.qpc100ns <= report.timing.last->qpc100ns)) {
                ++report.timing.unreliableTimestamps;
            } else {
                report.timing.last = CaptureStamp{*packet.deviceFrame, *packet.qpc100ns};
                if (!report.timing.first) report.timing.first = report.timing.last;
            }
        }
        if (report.error != CaptureError::none) break;
    }
    if (const auto error = endpoint.stop(); error != CaptureError::none && report.error == CaptureError::none) {
        fail(CaptureStage::stop, error, endpoint.nativeError());
    }
    if (report.error == CaptureError::none) {
        report.stage = CaptureStage::stop;
        report.end = report.acceptedFrames == limit ? CaptureEnd::limit : CaptureEnd::stopped;
    }
    return report;
}

const char* captureErrorText(CaptureError error) noexcept {
    switch (error) {
    case CaptureError::none: return "None";
    case CaptureError::deviceUnavailable: return "Input unavailable. Reconnect it or choose another input.";
    case CaptureError::unsupportedFormat: return "Unsupported input format. Set a 48 kHz mono or stereo format in Windows, or try WinMM.";
    case CaptureError::unsupportedBuffer: return "Unsupported capture buffer. Try the system buffer or WinMM.";
    case CaptureError::deviceInvalidated: return "Input disconnected or invalidated. Reconnect it before recording again.";
    case CaptureError::discontinuity: return "Capture stopped at an audio discontinuity.";
    case CaptureError::missingPosition: return "Capture stopped because the device frame position was missing or invalid.";
    case CaptureError::invalidPacket: return "Capture stopped because the device returned an invalid packet.";
    case CaptureError::timeout: return "Timed out waiting for capture events.";
    case CaptureError::driver: return "Windows audio driver or service error.";
    case CaptureError::queueFull: return "Capture queue full. Recording stopped at the first packet it could not queue.";
    case CaptureError::storage: return "Recording storage write failed. Check disk space and permissions.";
    }
    return "Unknown capture error.";
}

const char* captureStageText(CaptureStage stage) noexcept {
    switch (stage) {
    case CaptureStage::open: return "Open";
    case CaptureStage::start: return "Start";
    case CaptureStage::wait: return "Wait";
    case CaptureStage::acquire: return "Acquire";
    case CaptureStage::packet: return "Validate packet";
    case CaptureStage::release: return "Release";
    case CaptureStage::queue: return "Enqueue";
    case CaptureStage::stop: return "Stop";
    }
    return "Unknown";
}
}
