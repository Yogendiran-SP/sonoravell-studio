#pragma once

#include "shared_capture.hpp"
#include "shared_render.hpp"

namespace sonoravell {
enum class DuplexEvidenceStatus { unqualified, saved, writeFailed };

// Called after both endpoint workers and the writer have exited. Sidecar
// failures never change the Session, the journal, or the offered take.
DuplexEvidenceStatus saveDuplexQualificationEvidence(
    const std::filesystem::path& journal, const RecoveredTake& take, unsigned playbackStartFrame,
    const CaptureStreamReport& capture, const SharedRenderReport& render, const StreamClock& renderClock,
    QpcTime settledAt) noexcept;
}
