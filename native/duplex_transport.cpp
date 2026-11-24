#include "duplex_transport.hpp"

namespace sonoravell {
void DuplexNotices::renderExited(RenderError error) noexcept {
    renderError.store(error, std::memory_order_relaxed);
    pending.fetch_or(renderExit, std::memory_order_release);
}

void DuplexNotices::captureExited(CaptureError error) noexcept {
    captureError.store(error, std::memory_order_relaxed);
    pending.fetch_or(captureExit, std::memory_order_release);
}

void DuplexNotices::storageFailed() noexcept {
    pending.fetch_or(storageFault, std::memory_order_release);
}

void DuplexNotices::journalClosed(bool failed) noexcept {
    writerFailed.store(failed, std::memory_order_relaxed);
    pending.fetch_or(writerExit, std::memory_order_release);
}

DuplexActions DuplexTransport::begin(const std::shared_ptr<DuplexNotices>& prepared) noexcept {
    if (notices || !prepared || prepared->id) return {};
    const auto actions = policy.begin();
    if (actions.startStreams) {
        prepared->id = actions.attempt;
        notices = prepared;
    }
    return actions;
}

DuplexActions DuplexTransport::stop() noexcept {
    if (!notices) return {};
    return policy.dispatch({notices->id, DuplexSignal::stop});
}

DuplexUpdate DuplexTransport::poll() noexcept {
    DuplexUpdate update;
    if (!notices || settled) return update;
    update.actions.attempt = notices->id;
    const auto send = [&](DuplexSignal signal, RenderError render = RenderError::none,
                          CaptureError capture = CaptureError::none, bool failed = false) {
        const auto action = policy.dispatch({notices->id, signal, render, capture, failed});
        update.actions.stopRender |= action.stopRender;
        update.actions.stopCapture |= action.stopCapture;
        update.actions.takeReady |= action.takeReady;
    };

    const auto pending = notices->pending.exchange(0, std::memory_order_acquire);
    if (notices->renderStarted.exchange(false, std::memory_order_relaxed)) send(DuplexSignal::renderStarted);
    if (notices->captureStarted.exchange(false, std::memory_order_relaxed)) send(DuplexSignal::captureStarted);
    if (pending & DuplexNotices::storageFault) send(DuplexSignal::storageFailed);
    if (pending & DuplexNotices::renderExit) {
        update.renderExited = true;
        send(DuplexSignal::renderExited, notices->renderError.load(std::memory_order_relaxed));
    }
    if (pending & DuplexNotices::captureExit) {
        update.captureExited = true;
        send(DuplexSignal::captureExited, RenderError::none, notices->captureError.load(std::memory_order_relaxed));
    }
    if (pending & DuplexNotices::writerExit) {
        send(DuplexSignal::journalClosed, RenderError::none, CaptureError::none,
             notices->writerFailed.load(std::memory_order_relaxed));
    }
    settled = update.actions.takeReady;
    return update;
}

void DuplexTransport::retire() noexcept {
    if (!settled) return;
    notices.reset();
    settled = false;
}
}
