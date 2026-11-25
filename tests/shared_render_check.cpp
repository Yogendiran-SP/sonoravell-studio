#include "shared_audio_period.hpp"
#include "shared_render.hpp"
#include "audio_endpoints.hpp"

#include <algorithm>
#include <array>
#include <cstdlib>
#include <iostream>
#include <limits>

using namespace sonoravell;

namespace {
void check(bool pass, const char* message) {
    if (pass) return;
    std::cerr << message << '\n';
    std::exit(1);
}

class Device final : public SharedRenderEndpoint {
public:
    RenderError openResult = RenderError::none;
    RenderError startResult = RenderError::none;
    RenderError acquireResult = RenderError::none;
    RenderError releaseResult = RenderError::none;
    RenderError stopResult = RenderError::none;
    RenderError waitResult = RenderError::none;
    RenderError paddingResult = RenderError::none;
    unsigned bufferFrames = 4;
    unsigned paddingEvents = 0;
    std::array<unsigned, 12> paddings{};
    std::array<std::int16_t, 8> buffer{};
    std::array<std::int16_t, 128> committed{};
    unsigned frames = 0, opened = 0, started = 0, stopped = 0, waits = 0, packets = 0, pending = 0;
    bool cancelWait = false, orderOk = true, badSpan = false;
    std::stop_source* stopAtOpen = nullptr;

    RenderError open(SharedRenderConfig config, SharedRenderReport& report) noexcept override {
        ++opened;
        report.bufferFrames = bufferFrames;
        report.selectedPeriodFrames = config.requestedFrames;
        report.mixRate = 44100;
        report.mixChannels = 2;
        if (stopAtOpen) stopAtOpen->request_stop();
        return openResult;
    }

    RenderError padding(unsigned& result) noexcept override {
        result = paddings[std::min<unsigned>(paddingEvents++, paddings.size() - 1)];
        return paddingResult;
    }

    RenderError acquire(unsigned requested, std::span<std::int16_t>& output) noexcept override {
        if (acquireResult != RenderError::none) return acquireResult;
        if (pending || requested > buffer.size() / channelCount || !requested) {
            orderOk = false;
            return RenderError::invalidBuffer;
        }
        pending = requested;
        output = std::span(buffer).first((badSpan ? 0 : requested) * channelCount);
        return RenderError::none;
    }

    RenderError release(unsigned count) noexcept override {
        if (!pending || (count && count != pending) || (frames + count) * channelCount > committed.size()) {
            orderOk = false;
            return RenderError::invalidBuffer;
        }
        pending = 0;
        if (releaseResult != RenderError::none) return releaseResult;
        if (count) {
            ++packets;
            std::ranges::copy(std::span(buffer).first(count * channelCount), committed.begin() + frames * channelCount);
            frames += count;
        }
        return RenderError::none;
    }

    RenderError start() noexcept override {
        ++started;
        orderOk &= packets == 1 && pending == 0;
        return startResult;
    }
    RenderError stop() noexcept override {
        ++stopped;
        orderOk &= pending == 0;
        return stopResult;
    }
    RenderError wait(std::stop_token, bool& cancelled) noexcept override {
        ++waits;
        if (waits > 12) return RenderError::timeout;
        cancelled = cancelWait;
        return waitResult;
    }
    std::uint32_t nativeError() const noexcept override { return 0x88900004; }
};
}

int main() {
    check(chooseSharedPeriod(256, {48, 96, 480}) == 240, "Expected round to nearest fundamental period.");
    check(chooseSharedPeriod(16, {48, 96, 480}) == 96, "Expected clamp to the supported minimum.");
    check(chooseSharedPeriod(std::numeric_limits<unsigned>::max(), {48, 96, 480}) == 480,
          "Expected clamp without integer overflow.");
    check(!chooseSharedPeriod(256, {0, 96, 480}) && !chooseSharedPeriod(256, {48, 97, 105}) &&
          !chooseSharedPeriod(0, {48, 96, 480}), "Invalid period ranges or system requests must stay distinct.");

    Project project;
    project.bars = 1;
    Samples stereo(sessionFrames(project) * channelCount);
    for (unsigned i = 0; i < stereo.size(); ++i) stereo[i] = static_cast<std::int16_t>(static_cast<int>(i % 121) - 60);
    project.assets.push_back({1, "Reference", std::move(stereo)});
    project.tracks.push_back({1, "Reference", Instrument::audio, false, 100, {}, {wholeAudioClip(1, project.assets.front(), 0)}});
    const SessionAudio session(project);
    const auto expected = session.render({});
    const auto first = sessionFrames(project) - 9;
    std::atomic<unsigned> played{0};
    const auto run = [&](Device& d, std::stop_token stop = {}) {
        PlaybackMixer mixer(session, {}, first);
        return renderShared(d, mixer, {256}, played, stop);
    };

    Device device;
    device.paddings = {1, 0, 1, 0};
    auto report = run(device);
    check(report.end == RenderEnd::completed && report.stage == RenderStage::drain && device.orderOk &&
          device.started == 1 && device.stopped == 1 && device.packets == 3 && device.waits == 4 &&
          report.submittedFrames == 9 && played == 9 && report.emptyBufferEvents == 1,
          "Expected priming, a partial final packet, drain, completion and one suspected underrun.");
    check(std::ranges::equal(std::span(device.committed).first(18), std::span(expected).last(18)),
          "Device packets changed sample order or were padded past EOF.");
    check(report.requestedFrames == 256 && report.selectedPeriodFrames == 256 && report.mixRate == 44100 &&
          report.bufferFrames == 4, "Negotiation telemetry was lost.");

    Device badFormat;
    badFormat.openResult = RenderError::unsupportedFormat;
    report = run(badFormat);
    check(report.end == RenderEnd::failed && report.stage == RenderStage::open &&
          report.error == RenderError::unsupportedFormat && badFormat.started == 0 && badFormat.frames == 0,
          "An unsupported format must not start the stream.");

    Device badPeriod;
    badPeriod.openResult = RenderError::unsupportedPeriod;
    report = run(badPeriod);
    check(report.error == RenderError::unsupportedPeriod && !badPeriod.started, "A refused period must be visible.");

    std::vector<AudioEndpointInfo> inventory{{L"B", L"Speakers"}, {L"A", L"Speakers"}};
    sortAudioEndpoints(inventory);
    check(inventory[0].id == L"A" && inventory[1].id == L"B" &&
          !findAudioEndpoint(inventory, L"Speakers") && !findAudioEndpoint(inventory, L"b"),
          "Discovery order and duplicate names must not affect exact endpoint identity.");
    const AudioEndpointChoice selected = *findAudioEndpoint(inventory, L"B");
    std::wstring systemId = L"A";
    unsigned defaultLookups = 0;
    const auto resolve = [&](const AudioEndpointChoice& choice) {
        return routeAudioEndpoint(choice,
            [&](const auto& id) { return findAudioEndpoint(inventory, id); },
            [&] { ++defaultLookups; return findAudioEndpoint(inventory, systemId); });
    };
    check(resolve({})->id == L"A", "Default choice follows the Windows default.");
    systemId = L"B";
    check(resolve({})->id == L"B", "Default must be resolved again on a new Play.");
    systemId = L"A";
    std::ranges::reverse(inventory);
    const auto runSelected = [&](Device& endpoint) {
        if (!resolve(selected)) endpoint.openResult = RenderError::deviceUnavailable;
        return run(endpoint);
    };
    Device invalidated;
    invalidated.paddingResult = RenderError::deviceInvalidated;
    report = runSelected(invalidated);
    check(report.end == RenderEnd::failed && report.stage == RenderStage::stream &&
          report.deviceInvalidations == 1 && report.nativeError == invalidated.nativeError() &&
          invalidated.stopped == 1 && invalidated.frames == 4, "An invalidated device must stop without an automatic replay.");

    inventory.erase(inventory.begin());
    Device openFailure;
    report = runSelected(openFailure);
    check(report.error == RenderError::deviceUnavailable && !openFailure.started && defaultLookups == 2,
          "Retrying an absent explicit output must stop without contacting the default.");
    inventory.clear();
    check(!resolve({}), "An empty device inventory must report a missing default.");
    inventory.push_back({L"B", L"Renamed speakers"});
    const auto* restored = resolve(selected);
    check(restored && restored->name == L"Renamed speakers" && defaultLookups == 3,
          "A returning endpoint must match its ID despite a new display name.");

    Device badStart;
    badStart.startResult = RenderError::driver;
    report = run(badStart);
    check(report.stage == RenderStage::start && report.end == RenderEnd::failed && !badStart.waits,
          "A failed Start must never wait for buffers.");

    Device invalidPadding;
    invalidPadding.paddings = {5};
    report = run(invalidPadding);
    check(report.error == RenderError::invalidBuffer && invalidPadding.stopped == 1,
          "Out-of-bounds device padding must stop playback.");
    Device invalidSpan;
    invalidSpan.badSpan = true;
    report = run(invalidSpan);
    check(report.error == RenderError::invalidBuffer && invalidSpan.pending == 0 && invalidSpan.started == 0,
          "A malformed endpoint buffer must be released without starting.");
    Device failedCommit;
    failedCommit.releaseResult = RenderError::driver;
    report = run(failedCommit);
    check(report.stage == RenderStage::prime && report.end == RenderEnd::failed && !report.submittedFrames &&
          !failedCommit.started, "A failed packet release must not count its frames.");

    Device timeout;
    timeout.waitResult = RenderError::timeout;
    report = run(timeout);
    check(report.error == RenderError::timeout && report.waitTimeouts == 1 && timeout.stopped == 1,
          "A non-signalling device must time out and stop.");

    Device failedStop;
    failedStop.cancelWait = true;
    failedStop.stopResult = RenderError::deviceInvalidated;
    report = run(failedStop);
    check(report.end == RenderEnd::failed && report.stage == RenderStage::stop && report.deviceInvalidations == 1,
          "A stop failure must be reported.");

    Device cancelled;
    cancelled.cancelWait = true;
    report = run(cancelled);
    check(report.end == RenderEnd::cancelled && cancelled.stopped == 1 && cancelled.frames == 4,
          "Stop during wait must leave a clean endpoint.");
    std::stop_source cancellation;
    Device cancelledDuringOpen;
    cancelledDuringOpen.stopAtOpen = &cancellation;
    report = run(cancelledDuringOpen, cancellation.get_token());
    check(report.end == RenderEnd::cancelled && cancelledDuringOpen.opened == 1 && !cancelledDuringOpen.frames,
          "Stop during setup must prevent priming or starting the device.");
    Device neverOpened;
    report = run(neverOpened, cancellation.get_token());
    check(report.end == RenderEnd::cancelled && !neverOpened.opened, "Cancellation before setup opened a device.");

    Device reopened;
    report = runSelected(reopened);
    check(report.end == RenderEnd::completed && reopened.stopped == 1 && reopened.frames == 9,
          "An explicit retry must succeed on a fresh endpoint.");
}
