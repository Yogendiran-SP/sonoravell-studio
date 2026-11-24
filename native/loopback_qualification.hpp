#pragma once

#include "project.hpp"

#include <array>
#include <optional>
#include <span>

namespace sonoravell {
inline constexpr unsigned qualificationFrames = 24 * sampleRate;
inline constexpr std::array qualificationMarkerFrames{
    sampleRate, 3 * sampleRate, 5 * sampleRate, 8 * sampleRate,
    11 * sampleRate, 15 * sampleRate, 20 * sampleRate, 23 * sampleRate
};
inline constexpr unsigned qualificationMarkerLength = 576;

Project makeQualificationSession();

struct LoopbackOptions {
    unsigned searchFrames = 2 * sampleRate;
    unsigned shiftFrames = 96;
};

enum class MarkerStatus { missing, matched, duplicate, shifted, searchEdge };

struct LoopbackMarker {
    unsigned referenceFrame = 0;
    std::optional<unsigned> capturedFrame;
    unsigned candidates = 0;
    MarkerStatus status = MarkerStatus::missing;
    double score = 0;
    unsigned peakFirst = 0, peakLast = 0;
};

struct LoopbackTiming {
    double medianFrames;
    double minimumFrames;
    double maximumFrames;
    double signalDriftPpm;
    double maximumResidualFrames;
    double medianPeakFirstFrames;
    double medianPeakLastFrames;
};

struct LoopbackReport {
    unsigned capturedFrames = 0;
    unsigned clippedFrames = 0;
    std::uint64_t pcmFingerprint = 0;
    LoopbackOptions options;
    std::array<LoopbackMarker, qualificationMarkerFrames.size()> markers;
    std::optional<LoopbackTiming> timing;
};

LoopbackReport analyzeLoopback(std::span<const std::int16_t> mono, LoopbackOptions options = {});
std::uint64_t loopbackPcmFingerprint(std::span<const std::int16_t> pcm, bool stereo = false) noexcept;
const char* markerStatusName(MarkerStatus status) noexcept;

// A paired transport observation. Its clock-origin delta never substitutes for
// a matched audio signal or for an independently calibrated round trip.
struct LoopbackClockEvidence {
    std::uint64_t attempt = 0;
    unsigned playbackStartFrame = 0, verifiedFrames = 0;
    std::uint64_t pcmFingerprint = 0;
    std::uint64_t firstCaptureDeviceFrame = 0;
    double captureStartOffsetSeconds = 0;
    double captureRateRatio = 0, renderRateRatio = 0;
};

struct LoopbackClockComparison {
    double qpcRelativeDriftPpm;
    double signalMinusQpcDriftPpm;
    double medianClockReferencedSignalMs;
};

void writeLoopbackClockEvidence(std::ostream&, const LoopbackClockEvidence&);
LoopbackClockEvidence readLoopbackClockEvidence(std::istream&);
std::optional<LoopbackClockComparison> compareLoopbackClocks(const LoopbackReport&, const LoopbackClockEvidence&);
}
