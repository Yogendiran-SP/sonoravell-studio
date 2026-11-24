#include "shared_render.hpp"

#include <algorithm>
#include <cstdint>
#include <limits>

namespace sonoravell {
std::optional<unsigned> chooseRenderPeriod(unsigned requested, PeriodRange range) noexcept {
    if (!requested || !range.fundamental || !range.minimum || range.minimum > range.maximum) return {};
    const std::uint64_t step = range.fundamental;
    const auto first = (range.minimum + step - 1) / step;
    const auto last = range.maximum / step;
    if (first > last) return {};
    const auto nearest = (requested + step / 2) / step;
    return static_cast<unsigned>(std::clamp(nearest, first, last) * step);
}

TrackMutes decodeMuteMask(unsigned mask) noexcept {
    static_assert(maxTracks <= std::numeric_limits<unsigned>::digits);
    TrackMutes muted{};
    for (std::size_t track = 0; track < muted.size(); ++track) muted[track] = (mask & (1u << track)) != 0;
    return muted;
}

SharedRenderReport renderShared(SharedRenderEndpoint& endpoint, PlaybackMixer& mixer,
                                SharedRenderConfig config, const std::atomic<unsigned>& muteMask,
                                std::atomic<unsigned>& played, std::stop_token stop) noexcept {
    SharedRenderReport report;
    report.requestedFrames = config.requestedFrames;
    const auto fail = [&](RenderError error) {
        report.end = RenderEnd::failed;
        report.error = error;
        report.nativeError = endpoint.nativeError();
        if (error == RenderError::deviceInvalidated) ++report.deviceInvalidations;
        if (error == RenderError::timeout) ++report.waitTimeouts;
    };
    const auto submit = [&](unsigned frames) {
        std::span<std::int16_t> output;
        if (const auto error = endpoint.acquire(frames, output); error != RenderError::none) return error;
        if (output.size() != static_cast<std::size_t>(frames) * channelCount ||
            mixer.read(output, decodeMuteMask(muteMask.load(std::memory_order_relaxed))) != output.size()) {
            endpoint.release(0);
            return RenderError::invalidBuffer;
        }
        const auto error = endpoint.release(frames);
        if (error == RenderError::none) report.submittedFrames += frames;
        return error;
    };

    played.store(0, std::memory_order_relaxed);
    if (stop.stop_requested()) {
        report.end = RenderEnd::cancelled;
        return report;
    }
    if (mixer.finished()) return report;
    if (const auto error = endpoint.open(config, report); error != RenderError::none) {
        fail(error);
        return report;
    }
    // Reject anomalous or excessive buffering before any request to the endpoint.
    if (!report.bufferFrames || report.bufferFrames > sampleRate) {
        fail(RenderError::invalidBuffer);
        return report;
    }

    report.stage = RenderStage::prime;
    if (stop.stop_requested()) {
        report.end = RenderEnd::cancelled;
        return report;
    }
    if (const auto error = submit(std::min<unsigned>(report.bufferFrames, mixer.remainingFrames()));
        error != RenderError::none) {
        fail(error);
        return report;
    }
    report.stage = RenderStage::start;
    if (stop.stop_requested()) {
        report.end = RenderEnd::cancelled;
        return report;
    }
    if (const auto error = endpoint.start(); error != RenderError::none) {
        fail(error);
        return report;
    }

    for (;;) {
        report.stage = mixer.finished() ? RenderStage::drain : RenderStage::stream;
        bool cancelled = false;
        if (const auto error = endpoint.wait(stop, cancelled); error != RenderError::none) {
            fail(error);
            break;
        }
        if (cancelled || stop.stop_requested()) {
            report.end = RenderEnd::cancelled;
            break;
        }
        unsigned padding = 0;
        if (const auto error = endpoint.padding(padding); error != RenderError::none) {
            fail(error);
            break;
        }
        if (padding > report.bufferFrames || padding > report.submittedFrames) {
            fail(RenderError::invalidBuffer);
            break;
        }
        played.store(report.submittedFrames - padding, std::memory_order_relaxed);
        if (mixer.finished()) {
            if (!padding) break;
            continue;
        }
        if (!padding) ++report.emptyBufferEvents;
        const auto frames = std::min<unsigned>(report.bufferFrames - padding, mixer.remainingFrames());
        if (frames) {
            if (const auto error = submit(frames); error != RenderError::none) {
                fail(error);
                break;
            }
        }
    }

    const auto stopError = endpoint.stop();
    if (stopError != RenderError::none && report.end != RenderEnd::failed) {
        report.stage = RenderStage::stop;
        fail(stopError);
    }
    return report;
}
}
