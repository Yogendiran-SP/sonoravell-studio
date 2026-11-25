#include "duplex_coordination.hpp"
#include "take_queue.hpp"

#include <array>
#include <iostream>
#include <random>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

struct Run {
    DuplexCoordinator& policy;
    const DuplexActions initial = policy.begin();
    const std::uint64_t id = initial.attempt;

    DuplexActions send(DuplexSignal signal, RenderError renderError = RenderError::none,
                       CaptureError captureError = CaptureError::none, bool journalFailed = false) {
        return policy.dispatch({id, signal, renderError, captureError, journalFailed});
    }

    void ready(bool captureFirst = false) {
        check(initial.startStreams && id != 0 && policy.state() == DuplexState::starting,
              "Start must dispatch both streams after preparing the take.");
        send(captureFirst ? DuplexSignal::captureStarted : DuplexSignal::renderStarted);
        check(policy.state() == DuplexState::starting, "One endpoint cannot mark both running.");
        send(captureFirst ? DuplexSignal::renderStarted : DuplexSignal::captureStarted);
        check(policy.state() == DuplexState::running, "Either start order must reach running.");
    }
};

void checkRenderFailure() {
    for (bool captureFirst : {false, true}) {
        DuplexCoordinator coordinator;
        Run run{coordinator};
        run.ready(captureFirst);
        const auto unplugged = run.send(DuplexSignal::renderExited, RenderError::deviceInvalidated);
        check(!unplugged.stopCapture && !unplugged.takeReady && !unplugged.startStreams &&
              coordinator.state() == DuplexState::captureOnly &&
              coordinator.outcome().renderError == RenderError::deviceInvalidated,
              "Output invalidation must keep the capture and its journal running.");
        const auto stop = run.send(DuplexSignal::stop);
        check(stop.stopCapture && !stop.stopRender && coordinator.state() == DuplexState::stopping,
              "User Stop should request the remaining input exactly once.");
        check(!run.send(DuplexSignal::captureExited).takeReady &&
              run.send(DuplexSignal::journalClosed).takeReady &&
              coordinator.outcome().captureError == CaptureError::none,
              "Output loss must allow a normally finalized take.");
    }

    DuplexCoordinator coordinator;
    Run run{coordinator};
    run.send(DuplexSignal::renderExited, RenderError::deviceUnavailable);
    check(coordinator.state() == DuplexState::starting, "A failed render open must allow capture startup.");
    run.send(DuplexSignal::captureStarted);
    check(coordinator.state() == DuplexState::captureOnly, "A ready input can record after render open fails.");
}

void checkCaptureAndStorageFailures() {
    for (auto error : {CaptureError::deviceInvalidated, CaptureError::queueFull}) {
        DuplexCoordinator coordinator;
        Run run{coordinator};
        run.ready();
        const auto failed = run.send(DuplexSignal::captureExited, RenderError::none, error);
        check(failed.stopRender && !failed.stopCapture && !failed.takeReady &&
              coordinator.outcome().captureError == error, "Input failure must stop output and preserve the reason.");
        run.send(DuplexSignal::captureExited); // A duplicate cannot erase the error.
        check(!run.send(DuplexSignal::journalClosed).takeReady &&
              run.send(DuplexSignal::renderExited).takeReady && coordinator.outcome().captureError == error,
              "Both worker exits and the journal close must be acknowledged.");
    }

    DuplexCoordinator coordinator;
    Run run{coordinator};
    run.ready(true);
    const auto failed = run.send(DuplexSignal::storageFailed);
    check(failed.stopCapture && failed.stopRender && !failed.takeReady && coordinator.outcome().storageFailed,
          "An active writer failure must cancel both workers.");
    const auto repeated = run.send(DuplexSignal::storageFailed);
    check(!repeated.stopCapture && !repeated.stopRender, "Worker stop requests must be idempotent.");
    run.send(DuplexSignal::renderExited);
    run.send(DuplexSignal::captureExited, RenderError::none, CaptureError::storage);
    check(!coordinator.begin().startStreams && run.send(DuplexSignal::journalClosed).takeReady &&
          coordinator.outcome().storageFailed, "A stalled or failed writer must settle before retry.");

    Run next{coordinator};
    next.ready();
    next.send(DuplexSignal::captureExited);
    check(!next.send(DuplexSignal::journalClosed, RenderError::none, CaptureError::none, true).takeReady &&
          coordinator.outcome().storageFailed, "A failure during final journal close must be visible.");
    check(next.send(DuplexSignal::renderExited).takeReady, "A late render cleanup must release the attempt.");
}

void checkCancellationAndRetry() {
    DuplexCoordinator coordinator;
    Run first{coordinator};
    const auto cancelled = first.send(DuplexSignal::stop);
    check(cancelled.stopCapture && cancelled.stopRender && coordinator.state() == DuplexState::stopping,
          "Stop while opening must cancel both pending opens.");
    first.send(DuplexSignal::renderStarted);
    first.send(DuplexSignal::captureStarted);
    const auto again = first.send(DuplexSignal::stop);
    check(!again.stopCapture && !again.stopRender && !coordinator.begin().startStreams &&
          coordinator.state() == DuplexState::stopping, "Late Start acknowledgements cannot resurrect a cancelled attempt.");
    check(!first.send(DuplexSignal::journalClosed).takeReady &&
          !first.send(DuplexSignal::renderExited).takeReady &&
          first.send(DuplexSignal::captureExited).takeReady, "A cancelled take must settle once.");
    check(!first.send(DuplexSignal::journalClosed).takeReady, "Duplicate completion must not settle twice.");

    Run retry{coordinator};
    retry.ready(true);
    check(retry.id != first.id, "Retry must issue a fresh attempt ID for clock pairing.");
    first.send(DuplexSignal::storageFailed);
    first.send(DuplexSignal::captureExited, RenderError::none, CaptureError::deviceInvalidated);
    first.send(DuplexSignal::journalClosed);
    check(coordinator.state() == DuplexState::running && !coordinator.outcome().storageFailed &&
          coordinator.outcome().captureError == CaptureError::none, "An old worker cannot terminate the new attempt.");
    retry.send(DuplexSignal::stop);
    retry.send(DuplexSignal::captureExited);
    retry.send(DuplexSignal::renderExited);
    check(retry.send(DuplexSignal::journalClosed).takeReady &&
          coordinator.state() == DuplexState::idle, "Repeated Start/Stop must settle cleanly.");
}

void checkRecoverablePrefix() {
    const auto dir = std::filesystem::temp_directory_path() /
                     ("sonoravell-duplex-check-" + std::to_string(std::random_device{}()));
    check(std::filesystem::create_directory(dir), "Could not create recovery fixture directory.");
    struct Cleanup {
        std::filesystem::path path;
        ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
    } cleanup{dir};
    const auto originalPath = dir / "original.sonora";
    const Project original;
    saveProject(originalPath, original);

    DuplexCoordinator coordinator;
    const auto journalPath = dir / "interrupted.sntake";
    constexpr std::array<std::int16_t, 3> packet{13, -28, 71};
    unsigned queued = 0;
    std::uint64_t attempt = 0;
    {
        TakeWriter journal(journalPath, 960);
        Run run{coordinator};
        run.ready();
        attempt = run.id;
        TakeQueue queue;
        while (queue.pushPacket(packet)) ++queued;
        check(queued > 0, "The simulated capture queue must accept a prefix.");
        check(run.send(DuplexSignal::captureExited, RenderError::none, CaptureError::queueFull).stopRender,
              "A saturated queue must stop playback and leave the prefix available to the writer.");
        CaptureBlock block;
        Samples mono;
        while (queue.pop(block)) mono.insert(mono.end(), block.samples.begin(), block.samples.begin() + block.count);
        journal.append(mono);
        run.send(DuplexSignal::renderExited);
        // No success marker after queue loss. Notify closure after destruction.
    }
    const auto complete = coordinator.dispatch({attempt, DuplexSignal::journalClosed});
    const auto recovered = recoverTake(journalPath);
    check(complete.takeReady && !recovered.finalized && recovered.startTick == 960 &&
          recovered.stereo.size() == queued * packet.size() * channelCount &&
          openProject(originalPath) == original, "Closed interrupted take must preserve the prefix and prior Session.");
    for (std::size_t i = 0; i < recovered.stereo.size(); ++i) {
        check(recovered.stereo[i] == packet[(i / channelCount) % packet.size()], "The journal prefix must retain sample order.");
    }

    auto saved = original;
    saved.assets.push_back({1, "Recovered", recovered.stereo});
    saved.tracks.push_back({1, "Recovered", Instrument::audio, false, 100, {}, {wholeAudioClip(1, saved.assets.front(), recovered.startTick)}});
    const auto savedPath = dir / "recovered.sonora";
    saveProject(savedPath, saved);
    check(openProject(savedPath) == saved, "Recovered capture must survive Session save and reopen.");
}
}

int main() {
    try {
        checkRenderFailure();
        checkCaptureAndStorageFailures();
        checkCancellationAndRetry();
        checkRecoverablePrefix();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
