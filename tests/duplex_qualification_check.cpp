#include "duplex_qualification.hpp"
#include "loopback_qualification.hpp"

#include <fstream>
#include <iostream>
#include <random>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::filesystem::path sibling(std::filesystem::path journal) {
    journal += ".duplex-clock.tsv";
    return journal;
}
}

int main() {
    try {
        const auto dir = std::filesystem::temp_directory_path() /
                         ("sonoravell-qualification-test-" + std::to_string(std::random_device{}()));
        check(std::filesystem::create_directory(dir), "Could not prepare a test directory.");
        struct Cleanup {
            std::filesystem::path path;
            ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
        } cleanup{dir};
        const auto journal = dir / "take.sntake";
        const auto session = dir / "original.sonora";
        saveProject(session, Project{});
        const Samples mono(7200, -711);
        {
            TakeWriter writer(journal, 0);
            writer.append(mono);
            writer.finalize();
        }
        const auto take = recoverTake(journal);
        check(take.finalized, "Fixture must have a durable end marker.");
        CaptureStreamReport capture;
        capture.end = CaptureEnd::stopped;
        capture.acceptedFrames = static_cast<unsigned>(mono.size());
        capture.timing.clock = StreamClock{sampleRate, 12};
        capture.timing.firstDeviceFrame = 12;
        capture.timing.clock.observe(ClockStamp{{12}, {10010000}}, QpcTime{10010001});
        capture.timing.clock.observe(ClockStamp{{6012}, {11260000}}, QpcTime{11260001});
        SharedRenderReport render;
        render.end = RenderEnd::cancelled;
        render.submittedFrames = 8400;
        StreamClock outputClock{sampleRate, 12};
        outputClock.observe(ClockStamp{{0}, {10000000}}, QpcTime{10000001});
        outputClock.observe(ClockStamp{{6240}, {11300000}}, QpcTime{11300001});
        const QpcTime settled{11400000};

        const auto write = [&](const std::filesystem::path& path, const RecoveredTake& result,
                               const CaptureStreamReport& input, const SharedRenderReport& output, QpcTime now) {
            return saveDuplexQualificationEvidence(path, result, 0, input, output, outputClock, now);
        };
        check(write(journal, take, capture, render, settled) == DuplexEvidenceStatus::saved,
              "A settled finalized take with qualified paired clocks should produce a sibling file.");
        std::ifstream input(sibling(journal));
        const auto evidence = readLoopbackClockEvidence(input);
        input.close();
        check(evidence.attempt == 12 && evidence.verifiedFrames == mono.size() &&
              evidence.firstCaptureDeviceFrame == 12 && evidence.pcmFingerprint == loopbackPcmFingerprint(mono),
              "The file should bind QPC evidence to the actual verified PCM.");
        check(write(journal, take, capture, render, settled) == DuplexEvidenceStatus::writeFailed,
              "Existing evidence must be preserved.");

        const auto failed = dir / "failed.sntake";
        auto interrupted = take;
        interrupted.finalized = false;
        check(write(failed, interrupted, capture, render, settled) == DuplexEvidenceStatus::unqualified,
              "An interrupted take cannot carry a qualified comparison.");
        auto wrongCapture = capture;
        --wrongCapture.acceptedFrames;
        check(write(failed, take, wrongCapture, render, settled) == DuplexEvidenceStatus::unqualified,
              "The accepted count must match the verified prefix.");
        auto failedRender = render;
        failedRender.error = RenderError::deviceInvalidated;
        check(write(failed, take, capture, failedRender, settled) == DuplexEvidenceStatus::unqualified,
              "Endpoint failure must suppress the paired comparison.");
        check(write(failed, take, capture, render, QpcTime{settled.ticks100ns + clockMaxSampleAge}) ==
                  DuplexEvidenceStatus::unqualified && !std::filesystem::exists(sibling(failed)),
              "Unqualified clock overlap must leave no sidecar.");

        check(write(dir / "missing-volume" / "take.sntake", take, capture, render, settled) ==
                  DuplexEvidenceStatus::writeFailed &&
              recoverTake(journal).stereo == take.stereo && openProject(session) == Project{},
              "An evidence I/O failure must leave the original Session and completed take intact.");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
