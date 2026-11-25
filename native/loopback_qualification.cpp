#include "loopback_qualification.hpp"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <istream>
#include <limits>
#include <locale>
#include <ostream>
#include <stdexcept>
#include <string>

namespace sonoravell {
namespace {
constexpr unsigned chipFrames = 12;
constexpr unsigned chips = qualificationMarkerLength / chipFrames;
constexpr unsigned hop = 4;
constexpr double coarseFloor = 0.68;
constexpr double matchFloor = 0.72;
constexpr double peakTolerance = 0.025;
constexpr auto clockVersion = "SONORAVELL_DUPLEX_CLOCK_1";

using MarkerCode = std::array<int, chips>;

MarkerCode codeFor(unsigned marker) {
    MarkerCode code{};
    std::uint32_t state = 0x9e3779b9u * (marker + 1);
    for (unsigned i = 0; i < chips; i += 2) {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        code[i] = state & 1u ? 1 : -1;
        code[i + 1] = -code[i];
    }
    return code;
}

std::array<std::int16_t, qualificationMarkerLength> waveform(const MarkerCode& code) {
    std::array<std::int16_t, qualificationMarkerLength> result{};
    for (unsigned i = 0; i < result.size(); ++i) {
        const auto pos = i % chipFrames;
        const auto triangle = static_cast<int>(std::min(pos + 1, chipFrames - pos));
        result[i] = static_cast<std::int16_t>(code[i / chipFrames] * triangle * 640);
    }
    return result;
}

double normalized(double dot, double sum, double energy, unsigned count, double referenceEnergy) {
    const auto variance = energy - sum * sum / count;
    if (variance <= 0) return 0;
    return std::min(1.0, std::abs(dot) / std::sqrt(variance * referenceEnergy));
}

struct Peak {
    unsigned frame, first, last;
    double score;
};

LoopbackMarker locate(unsigned index, std::span<const std::int16_t> mono, const std::vector<std::int64_t>& prefix,
                      unsigned radius) {
    LoopbackMarker result;
    result.referenceFrame = qualificationMarkerFrames[index];
    const auto lower = result.referenceFrame > radius ? result.referenceFrame - radius : 0;
    if (mono.size() < qualificationMarkerLength) return result;
    const auto upper = std::min<unsigned>(static_cast<unsigned>(mono.size()) - qualificationMarkerLength,
                                          result.referenceFrame + radius);
    if (lower > upper) return result;
    const auto code = codeFor(index);
    const auto wave = waveform(code);
    double waveEnergy = 0;
    for (double x : wave) waveEnergy += x * x;
    const auto refine = [&](unsigned coarse) {
        const auto from = std::max(lower, coarse > hop ? coarse - hop : 0);
        const auto to = std::min(upper, coarse + hop);
        std::array<double, 2 * hop + 1> scores{};
        Peak peak{coarse, coarse, coarse, 0};
        for (unsigned at = from; at <= to; ++at) {
            double dot = 0, sum = 0, energy = 0;
            for (unsigned k = 0; k < wave.size(); ++k) {
                const auto x = static_cast<double>(mono[at + k]);
                dot += x * wave[k];
                sum += x;
                energy += x * x;
            }
            const auto score = normalized(dot, sum, energy, qualificationMarkerLength, waveEnergy);
            scores[at - from] = score;
            if (score > peak.score) peak = {at, at, at, score};
        }
        while (peak.first > from && scores[peak.first - from - 1] >= peak.score - peakTolerance) --peak.first;
        while (peak.last < to && scores[peak.last - from + 1] >= peak.score - peakTolerance) ++peak.last;
        return peak;
    };

    std::optional<Peak> best;
    unsigned coarseFrame = lower, lastAbove = lower;
    double coarseScore = 0;
    const auto closeCluster = [&] {
        if (!coarseScore) return;
        const auto peak = refine(coarseFrame);
        if (peak.score >= matchFloor) {
            ++result.candidates;
            if (!best || peak.score > best->score) best = peak;
        }
        coarseScore = 0;
    };
    for (unsigned frame = lower;; frame = std::min(frame + hop, upper)) {
        double dot = 0, energy = 0;
        for (unsigned chip = 0; chip < chips; ++chip) {
            const auto pos = frame + chip * chipFrames;
            const auto value = static_cast<double>(prefix[pos + chipFrames] - prefix[pos]);
            dot += code[chip] * value;
            energy += value * value;
        }
        const auto score = normalized(dot, static_cast<double>(prefix[frame + qualificationMarkerLength] - prefix[frame]),
                                      energy, chips, chips);
        if (score >= coarseFloor) {
            if (frame - lastAbove >= qualificationMarkerLength) closeCluster();
            lastAbove = frame;
            if (score > coarseScore) {
                coarseFrame = frame;
                coarseScore = score;
            }
        }
        if (frame == upper) break;
    }
    closeCluster();
    if (!best) return result;
    result.capturedFrame = best->frame;
    result.score = best->score;
    result.peakFirst = best->first;
    result.peakLast = best->last;
    result.status = result.candidates > 1 ? MarkerStatus::duplicate
                  : best->frame == lower || best->frame == upper ? MarkerStatus::searchEdge : MarkerStatus::matched;
    return result;
}

double median(std::vector<double> values) {
    std::ranges::sort(values);
    const auto middle = values.size() / 2;
    return values.size() % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

double displacement(const LoopbackMarker& marker) {
    return static_cast<double>(*marker.capturedFrame) - marker.referenceFrame;
}

bool validClock(const LoopbackClockEvidence& qpc) {
    return qpc.attempt && qpc.verifiedFrames && std::isfinite(qpc.captureStartOffsetSeconds) &&
           std::isfinite(qpc.captureRateRatio) && qpc.captureRateRatio > 0 &&
           std::isfinite(qpc.renderRateRatio) && qpc.renderRateRatio > 0;
}
}

Project makeQualificationSession() {
    Project project;
    project.name = "WASAPI Loopback Reference 1";
    project.bars = 14; // 28 seconds at 120 BPM, including a quiet capture tail.
    Samples stereo(qualificationFrames * channelCount);
    for (unsigned marker = 0; marker < qualificationMarkerFrames.size(); ++marker) {
        const auto wave = waveform(codeFor(marker));
        for (unsigned i = 0; i < wave.size(); ++i) {
            const auto index = (qualificationMarkerFrames[marker] + i) * channelCount;
            stereo[index] = stereo[index + 1] = wave[i];
        }
    }
    project.assets.push_back({1, "Loopback markers", std::move(stereo)});
    project.tracks.push_back({1, "Loopback reference", Instrument::audio, false, 100, {}, {wholeAudioClip(1, project.assets.front(), 0)}});
    return project;
}

LoopbackReport analyzeLoopback(std::span<const std::int16_t> mono, LoopbackOptions options) {
    if (mono.empty() || mono.size() > maxAssetSamples / channelCount ||
        !options.searchFrames || options.searchFrames > 10 * sampleRate || !options.shiftFrames) {
        throw std::invalid_argument("Use up to 120 seconds of 48 kHz audio, a search up to 10 seconds, and positive tolerances.");
    }
    LoopbackReport report;
    report.capturedFrames = static_cast<unsigned>(mono.size());
    report.pcmFingerprint = loopbackPcmFingerprint(mono);
    report.options = options;
    std::vector<std::int64_t> prefix(mono.size() + 1);
    for (std::size_t i = 0; i < mono.size(); ++i) {
        prefix[i + 1] = prefix[i] + mono[i];
        if (mono[i] == std::numeric_limits<std::int16_t>::min() || mono[i] == std::numeric_limits<std::int16_t>::max()) {
            ++report.clippedFrames;
        }
    }
    std::vector<const LoopbackMarker*> matched;
    for (unsigned i = 0; i < report.markers.size(); ++i) {
        auto& marker = report.markers[i];
        marker = locate(i, mono, prefix, options.searchFrames);
        if (marker.status == MarkerStatus::matched) matched.push_back(&marker);
    }
    if (matched.size() < 4) return report;

    std::vector<double> slopes, intercepts, offsets, lowerPeaks, upperPeaks;
    for (std::size_t i = 0; i < matched.size(); ++i) {
        for (std::size_t j = i + 1; j < matched.size(); ++j) {
            slopes.push_back((displacement(*matched[j]) - displacement(*matched[i])) /
                             (matched[j]->referenceFrame - matched[i]->referenceFrame));
        }
    }
    const auto slope = median(std::move(slopes));
    for (const auto* marker : matched) intercepts.push_back(displacement(*marker) - slope * marker->referenceFrame);
    const auto intercept = median(std::move(intercepts));
    double residual = 0;
    unsigned previous = 0;
    for (auto& marker : report.markers) {
        if (marker.status != MarkerStatus::matched) continue;
        const auto offset = displacement(marker);
        const auto distance = std::abs(offset - intercept - slope * marker.referenceFrame);
        if (*marker.capturedFrame <= previous || distance > options.shiftFrames) marker.status = MarkerStatus::shifted;
        previous = *marker.capturedFrame;
        residual = std::max(residual, distance);
        offsets.push_back(offset);
        lowerPeaks.push_back(static_cast<double>(marker.peakFirst) - marker.referenceFrame);
        upperPeaks.push_back(static_cast<double>(marker.peakLast) - marker.referenceFrame);
    }
    if (!report.clippedFrames && std::ranges::all_of(report.markers, [](const auto& m) { return m.status == MarkerStatus::matched; })) {
        const auto [low, high] = std::ranges::minmax(offsets);
        report.timing = LoopbackTiming{median(offsets), low, high, slope * 1'000'000.0, residual,
                                      median(std::move(lowerPeaks)), median(std::move(upperPeaks))};
    }
    return report;
}

std::uint64_t loopbackPcmFingerprint(std::span<const std::int16_t> pcm, bool stereo) noexcept {
    // FNV-1a on little-endian PCM values from the same channel the analyzer reads.
    std::uint64_t hash = 14695981039346656037ull;
    const unsigned stride = stereo ? channelCount : 1;
    for (std::size_t i = 0; i < pcm.size(); i += stride) {
        const auto sample = static_cast<std::uint16_t>(pcm[i]);
        hash = (hash ^ (sample & 0xffu)) * 1099511628211ull;
        hash = (hash ^ (sample >> 8)) * 1099511628211ull;
    }
    return hash;
}

const char* markerStatusName(MarkerStatus status) noexcept {
    switch (status) {
    case MarkerStatus::missing: return "missing";
    case MarkerStatus::matched: return "matched";
    case MarkerStatus::duplicate: return "duplicate";
    case MarkerStatus::shifted: return "shifted";
    case MarkerStatus::searchEdge: return "search_edge";
    }
    return "unknown";
}

void writeLoopbackClockEvidence(std::ostream& output, const LoopbackClockEvidence& qpc) {
    if (!validClock(qpc)) throw std::invalid_argument("Invalid paired clock evidence.");
    output.imbue(std::locale::classic());
    output << clockVersion << '\n'
           << qpc.attempt << '\t' << qpc.playbackStartFrame << '\t' << qpc.verifiedFrames << '\t'
           << qpc.pcmFingerprint << '\t'
           << qpc.firstCaptureDeviceFrame << '\t' << std::setprecision(17) << qpc.captureStartOffsetSeconds << '\t'
           << qpc.captureRateRatio << '\t' << qpc.renderRateRatio << '\n';
}

LoopbackClockEvidence readLoopbackClockEvidence(std::istream& input) {
    input.imbue(std::locale::classic());
    std::string version;
    LoopbackClockEvidence qpc;
    if (!(input >> version >> qpc.attempt >> qpc.playbackStartFrame >> qpc.verifiedFrames >> qpc.pcmFingerprint >>
          qpc.firstCaptureDeviceFrame >> qpc.captureStartOffsetSeconds >> qpc.captureRateRatio >> qpc.renderRateRatio) ||
        version != clockVersion || !validClock(qpc)) throw std::runtime_error("Invalid paired clock evidence.");
    input >> std::ws;
    if (!input.eof()) throw std::runtime_error("Unexpected data in paired clock evidence.");
    return qpc;
}

std::optional<LoopbackClockComparison> compareLoopbackClocks(const LoopbackReport& report, const LoopbackClockEvidence& qpc) {
    if (!report.timing || !validClock(qpc) || qpc.playbackStartFrame || qpc.verifiedFrames != report.capturedFrames ||
        qpc.pcmFingerprint != report.pcmFingerprint) return {};
    std::vector<double> projected;
    for (const auto& event : report.markers) {
        const auto captureTime = (static_cast<double>(qpc.firstCaptureDeviceFrame) + *event.capturedFrame) /
                                 (sampleRate * qpc.captureRateRatio);
        const auto renderTime = event.referenceFrame / (sampleRate * qpc.renderRateRatio);
        const auto residualMs = (qpc.captureStartOffsetSeconds + captureTime - renderTime) * 1000;
        if (!std::isfinite(residualMs)) return {};
        projected.push_back(residualMs);
    }
    const auto drift = (qpc.captureRateRatio / qpc.renderRateRatio - 1) * 1'000'000.0;
    if (!std::isfinite(drift)) return {};
    return LoopbackClockComparison{drift, report.timing->signalDriftPpm - drift, median(std::move(projected))};
}
}
