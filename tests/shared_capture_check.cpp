#include "shared_capture.hpp"
#include "take_queue.hpp"

#include <array>
#include <cmath>
#include <iostream>
#include <limits>
#include <random>
#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

class Device final : public SharedCaptureEndpoint {
public:
    std::vector<CapturePacket> packets;
    CaptureError openError = CaptureError::none, startError = CaptureError::none;
    CaptureError waitError = CaptureError::none, stopError = CaptureError::none;
    unsigned bufferFrames = 960, rate = sampleRate, channels = 2;
    CaptureEncoding encoding = CaptureEncoding::pcm16;
    unsigned invalidationAt = 0, failedReleaseAt = 0, stopAfter = 0;
    bool cancel = false, ordered = true;
    unsigned opens = 0, starts = 0, stops = 0, waits = 0, acquired = 0, released = 0, rejected = 0;
    unsigned outstanding = 0;

    CaptureError open(CaptureStreamConfig, CaptureStreamReport& report) noexcept override {
        ++opens;
        report.rate = rate;
        report.channels = channels;
        report.encoding = encoding;
        report.bufferFrames = bufferFrames;
        return openError;
    }
    CaptureError start() noexcept override { ++starts; return startError; }
    CaptureError wait() noexcept override { ++waits; return waits == 1 ? waitError : CaptureError::timeout; }
    bool stoppedByUserOrWriter() const noexcept override { return cancel || (stopAfter && released == stopAfter); }
    CaptureError acquire(CapturePacket& packet) noexcept override {
        ordered &= !outstanding;
        if (invalidationAt && acquired + 1 == invalidationAt) return CaptureError::deviceInvalidated;
        if (acquired == packets.size()) return CaptureError::none;
        packet = packets[acquired++];
        outstanding = packet.frames;
        return CaptureError::none;
    }
    CaptureError release(unsigned frames) noexcept override {
        ordered &= outstanding && (!frames || frames == outstanding);
        ++released;
        if (!frames) ++rejected;
        outstanding = 0;
        return released == failedReleaseAt ? CaptureError::deviceInvalidated : CaptureError::none;
    }
    CaptureError stop() noexcept override { ++stops; ordered &= !outstanding; return stopError; }
    std::uint32_t nativeError() const noexcept override { return 0x88890004; }
};

struct Sink final : CaptureSink {
    std::unique_ptr<TakeQueue> queue = std::make_unique<TakeQueue>();
    CaptureError fail = CaptureError::none;
    CaptureError push(std::span<const std::int16_t> packet) noexcept override {
        if (fail != CaptureError::none) return fail;
        return queue->pushPacket(packet) ? CaptureError::none : CaptureError::queueFull;
    }
    Samples take() {
        Samples mono;
        CaptureBlock block;
        while (queue->pop(block)) mono.insert(mono.end(), block.samples.begin(), block.samples.begin() + block.count);
        return mono;
    }
};

constexpr std::array<std::int16_t, 4> stereo{100, 300, -300, -100};
constexpr std::array<float, 4> floats{0.25f, 0.75f, 1.5f, 1.5f};
constexpr std::array<std::int16_t, 2> nonzero{71, 72};

CapturePacket pcm(std::uint64_t pos, std::uint64_t timestamp = 30000000) {
    return {std::as_bytes(std::span(stereo)), 2, false, false, false, pos, timestamp};
}

struct RecordingFixture {
    Device device;
    Sink sink;

    CaptureStreamReport run(unsigned limit = 50) {
        const auto report = captureShared(device, sink, {20}, limit);
        check(device.ordered && device.acquired == device.released && !device.outstanding,
              "Every acquired packet must be released exactly once before another acquisition or Stop.");
        return report;
    }
};

void checkLifecycleAndFormats() {
    RecordingFixture fixture;
    fixture.device.packets = {pcm(20), pcm(22, 30000417), pcm(24, 30000833)};
    auto& silence = fixture.device.packets[1];
    silence.silent = true;
    silence.bytes = {};
    const auto complete = fixture.run(5);
    check(complete.end == CaptureEnd::limit && complete.acceptedFrames == 5 && complete.silentFrames == 2 &&
          complete.requestedPeriodFrames == 20 && complete.bufferFrames == 960 &&
          fixture.sink.take() == Samples{200, -200, 0, 0, 200} && fixture.device.stops == 1,
          "PCM order, genuine silence or the partial final packet changed.");

    RecordingFixture floatFixture;
    floatFixture.device.encoding = CaptureEncoding::float32;
    floatFixture.device.packets = {{std::as_bytes(std::span(floats)), 2, false, false, false, 0, 1}};
    check(floatFixture.run(2).end == CaptureEnd::limit &&
          floatFixture.sink.take() == Samples{16384, 32767}, "Float stereo downmix or clipping failed.");

    RecordingFixture nonFinite;
    auto invalidFloat = floats;
    invalidFloat.back() = std::numeric_limits<float>::quiet_NaN();
    nonFinite.device.encoding = CaptureEncoding::float32;
    nonFinite.device.packets = {{std::as_bytes(std::span(invalidFloat)), 2, false, false, false, 0, 1}};
    check(nonFinite.run().error == CaptureError::invalidPacket && nonFinite.device.rejected == 1 &&
          nonFinite.sink.take().empty(), "Invalid float data reached the queue.");

    RecordingFixture unsupported;
    unsupported.device.rate = 44100;
    check(unsupported.run().error == CaptureError::unsupportedFormat && !unsupported.device.starts,
          "An unsupported mix format started the endpoint.");
    RecordingFixture overlong;
    overlong.device.bufferFrames = takeBlockFrames + 1;
    check(overlong.run().error == CaptureError::unsupportedBuffer && !overlong.device.starts,
          "An oversized endpoint buffer started capture.");
    RecordingFixture missing;
    missing.device.openError = CaptureError::deviceUnavailable;
    check(missing.run().stage == CaptureStage::open && !missing.device.starts, "A missing input started capture.");
    RecordingFixture startFailure;
    startFailure.device.startError = CaptureError::driver;
    check(startFailure.run().stage == CaptureStage::start && !startFailure.device.stops && !startFailure.device.waits,
          "Start failure incorrectly entered the capture loop.");
    RecordingFixture cancelled;
    cancelled.device.cancel = true;
    check(cancelled.run().end == CaptureEnd::stopped && !cancelled.device.opens, "Early cancellation opened an input.");

    RecordingFixture stopped;
    stopped.device.stopAfter = 1;
    stopped.device.packets = {pcm(0), pcm(2)};
    const auto result = stopped.run();
    check(result.end == CaptureEnd::stopped && stopped.device.acquired == 1 && stopped.device.stops == 1 &&
          stopped.sink.take() == Samples{200, -200}, "User Stop changed the accepted packet boundary.");

    RecordingFixture timeout;
    check(timeout.run().error == CaptureError::timeout && timeout.device.stops == 1 && !timeout.device.released,
          "An empty acquisition requires no release and the next wait can time out.");
}

void checkClockAndFailures() {
    RecordingFixture clock;
    std::array<std::int16_t, 480> mono{};
    const auto bytes = std::as_bytes(std::span(mono));
    clock.device.channels = 1;
    constexpr std::uint64_t offset = 50000000000;
    constexpr std::uint64_t frame = 1000;
    clock.device.packets = {
        {bytes, 480, false, false, false, frame, offset},
        {bytes, 480, false, false, true, frame + 480, offset + 99999},
        {bytes, 480, false, false, false, frame + 960, std::nullopt},
        {bytes, 480, false, false, false, frame + 1440, offset - 1},
        {bytes, 480, false, false, false, frame + 1920, offset + 399960},
    };
    const auto report = clock.run(2400);
    const auto ppm = report.timing.driftPpm();
    check(report.end == CaptureEnd::limit && report.timing.firstDeviceFrame == frame &&
          report.timing.lastDeviceFrame == frame + 1920 && report.timing.first->qpc100ns == offset &&
          report.timing.last->deviceFrame == frame + 1920 && report.timing.unreliableTimestamps == 3 &&
          ppm && std::abs(*ppm - 100.01) < 0.01 && clock.sink.take().size() == 2400,
          "Clock offset, drift and unreliable timestamps must remain independent of PCM order.");

    for (unsigned mode = 0; mode < 4; ++mode) {
        RecordingFixture loss;
        loss.device.packets = {pcm(40), pcm(42, 30000417), pcm(44, 30000833)};
        auto& bad = loss.device.packets[1];
        if (mode == 0) bad.discontinuity = true;
        if (mode == 1) bad.deviceFrame = 43;
        if (mode == 2) bad.deviceFrame = 41;
        if (mode == 3) bad.deviceFrame.reset();
        const auto result = loss.run();
        check(result.error == (mode == 3 ? CaptureError::missingPosition : CaptureError::discontinuity) &&
              result.stage == CaptureStage::packet && loss.device.rejected == 1 && loss.device.stops == 1 &&
              loss.sink.take() == Samples{200, -200}, "A missing or discontinuous packet crossed the verified prefix.");
    }

    RecordingFixture invalidated;
    invalidated.device.packets = {pcm(0), pcm(2)};
    invalidated.device.invalidationAt = 2;
    const auto lost = invalidated.run();
    check(lost.error == CaptureError::deviceInvalidated && lost.stage == CaptureStage::acquire &&
          lost.nativeError == 0x88890004 && invalidated.device.stops == 1 && invalidated.sink.take() == Samples{200, -200},
          "Device invalidation did not preserve its native reason and prefix.");
    RecordingFixture retry;
    retry.device.packets = {pcm(420)};
    check(retry.run(2).end == CaptureEnd::limit && retry.sink.take() == Samples{200, -200},
          "Explicit retry reused stale capture state.");

    RecordingFixture releaseFailure;
    releaseFailure.device.packets = {pcm(0), pcm(2)};
    releaseFailure.device.failedReleaseAt = 2;
    check(releaseFailure.run().stage == CaptureStage::release && releaseFailure.sink.take() == Samples{200, -200},
          "An unconfirmed packet was committed after a release failure.");

    RecordingFixture stopFailure;
    stopFailure.device.packets = {pcm(0)};
    stopFailure.device.stopError = CaptureError::deviceInvalidated;
    check(stopFailure.run(2).stage == CaptureStage::stop && stopFailure.sink.take() == Samples{200, -200},
          "Failed driver Stop must report interruption and keep confirmed audio.");

    RecordingFixture disk;
    disk.device.packets = {pcm(0)};
    disk.sink.fail = CaptureError::storage;
    check(disk.run().error == CaptureError::storage && disk.sink.take().empty(),
          "Storage failure must be distinct from endpoint and queue failures.");
}

void checkQueueAndRecovery() {
    RecordingFixture saturated;
    unsigned prefilled = 0;
    while (saturated.sink.queue->push(nonzero)) ++prefilled;
    CaptureBlock discard;
    check(saturated.sink.queue->pop(discard), "Queue fixture could not make one available slot.");
    std::array<std::int16_t, captureBlockFrames + 1> tooLarge{};
    saturated.device.channels = 1;
    saturated.device.bufferFrames = static_cast<unsigned>(tooLarge.size());
    saturated.device.packets = {{std::as_bytes(std::span(tooLarge)), saturated.device.bufferFrames,
                                 false, false, false, 0, 1}};
    const auto full = saturated.run(saturated.device.bufferFrames);
    const auto left = saturated.sink.take();
    check(full.error == CaptureError::queueFull && !full.acceptedFrames && saturated.device.stops == 1 &&
          left.size() == (prefilled - 1) * nonzero.size(), "Queue saturation partially published a multiblock packet.");

    RecordingFixture capture;
    capture.device.packets = {pcm(0), pcm(2)};
    capture.device.invalidationAt = 2;
    const auto result = capture.run();
    const auto dir = std::filesystem::temp_directory_path() /
                     ("sonoravell-capture-" + std::to_string(std::random_device{}()));
    check(std::filesystem::create_directory(dir), "Cannot create capture fixture directory.");
    struct Cleanup {
        std::filesystem::path path;
        ~Cleanup() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
    } cleanup{dir};

    const auto projectPath = dir / "prior.sonora";
    const auto journalPath = dir / "interrupted.sntake";
    const Project prior;
    saveProject(projectPath, prior);
    {
        const auto mono = capture.sink.take();
        TakeWriter writer(journalPath, 960);
        writer.append(mono);
        if (result.end != CaptureEnd::interrupted) writer.finalize();
    }
    const auto recovered = recoverTake(journalPath);
    check(!recovered.finalized && recovered.startTick == 960 && recovered.stereo == Samples{200, 200, -200, -200} &&
          openProject(projectPath) == prior, "Capture interruption changed the prior Session or lost committed audio.");
    auto restored = prior;
    restored.assets.push_back({1, "Recovered", recovered.stereo});
    restored.tracks.push_back({1, "Recovered", Instrument::audio, false, 100, {}, {{1, recovered.startTick}}});
    const auto restoredPath = dir / "recovered.sonora";
    saveProject(restoredPath, restored);
    check(openProject(restoredPath) == restored, "The captured prefix failed to survive Session save and reopen.");
}
}

int main() {
    try {
        checkLifecycleAndFormats();
        checkClockAndFailures();
        checkQueueAndRecovery();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
