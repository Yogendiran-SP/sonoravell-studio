#include "loopback_qualification.hpp"
#include "session.hpp"

#include <cmath>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

constexpr unsigned delay = 1235;
constexpr double slope = 0.00025;

unsigned returned(unsigned marker) {
    const auto frame = qualificationMarkerFrames[marker];
    return frame + delay + static_cast<unsigned>(std::lround(frame * slope));
}

void place(Samples& captured, const Samples& reference, unsigned marker, unsigned at, int sign = -1) {
    for (unsigned j = 0; j < qualificationMarkerLength; ++j) {
        captured.at(at + j) = static_cast<std::int16_t>(captured[at + j] +
            sign * reference[(qualificationMarkerFrames[marker] + j) * channelCount] / 3);
    }
}

Samples fixture(const Samples& reference, int skip = -1, int shift = -1) {
    Samples captured(qualificationFrames + sampleRate);
    std::uint32_t noise = 1725;
    for (auto& value : captured) {
        noise = noise * 1664525u + 1013904223u;
        value = static_cast<std::int16_t>(70 + static_cast<int>((noise >> 24) % 31) - 15);
    }
    for (unsigned marker = 0; marker < qualificationMarkerFrames.size(); ++marker) {
        if (static_cast<int>(marker) == skip) continue;
        const auto at = returned(marker) + (static_cast<int>(marker) == shift ? 1831 : 0);
        place(captured, reference, marker, at);
    }
    return captured;
}
}

int main() {
    try {
        const auto project = makeQualificationSession();
        validateProject(project);
        check(project.tracks.size() == 1 && project.tracks[0].clips[0].tick == 0 &&
              sessionFrames(project) > qualificationFrames, "Reference Session needs a frame-zero clip and capture tail.");
        const auto& reference = project.assets.front().stereo;
        check(reference == makeQualificationSession().assets.front().stereo, "Reference PCM must be reproducible.");
        std::stringstream wave;
        writeWave(wave, reference);
        check(readWave(wave, 1, "Reference", true).stereo == reference, "Reference WAV must round-trip without conversion.");
        auto wrongRate = wave.str();
        // 44100 Hz and 176400 bytes/s, little endian. The import API can
        // resample that rate, while the qualification path must reject it.
        wrongRate.replace(24, 4, "\x44\xac\x00\x00", 4);
        wrongRate.replace(28, 4, "\x10\xb1\x02\x00", 4);
        std::istringstream resampled(wrongRate);
        bool rejectedRate = false;
        try { (void)readWave(resampled, 1, "Reference", true); }
        catch (const std::runtime_error&) { rejectedRate = true; }
        check(rejectedRate, "Qualification WAV must retain its original capture sample positions.");

        const auto captured = fixture(reference);
        const auto clean = analyzeLoopback(captured);
        check(clean.timing && std::abs(clean.timing->signalDriftPpm - 250) < 2 &&
              clean.timing->maximumResidualFrames <= 1, "The analyzer should recover injected signal drift.");
        for (unsigned marker = 0; marker < clean.markers.size(); ++marker) {
            const auto& event = clean.markers[marker];
            check(event.status == MarkerStatus::matched && event.candidates == 1 &&
                  event.capturedFrame == returned(marker) && event.peakFirst <= returned(marker) &&
                  event.peakLast >= returned(marker) && event.score > 0.99,
                  "Each return must match the correct marker and retain its peak support.");
        }

        const auto missing = analyzeLoopback(fixture(reference, 3));
        check(!missing.timing && missing.markers[3].status == MarkerStatus::missing &&
              missing.markers[4].status == MarkerStatus::matched, "A missing event must invalidate timing without relabeling neighbors.");

        auto duplicatePcm = captured;
        place(duplicatePcm, reference, 2, returned(2) + 7201);
        const auto duplicate = analyzeLoopback(duplicatePcm);
        check(!duplicate.timing && duplicate.markers[2].status == MarkerStatus::duplicate &&
              duplicate.markers[2].candidates == 2, "A second return must not be accepted as a clean round trip.");

        const auto shifted = analyzeLoopback(fixture(reference, -1, 5));
        check(!shifted.timing && shifted.markers[5].status == MarkerStatus::shifted,
              "A discontinuous shift must not be silently accepted as steady drift.");

        const auto truncated = analyzeLoopback(std::span(captured).first(10 * sampleRate));
        check(!truncated.timing && truncated.markers.back().status == MarkerStatus::missing,
              "The verified prefix of an interrupted take cannot qualify the full reference.");

        auto clippedPcm = captured;
        clippedPcm[returned(0)] = std::numeric_limits<std::int16_t>::max();
        const auto clipped = analyzeLoopback(clippedPcm);
        check(!clipped.timing && clipped.clippedFrames == 1, "A capture at the PCM rail must invalidate timing.");

        const auto silence = analyzeLoopback(Samples(sampleRate * 3));
        check(!silence.timing && silence.markers.front().status == MarkerStatus::missing, "Silence must produce no match.");
        const auto edge = analyzeLoopback(captured, {returned(0) - qualificationMarkerFrames[0], 96});
        check(!edge.timing && edge.markers.front().status == MarkerStatus::searchEdge, "A peak against the search boundary is unresolved.");

        const LoopbackClockEvidence qpc{9, 0, clean.capturedFrames, clean.pcmFingerprint, 110, -0.020, 1.00025, 1.0};
        std::stringstream clockFile;
        writeLoopbackClockEvidence(clockFile, qpc);
        auto parsed = readLoopbackClockEvidence(clockFile);
        const auto paired = compareLoopbackClocks(clean, parsed);
        check(paired && std::abs(paired->qpcRelativeDriftPpm - 250) < 0.01 &&
              std::abs(paired->signalMinusQpcDriftPpm) < 2 &&
              std::abs(paired->medianClockReferencedSignalMs - (1345.0 / 48012.0 - 0.020) * 1000) < 0.05,
              "The comparison must use actual signal returns, both clock rates and the capture frame origin.");
        check(!compareLoopbackClocks(missing, parsed), "Clock evidence alone cannot substitute for the return.");
        ++parsed.verifiedFrames;
        check(!compareLoopbackClocks(clean, parsed), "An unmatched recording must not use clock evidence.");
        --parsed.verifiedFrames;
        ++parsed.pcmFingerprint;
        check(!compareLoopbackClocks(clean, parsed), "Clock evidence must be bound to the captured PCM, even at equal lengths.");
        --parsed.pcmFingerprint;
        parsed.playbackStartFrame = 1;
        check(!compareLoopbackClocks(clean, parsed), "A nonzero playback origin needs a verified reference placement.");
        std::istringstream corrupt("SONORAVELL_DUPLEX_CLOCK_1\n0 0 1 0 0 0 1 1\n");
        bool rejectedClock = false;
        try { (void)readLoopbackClockEvidence(corrupt); }
        catch (const std::runtime_error&) { rejectedClock = true; }
        check(rejectedClock, "Independent/unqualified evidence must be rejected.");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
