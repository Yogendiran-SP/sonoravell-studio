#pragma once

#include "duplex_coordination.hpp"

#include <memory>

namespace sonoravell {
// One mailbox per attempt. Workers only publish to fixed-size atomics.
// Endpoint exits and writer closure are separate, even when observed together.
class DuplexNotices {
public:
    std::atomic<bool> renderStarted{false}, captureStarted{false};

    std::uint64_t attempt() const noexcept { return id; }
    void renderExited(RenderError error) noexcept;
    void captureExited(CaptureError error) noexcept;
    void storageFailed() noexcept;
    void journalClosed(bool failed) noexcept;

private:
    friend class DuplexTransport;
    enum Flag : unsigned { renderExit = 1, captureExit = 2, storageFault = 4, writerExit = 8 };

    std::uint64_t id = 0; // Written on the control thread before publication to workers.
    std::atomic<unsigned> pending{0};
    std::atomic<RenderError> renderError{RenderError::none};
    std::atomic<CaptureError> captureError{CaptureError::none};
    std::atomic<bool> writerFailed{false};
};

struct DuplexUpdate {
    DuplexActions actions;
    bool renderExited = false;
    bool captureExited = false;
};

// Owned by the control thread. The caller prepares the journal before begin,
// joins completed endpoints, and inspects the take after takeReady.
class DuplexTransport {
public:
    DuplexActions begin(const std::shared_ptr<DuplexNotices>& prepared) noexcept;
    DuplexActions stop() noexcept;
    DuplexUpdate poll() noexcept;
    void retire() noexcept;
    bool active() const noexcept { return static_cast<bool>(notices); }
    DuplexState state() const noexcept { return policy.state(); }
    DuplexOutcome outcome() const noexcept { return policy.outcome(); }

private:
    DuplexCoordinator policy;
    std::shared_ptr<DuplexNotices> notices;
    bool settled = false;
};
}
