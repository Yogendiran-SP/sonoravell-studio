#include "duplex_coordination.hpp"

#include <limits>

namespace sonoravell {
DuplexActions DuplexCoordinator::begin() noexcept {
    if (state() != DuplexState::idle || attempt == std::numeric_limits<std::uint64_t>::max()) return {};
    render = capture = Worker::starting;
    journalOpen = true;
    result = {};
    return {++attempt, true};
}

bool DuplexCoordinator::requestStop(Worker& worker) noexcept {
    if (worker != Worker::starting && worker != Worker::running) return false;
    worker = Worker::stopping;
    return true;
}

DuplexActions DuplexCoordinator::dispatch(DuplexEvent event) noexcept {
    if (event.attempt != attempt || state() == DuplexState::idle) return {};
    DuplexActions actions{attempt};
    switch (event.signal) {
    case DuplexSignal::renderStarted:
        if (render == Worker::starting) render = Worker::running;
        break;
    case DuplexSignal::captureStarted:
        if (capture == Worker::starting) capture = Worker::running;
        break;
    case DuplexSignal::renderExited:
        if (render != Worker::closed) {
            result.renderError = event.renderError;
            render = Worker::closed;
        }
        // Preserve input until it reaches its own stop boundary.
        break;
    case DuplexSignal::captureExited:
        if (capture != Worker::closed) {
            result.captureError = event.captureError;
            capture = Worker::closed;
            actions.stopRender = requestStop(render);
        }
        break;
    case DuplexSignal::storageFailed:
        if (!journalOpen) break;
        result.storageFailed = true;
        [[fallthrough]];
    case DuplexSignal::stop:
        actions.stopRender = requestStop(render);
        actions.stopCapture = requestStop(capture);
        break;
    case DuplexSignal::journalClosed:
        if (journalOpen) result.storageFailed |= event.journalFailed;
        journalOpen = false;
        // The writer may report closure before the endpoint exit reaches the
        // controller. Join both workers before offering the take or retry.
        actions.stopRender = requestStop(render);
        actions.stopCapture = requestStop(capture);
        break;
    }
    actions.takeReady = state() == DuplexState::idle;
    return actions;
}

DuplexState DuplexCoordinator::state() const noexcept {
    if (!journalOpen && render == Worker::closed && capture == Worker::closed) return DuplexState::idle;
    if (!journalOpen || capture == Worker::closed ||
        capture == Worker::stopping || render == Worker::stopping) return DuplexState::stopping;
    if (capture == Worker::running) {
        if (render == Worker::closed) return DuplexState::captureOnly;
        if (render == Worker::running) return DuplexState::running;
    }
    return DuplexState::starting;
}
}
