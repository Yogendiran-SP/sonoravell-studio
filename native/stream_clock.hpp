#pragma once

#include <cstdint>
#include <optional>

namespace sonoravell {
inline constexpr std::uint64_t qpcTicksPerSecond = 10'000'000;
inline constexpr std::uint64_t clockMaxSampleAge = 2 * qpcTicksPerSecond;

struct QpcTime {
    std::uint64_t ticks100ns;
};

// Capture uses stream frames. IAudioClock uses its reported frequency.
struct ClockPosition {
    std::uint64_t units;
};

struct ClockStamp {
    ClockPosition position;
    QpcTime qpc;
};

struct ClockRejections {
    unsigned missing = 0;
    unsigned stale = 0;
    unsigned nonmonotonic = 0;
    bool reset = false;
};

// One worker owns this value for one stream run. Sample collection is fixed-size
// and integer-only. Take a copy after joining the worker to calculate estimates.
class StreamClock {
public:
    // A nonzero attempt identifies a pair of streams deliberately started for
    // the same operation. Independent transport previews use zero.
    explicit StreamClock(std::uint64_t unitsPerSecond = 0, std::uint64_t attempt = 0,
                         ClockPosition origin = {0}) noexcept;

    void observe(std::optional<ClockStamp> stamp, std::optional<QpcTime> observedAt) noexcept;
    std::uint64_t unitsPerSecond() const noexcept { return unitRate; }
    std::uint64_t attempt() const noexcept { return attemptId; }
    ClockPosition origin() const noexcept { return streamOrigin; }
    const std::optional<ClockStamp>& first() const noexcept { return firstStamp; }
    const std::optional<ClockStamp>& last() const noexcept { return lastStamp; }
    ClockRejections rejected() const noexcept { return rejections; }

    // A ratio of 1 means this stream follows its nominal frequency.
    std::optional<double> rateRatio() const noexcept;

private:
    std::uint64_t unitRate, attemptId;
    ClockPosition streamOrigin;
    std::optional<ClockStamp> firstStamp, lastStamp;
    std::optional<QpcTime> lastObservation;
    ClockRejections rejections;
};

struct ClockCorrelation {
    // Capture origin relative to render origin. Positive means capture started later.
    double captureStartOffsetSeconds;
    // Fractional capture speed relative to render, after normalizing each rate.
    double captureRelativeDriftPpm;
};

// Estimates use overlapping fresh evidence from the same coordinated attempt.
// Positions are stream-relative. A Session placement is a separate transport decision.
std::optional<ClockCorrelation> correlateClocks(const StreamClock& capture, const StreamClock& render,
                                               QpcTime now) noexcept;
}
