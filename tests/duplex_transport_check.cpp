#include "duplex_transport.hpp"
#include "take_queue.hpp"

#include <chrono>
#include <cmath>
#include <iostream>
#include <random>
#include <semaphore>
#include <stdexcept>
#include <thread>

using namespace sonoravell;
using namespace std::chrono_literals;

namespace {
constexpr std::uint64_t qpcStart = 100'000'000;
constexpr std::int16_t tone = 23;
constexpr unsigned packetFrames = 6000;

void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

struct Gates {
    std::counting_semaphore<32> open{0}, tick{0}, waiting{0}, done{0};

    void atWait() { check(waiting.try_acquire_for(5s), "Worker did not enter its device wait."); }
    void exited() { check(done.try_acquire_for(5s), "Worker failed to exit."); }
};

struct RenderDevice final : SharedRenderEndpoint {
    Gates gates;
    StreamClock clock;
    std::atomic<bool> disconnected{false};
    unsigned writes = 0;
    std::uint64_t tick = 0;
    std::array<std::int16_t, 16> buffer{};

    RenderError open(SharedRenderConfig, SharedRenderReport& report) noexcept override {
        gates.open.acquire();
        report.bufferFrames = 8;
        report.mixRate = 44100;
        return RenderError::none;
    }
    RenderError padding(unsigned& frames) noexcept override { frames = 0; return RenderError::none; }
    RenderError acquire(unsigned frames, std::span<std::int16_t>& output) noexcept override {
        output = std::span(buffer).first(frames * channelCount);
        return RenderError::none;
    }
    RenderError release(unsigned) noexcept override { ++writes; return RenderError::none; }
    RenderError start() noexcept override { return RenderError::none; }
    RenderError stop() noexcept override { return RenderError::none; }
    RenderError wait(std::stop_token stop, bool& cancelled) noexcept override {
        gates.waiting.release();
        gates.tick.acquire();
        cancelled = stop.stop_requested();
        if (cancelled) return RenderError::none;
        if (disconnected) return RenderError::deviceInvalidated;
        const auto qpc = qpcStart + 1'250'000 * tick;
        clock.observe(ClockStamp{{5513 * tick++}, {qpc}}, QpcTime{qpc+1});
        return RenderError::none;
    }
    std::uint32_t nativeError() const noexcept override { return 0; }
};

struct InputDevice final : SharedCaptureEndpoint {
    Gates gates;
    std::atomic<bool> stopped{false}, disconnected{false};
    bool packetReady = false;
    std::uint64_t tick = 0;
    std::array<std::int16_t, packetFrames> pcm;

    InputDevice() { pcm.fill(tone); }
    CaptureError open(CaptureStreamConfig, CaptureStreamReport& report) noexcept override {
        gates.open.acquire();
        report.rate = sampleRate;
        report.channels = 1;
        report.encoding = CaptureEncoding::pcm16;
        report.bufferFrames = packetFrames;
        return CaptureError::none;
    }
    CaptureError start() noexcept override { return CaptureError::none; }
    CaptureError wait() noexcept override {
        gates.waiting.release();
        gates.tick.acquire();
        if (disconnected) return CaptureError::deviceInvalidated;
        packetReady = true;
        return CaptureError::none;
    }
    bool stoppedByUserOrWriter() const noexcept override { return stopped; }
    CaptureError acquire(CapturePacket& packet) noexcept override {
        if (!packetReady) return CaptureError::none;
        packetReady = false;
        const auto qpc = qpcStart + 10'000 + 1'249'500 * tick;
        packet = {std::as_bytes(std::span(pcm)), packetFrames, false, false, false,
                  packetFrames * tick++, qpc, QpcTime{qpc+1}};
        return CaptureError::none;
    }
    CaptureError release(unsigned) noexcept override { return CaptureError::none; }
    CaptureError stop() noexcept override { return CaptureError::none; }
    std::uint32_t nativeError() const noexcept override { return 0; }
};

struct Run final : CaptureSink {
    DuplexTransport& transport;
    std::shared_ptr<DuplexNotices> signals = std::make_shared<DuplexNotices>();
    RenderDevice output;
    InputDevice input;
    std::unique_ptr<TakeQueue> queue = std::make_unique<TakeQueue>();
    RenderEnd renderEnd{};
    CaptureStreamReport captureReport;
    std::atomic<unsigned> muted{0}, played{0};
    std::jthread renderWorker, inputWorker;

    explicit Run(DuplexTransport& transport) : transport(transport) {}
    ~Run() {
        apply({0, false, true, true, false});
        output.gates.open.release();
        input.gates.open.release();
    }
    CaptureError push(std::span<const std::int16_t> pcm) noexcept override {
        return queue->pushPacket(pcm) ? CaptureError::none : CaptureError::queueFull;
    }
    void launch() {
        const auto actions = transport.begin(signals);
        check(actions.startStreams, "Prepared attempt should launch.");
        Project project;
        project.bars = 1;
        auto session = std::make_shared<const SessionAudio>(project);
        renderWorker = std::jthread([this, session](std::stop_token stop) {
            output.clock = StreamClock{44100, signals->attempt()};
            PlaybackMixer mixer(*session, {});
            const auto report = renderShared(output, mixer, {}, muted, played, stop, &signals->renderStarted);
            renderEnd = report.end;
            signals->renderExited(report.error);
            output.gates.done.release();
        });
        inputWorker = std::jthread([this] {
            captureReport = captureShared(input, *this, {0, signals->attempt()}, 10 * packetFrames,
                                          &signals->captureStarted);
            signals->captureExited(captureReport.error);
            input.gates.done.release();
        });
        session.reset(); // The render worker still owns its immutable snapshot.
    }
    void ready(bool recordFirst) {
        auto& first = recordFirst ? input.gates : output.gates;
        auto& second = recordFirst ? output.gates : input.gates;
        first.open.release();
        first.atWait();
        transport.poll();
        check(transport.state() == DuplexState::starting, "One ready endpoint is still starting.");
        second.open.release();
        second.atWait();
        transport.poll();
        check(transport.state() == DuplexState::running, "Both worker notices must reach running.");
    }
    void apply(DuplexActions actions) {
        if (actions.stopRender) {
            renderWorker.request_stop();
            output.gates.tick.release();
        }
        if (actions.stopCapture) {
            input.stopped = true;
            input.gates.tick.release();
        }
    }
    DuplexUpdate poll() {
        const auto update = transport.poll();
        apply(update.actions);
        return update;
    }
    void writeAndClose(std::unique_ptr<TakeWriter> writer, bool finalize, bool failed = false) {
        CaptureBlock block;
        while (queue->pop(block)) if (writer) writer->append(std::span(block.samples).first(block.count));
        if (writer && finalize) writer->finalize();
        writer.reset();
        signals->journalClosed(failed);
        check(poll().actions.takeReady && !poll().actions.takeReady, "Closure offers the take once.");
        check(!transport.begin(std::make_shared<DuplexNotices>()).startStreams,
              "The control thread has not yet retired the joined attempt.");
        transport.retire();
    }
};

void checkConcurrentWorkers(const std::filesystem::path& dir, bool recordFirst) {
    const auto path = dir / (recordFirst ? "capture-first.sntake" : "render-first.sntake");
    constexpr unsigned beat = 960;
    auto journal = std::make_unique<TakeWriter>(path, beat);
    DuplexTransport transport;
    Run run{transport};
    run.launch();
    run.ready(recordFirst);
    for (unsigned i = 0; i < 2; ++i) {
        run.output.gates.tick.release();
        run.input.gates.tick.release();
        run.output.gates.atWait();
        run.input.gates.atWait();
    }
    run.output.disconnected = true;
    run.output.gates.tick.release();
    run.output.gates.exited();
    check(run.poll().renderExited && transport.state() == DuplexState::captureOnly && !run.input.stopped,
          "Output failure should leave the input collecting audio.");
    run.input.gates.tick.release();
    run.input.gates.atWait();
    run.apply(transport.stop());
    run.input.gates.exited();
    check(!run.poll().actions.takeReady, "Both exits still require journal closure.");
    run.renderWorker.join();
    run.inputWorker.join();
    const auto estimate = correlateClocks(run.captureReport.timing.clock, run.output.clock, QpcTime{qpcStart + 4'000'000});
    check(estimate && std::abs(estimate->captureStartOffsetSeconds - 0.001) < 1e-9 &&
          estimate->captureRelativeDriftPpm > 100 && run.captureReport.acceptedFrames == 3 * packetFrames &&
          run.output.writes == 3, "Independent workers should produce both audio and qualified clock evidence.");
    run.writeAndClose(std::move(journal), true);
    const auto take = recoverTake(path);
    check(take.finalized && take.startTick == beat && take.stereo.size() == 6 * packetFrames &&
          std::ranges::all_of(take.stereo, [](auto value) { return value == tone; }),
          "The recording prefix and placement must survive output loss.");
    auto project = Project{};
    project.assets.push_back({1, "Take", take.stereo});
    project.tracks.push_back({1, "Take", Instrument::audio, false, 100, {}, {wholeAudioClip(1, project.assets.front(), take.startTick)}});
    const auto original = dir / "original.sonora";
    const auto saved = dir / (recordFirst ? "capture-first.sonora" : "render-first.sonora");
    saveProject(saved, project);
    check(openProject(original) == Project{} && openProject(saved) == project, "Original and recovered Sessions must reopen.");
}

void checkRetryAndFaults() {
    DuplexTransport transport;
    std::shared_ptr<DuplexNotices> old;
    for (unsigned scenario = 0; scenario < 5; ++scenario) {
        Run run{transport};
        run.launch();
        if (old) {
            old->storageFailed();
            old->journalClosed(true);
            run.poll();
            check(!transport.outcome().storageFailed, "Stale writer must not affect the new attempt.");
        }
        if (scenario == 0) {
            run.apply(transport.stop());
            run.output.gates.open.release();
            run.input.gates.open.release();
        } else {
            if (scenario == 2) {
                constexpr std::array small{tone};
                while (run.queue->push(small)) {}
            }
            run.ready(true);
            if (scenario == 1) run.input.disconnected = true;
            if (scenario == 3) {
                run.signals->storageFailed();
                run.poll();
            } else if (scenario == 4) {
                run.apply(transport.stop());
            } else {
                run.input.gates.tick.release();
                run.input.gates.exited();
                const auto update = run.poll();
                check(update.captureExited && update.actions.stopRender, "Input loss or queue saturation must stop output.");
            }
        }
        run.renderWorker.join();
        run.inputWorker.join();
        run.poll();
        const auto outcome = transport.outcome();
        check(outcome.captureError == (scenario == 1 ? CaptureError::deviceInvalidated :
                                       scenario == 2 ? CaptureError::queueFull : CaptureError::none) &&
              outcome.storageFailed == (scenario == 3) && run.renderEnd == RenderEnd::cancelled,
              "Each retry should report only the current fault and stop playback.");
        run.writeAndClose({}, false, scenario == 3);
        old = run.signals;
    }
}
}

int main() {
    try {
        const auto dir = std::filesystem::temp_directory_path() /
                         ("sonoravell-transport-" + std::to_string(std::random_device{}()));
        check(std::filesystem::create_directory(dir), "Could not create transport test directory.");
        struct Cleanup {
            std::filesystem::path path;
            ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
        } cleanup{dir};
        saveProject(dir / "original.sonora", Project{});
        checkConcurrentWorkers(dir, true);
        checkConcurrentWorkers(dir, false);
        checkRetryAndFaults();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
