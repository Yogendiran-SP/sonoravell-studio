#pragma once

#include "shared_capture.hpp"
#include "shared_render.hpp"

namespace sonoravell {
enum class DuplexState { idle, starting, running, captureOnly, stopping };
enum class DuplexSignal { renderStarted, captureStarted, renderExited, captureExited, storageFailed, journalClosed, stop };

struct DuplexEvent {
    std::uint64_t attempt;
    DuplexSignal signal;
    RenderError renderError = RenderError::none;
    CaptureError captureError = CaptureError::none;
    bool journalFailed = false; // Authoritative with journalClosed.
};

struct DuplexActions {
    std::uint64_t attempt = 0;
    bool startStreams = false;
    bool stopRender = false;
    bool stopCapture = false;
    bool takeReady = false; // All resources settled. Inspect the journal for recoverable audio.
};

struct DuplexOutcome {
    RenderError renderError = RenderError::none;
    CaptureError captureError = CaptureError::none;
    bool storageFailed = false;
};

// Control-thread policy only. Events report worker exit after cleanup;
// journalClosed follows writer cleanup even after a failed write.
class DuplexCoordinator {
public:
    // The owner must have prepared a writable take journal before begin.
    DuplexActions begin() noexcept;
    DuplexActions dispatch(DuplexEvent event) noexcept;
    DuplexState state() const noexcept;
    DuplexOutcome outcome() const noexcept { return result; }

private:
    enum class Worker { closed, starting, running, stopping };
    static bool requestStop(Worker& worker) noexcept;

    std::uint64_t attempt = 0;
    Worker render = Worker::closed, capture = Worker::closed;
    bool journalOpen = false;
    DuplexOutcome result;
};
}
