#include "stream_clock.hpp"

#include <algorithm>

namespace sonoravell {
namespace {
constexpr auto minCorrelationTicks = qpcTicksPerSecond / 10;

double signedSeconds(QpcTime a, QpcTime b) noexcept {
    // Subtract in the integer domain to retain small offsets late in a boot.
    if (a.ticks100ns >= b.ticks100ns) return static_cast<double>(a.ticks100ns - b.ticks100ns) / qpcTicksPerSecond;
    return -static_cast<double>(b.ticks100ns - a.ticks100ns) / qpcTicksPerSecond;
}

bool isFresh(const StreamClock& stream, QpcTime now) noexcept {
    if (!stream.last() || stream.rejected().reset) return false;
    const auto last = stream.last()->qpc.ticks100ns;
    return now.ticks100ns >= last && now.ticks100ns - last <= clockMaxSampleAge;
}
}

StreamClock::StreamClock(std::uint64_t unitsPerSecond, std::uint64_t attempt, ClockPosition origin) noexcept
    : unitRate(unitsPerSecond), attemptId(attempt), streamOrigin(origin) {}

void StreamClock::observe(std::optional<ClockStamp> stamp, std::optional<QpcTime> observedAt) noexcept {
    if (rejections.reset) return;
    if (!unitRate || !observedAt || !observedAt->ticks100ns) {
        ++rejections.missing;
        return;
    }
    const auto now = observedAt->ticks100ns;
    if (lastObservation && now < lastObservation->ticks100ns) {
        rejections.reset = true;
        return;
    }
    lastObservation = observedAt;
    if (!stamp || !stamp->qpc.ticks100ns) {
        ++rejections.missing;
        return;
    }
    const auto qpc = stamp->qpc.ticks100ns;
    if (qpc > now) {
        ++rejections.nonmonotonic;
        return;
    }
    if (now - qpc > clockMaxSampleAge) {
        ++rejections.stale;
        return;
    }
    if (lastStamp && qpc < lastStamp->qpc.ticks100ns) {
        ++rejections.nonmonotonic;
        return;
    }
    if (stamp->position.units < streamOrigin.units ||
        (lastStamp && stamp->position.units < lastStamp->position.units)) {
        rejections.reset = true;
        return;
    }
    if (lastStamp && stamp->position.units == lastStamp->position.units) {
        ++rejections.stale;
        return;
    }
    if (lastStamp && qpc == lastStamp->qpc.ticks100ns) {
        ++rejections.nonmonotonic;
        return;
    }
    if (!firstStamp) firstStamp = stamp;
    lastStamp = stamp;
}

std::optional<double> StreamClock::rateRatio() const noexcept {
    if (rejections.reset || !firstStamp || !lastStamp || lastStamp->qpc.ticks100ns <= firstStamp->qpc.ticks100ns) return {};
    const auto positionDelta = static_cast<double>(lastStamp->position.units - firstStamp->position.units);
    return (positionDelta / static_cast<double>(unitRate)) / signedSeconds(lastStamp->qpc, firstStamp->qpc);
}

std::optional<ClockCorrelation> correlateClocks(const StreamClock& capture, const StreamClock& render,
                                               QpcTime now) noexcept {
    if (!capture.attempt() || capture.attempt() != render.attempt() ||
        !isFresh(capture, now) || !isFresh(render, now)) return {};
    const auto overlapStart = std::max(capture.first()->qpc.ticks100ns, render.first()->qpc.ticks100ns);
    const auto overlapEnd = std::min(capture.last()->qpc.ticks100ns, render.last()->qpc.ticks100ns);
    if (overlapEnd <= overlapStart || overlapEnd - overlapStart < minCorrelationTicks) return {};

    const auto captureRatio = capture.rateRatio();
    const auto renderRatio = render.rateRatio();
    if (!captureRatio || !renderRatio) return {};
    const auto elapsedAtFirst = [](const StreamClock& stream, double ratio) {
        const auto position = stream.first()->position.units - stream.origin().units;
        return static_cast<double>(position) / static_cast<double>(stream.unitsPerSecond()) / ratio;
    };
    // Limit back-extrapolation if the beginning of a stream was unobserved.
    const auto captureElapsed = elapsedAtFirst(capture, *captureRatio);
    const auto renderElapsed = elapsedAtFirst(render, *renderRatio);
    const auto maxExtrapolation = static_cast<double>(clockMaxSampleAge) / qpcTicksPerSecond;
    if (captureElapsed > maxExtrapolation || renderElapsed > maxExtrapolation) return {};
    const auto startOffset = signedSeconds(capture.first()->qpc, render.first()->qpc) - captureElapsed + renderElapsed;
    return ClockCorrelation{startOffset, (*captureRatio / *renderRatio - 1.0) * 1'000'000.0};
}
}
