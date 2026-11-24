#include "loopback_qualification.hpp"
#include "session.hpp"
#include "take_journal.hpp"

#include <charconv>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <locale>
#include <stdexcept>
#include <string_view>

namespace {
using namespace sonoravell;
constexpr double framesPerMs = sampleRate / 1000.0;

struct Capture {
    Samples mono;
    std::optional<bool> finalized;
};

void generate(const std::filesystem::path& directory) {
    if (!std::filesystem::create_directory(directory)) throw std::runtime_error("Choose a new output directory.");
    const auto project = makeQualificationSession();
    std::ofstream wave(directory / "reference.wav", std::ios::binary);
    if (!wave) throw std::runtime_error("Could not open the reference WAV.");
    writeWave(wave, project.assets.front().stereo);
    wave.close();
    if (!wave) throw std::runtime_error("Could not finish the reference WAV.");
    saveProject(directory / "reference.sonora", project);
    std::cout << "Wrote reference.wav and reference.sonora (loopback reference v1).\n";
}

Capture readCapture(const std::filesystem::path& path) {
    Capture result;
    Samples stereo;
    if (path.extension() == takeExtension) {
        auto take = recoverTake(path);
        result.finalized = take.finalized;
        stereo = std::move(take.stereo);
    } else {
        std::ifstream in(path, std::ios::binary);
        if (!in) throw std::runtime_error("Could not open the capture WAV.");
        stereo = readWave(in, 1, "Loopback return", true).stereo;
    }
    result.mono.reserve(stereo.size() / channelCount);
    for (std::size_t i = 0; i < stereo.size(); i += channelCount) result.mono.push_back(stereo[i]);
    return result;
}

unsigned positive(std::string_view text) {
    unsigned value = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), value);
    if (error != std::errc{} || end != text.data() + text.size() || !value) throw std::runtime_error("Expected a positive integer.");
    return value;
}

void printHuman(const LoopbackReport& report, std::optional<bool> finalized,
                const std::optional<LoopbackClockEvidence>& evidence, const std::optional<LoopbackClockComparison>& comparison) {
    std::cout << "Sonoravell loopback reference v1 | 48000 Hz | " << report.capturedFrames
              << " captured frames | " << report.clippedFrames << " rail samples\n";
    if (finalized) std::cout << "Journal finalized: " << (*finalized ? "yes" : "no (verified prefix)") << '\n';
    std::cout << "Search +/- " << report.options.searchFrames << " frames. Shift flag: "
              << report.options.shiftFrames << " frames from fitted trend.\n"
              << "Reference frame\tCaptured frame\tStatus\tMatch score\tLocal peak interval\n";
    for (const auto& marker : report.markers) {
        std::cout << marker.referenceFrame << '\t';
        if (marker.capturedFrame) std::cout << *marker.capturedFrame;
        else std::cout << '-';
        std::cout << '\t' << markerStatusName(marker.status) << '\t' << marker.score;
        if (marker.capturedFrame) std::cout << '\t' << marker.peakFirst << ".." << marker.peakLast;
        std::cout << '\n';
    }
    if (report.timing) {
        const auto& timing = *report.timing;
        std::cout << "Median returned displacement: " << timing.medianFrames / framesPerMs << " ms"
                  << " (observed range " << timing.minimumFrames / framesPerMs << ".."
                  << timing.maximumFrames / framesPerMs << " ms)\n"
                  << "Median local peak-support interval: " << timing.medianPeakFirstFrames / framesPerMs
                  << ".." << timing.medianPeakLastFrames / framesPerMs << " ms\n"
                  << "Signal drift: " << timing.signalDriftPpm << " ppm; maximum detrended residual: "
                  << timing.maximumResidualFrames << " frames\n";
    } else {
        std::cout << "Measurement invalid. Inspect the marker flags and clipping count.\n";
    }
    if (comparison) {
        std::cout << "QPC attempt " << evidence->attempt << ": origin offset " << evidence->captureStartOffsetSeconds * 1000
                  << " ms, relative drift " << comparison->qpcRelativeDriftPpm << " ppm, signal minus QPC drift "
                  << comparison->signalMinusQpcDriftPpm << " ppm\n"
                  << "Median clock-referenced returned-signal residual: " << comparison->medianClockReferencedSignalMs << " ms\n";
    } else {
        std::cout << "QPC comparison unavailable for this recording.\n";
    }
    std::cout << "Calibrated end-to-end round-trip latency: unmeasured. Peak intervals describe local match support.\n";
}

void printJson(const LoopbackReport& report, std::optional<bool> finalized,
               const std::optional<LoopbackClockEvidence>& evidence, const std::optional<LoopbackClockComparison>& comparison) {
    std::cout << "{\"reference\":\"sonoravell-loopback-v1\",\"sample_rate\":" << sampleRate
              << ",\"captured_frames\":" << report.capturedFrames << ",\"clipped_frames\":" << report.clippedFrames
              << ",\"pcm_fingerprint\":\"" << report.pcmFingerprint << '"'
              << ",\"search_frames\":" << report.options.searchFrames << ",\"shift_frames\":" << report.options.shiftFrames
              << ",\"journal_finalized\":" << (finalized ? (*finalized ? "true" : "false") : "null")
              << ",\"markers\":[";
    for (std::size_t i = 0; i < report.markers.size(); ++i) {
        const auto& m = report.markers[i];
        std::cout << (i ? "," : "") << "{\"reference_frame\":" << m.referenceFrame
                  << ",\"status\":\"" << markerStatusName(m.status) << "\",\"candidates\":" << m.candidates
                  << ",\"captured_frame\":";
        if (m.capturedFrame) {
            std::cout << *m.capturedFrame << ",\"score\":" << m.score
                      << ",\"peak_support_frames\":[" << m.peakFirst << ',' << m.peakLast << ']';
        } else {
            std::cout << "null,\"score\":null,\"peak_support_frames\":null";
        }
        std::cout << '}';
    }
    std::cout << "],\"signal_timing\":";
    if (report.timing) {
        const auto& t = *report.timing;
        std::cout << "{\"median_displacement_ms\":" << t.medianFrames / framesPerMs
                  << ",\"observed_displacement_range_ms\":[" << t.minimumFrames / framesPerMs << ',' << t.maximumFrames / framesPerMs
                  << "],\"median_peak_support_ms\":[" << t.medianPeakFirstFrames / framesPerMs << ','
                  << t.medianPeakLastFrames / framesPerMs << "],\"relative_drift_ppm\":" << t.signalDriftPpm
                  << ",\"maximum_residual_frames\":" << t.maximumResidualFrames << '}';
    } else std::cout << "null";
    std::cout << ",\"qpc_comparison\":";
    if (comparison) {
        std::cout << "{\"attempt\":" << evidence->attempt
                  << ",\"origin_offset_ms\":" << evidence->captureStartOffsetSeconds * 1000
                  << ",\"relative_drift_ppm\":" << comparison->qpcRelativeDriftPpm
                  << ",\"signal_minus_qpc_drift_ppm\":" << comparison->signalMinusQpcDriftPpm
                  << ",\"median_clock_referenced_signal_ms\":" << comparison->medianClockReferencedSignalMs << '}';
    } else std::cout << "null";
    std::cout << ",\"calibrated_round_trip_ms\":null}\n";
}
}

int main(int argc, char** argv) {
    try {
        if (argc == 3 && std::string_view(argv[1]) == "generate") {
            generate(argv[2]);
            return 0;
        }
        if (argc < 3 || std::string_view(argv[1]) != "analyze") {
            std::cerr << "Usage: sonoravell-qualify generate <new-directory>\n"
                         "       sonoravell-qualify analyze <capture.sntake|capture.wav> [--json] [--search-ms N] [--shift-frames N]\n";
            return 2;
        }
        LoopbackOptions options;
        bool json = false;
        for (int i = 3; i < argc; ++i) {
            const std::string_view arg = argv[i];
            if (arg == "--json") json = true;
            else if (arg == "--search-ms" && i + 1 < argc) {
                const auto ms = positive(argv[++i]);
                if (ms > 10000) throw std::runtime_error("Search cannot exceed 10000 ms.");
                options.searchFrames = ms * (sampleRate / 1000);
            } else if (arg == "--shift-frames" && i + 1 < argc) {
                options.shiftFrames = positive(argv[++i]);
            } else throw std::runtime_error("Unknown or incomplete analysis option.");
        }
        const std::filesystem::path capturePath = argv[2];
        const auto capture = readCapture(capturePath);
        const auto report = analyzeLoopback(capture.mono, options);
        auto sidecar = capturePath;
        sidecar += ".duplex-clock.tsv";
        std::optional<LoopbackClockEvidence> evidence;
        if (capture.finalized.value_or(false) && std::filesystem::exists(sidecar)) {
            std::ifstream clock(sidecar);
            try {
                evidence = readLoopbackClockEvidence(clock);
            } catch (const std::runtime_error& error) {
                std::cerr << error.what() << " Signal evidence remains available.\n";
            }
        }
        std::optional<LoopbackClockComparison> comparison;
        if (evidence) comparison = compareLoopbackClocks(report, *evidence);
        std::cout.imbue(std::locale::classic());
        std::cout << std::fixed << std::setprecision(6);
        if (json) printJson(report, capture.finalized, evidence, comparison);
        else printHuman(report, capture.finalized, evidence, comparison);
        if (!std::cout) throw std::runtime_error("Could not write the analysis report.");
        return report.timing && capture.finalized.value_or(true) ? 0 : 3;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
