#include "duplex_qualification.hpp"

#include "loopback_qualification.hpp"

#include <fstream>

namespace sonoravell {
DuplexEvidenceStatus saveDuplexQualificationEvidence(
    const std::filesystem::path& journal, const RecoveredTake& take, unsigned playbackStartFrame,
    const CaptureStreamReport& capture, const SharedRenderReport& render, const StreamClock& renderClock,
    QpcTime settledAt) noexcept {
    const auto frames = take.stereo.size() / channelCount;
    const auto& inputClock = capture.timing.clock;
    const auto firstDeviceFrame = capture.timing.firstDeviceFrame;
    if (!take.finalized || !frames || take.stereo.size() % channelCount || frames != capture.acceptedFrames ||
        capture.end == CaptureEnd::interrupted || capture.error != CaptureError::none ||
        render.end == RenderEnd::failed || render.error != RenderError::none || !render.submittedFrames ||
        !firstDeviceFrame || *firstDeviceFrame < inputClock.origin().units) {
        return DuplexEvidenceStatus::unqualified;
    }
    const auto correlation = correlateClocks(inputClock, renderClock, settledAt);
    const auto inputRatio = inputClock.rateRatio();
    const auto outputRatio = renderClock.rateRatio();
    if (!correlation || !inputRatio || !outputRatio) return DuplexEvidenceStatus::unqualified;

    std::filesystem::path stage;
    try {
        auto destination = journal;
        destination += ".duplex-clock.tsv";
        stage = destination;
        stage += ".tmp";
        if (std::filesystem::exists(destination) || std::filesystem::exists(stage)) return DuplexEvidenceStatus::writeFailed;
        std::ofstream output(stage, std::ios::binary);
        if (output) {
            const LoopbackClockEvidence evidence{
                inputClock.attempt(), playbackStartFrame, static_cast<unsigned>(frames),
                loopbackPcmFingerprint(take.stereo, true), *firstDeviceFrame - inputClock.origin().units,
                correlation->captureStartOffsetSeconds, *inputRatio, *outputRatio
            };
            writeLoopbackClockEvidence(output, evidence);
            output.close();
            if (output) {
                std::filesystem::rename(stage, destination);
                return DuplexEvidenceStatus::saved;
            }
        }
    } catch (...) {
        // Evidence is optional. Continue offering the independently verified take.
    }
    std::error_code ignored;
    if (!stage.empty()) std::filesystem::remove(stage, ignored);
    return DuplexEvidenceStatus::writeFailed;
}
}
