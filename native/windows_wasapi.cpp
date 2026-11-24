#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>

#include "shared_audio_period.hpp"
#include "windows_wasapi.hpp"
#include "windows_wasapi_endpoints.hpp"
#include "windows_qpc.hpp"

#include <memory>
#include <utility>

namespace sonoravell {
namespace {
using Microsoft::WRL::ComPtr;

class Event {
public:
    explicit Event(bool manual = false) : handle(CreateEventW(nullptr, manual, FALSE, nullptr)) {}
    ~Event() { if (handle) CloseHandle(handle); }
    Event(const Event&) = delete;
    Event& operator=(const Event&) = delete;
    const HANDLE handle;
};

class WasapiEndpoint final : public SharedRenderEndpoint {
public:
    explicit WasapiEndpoint(const AudioEndpointChoice& choice) : choice(choice) {}

    RenderError open(SharedRenderConfig config, SharedRenderReport& report) noexcept override {
        if (!bufferReady.handle || !stopReady.handle) return checked(HRESULT_FROM_WIN32(ERROR_NOT_ENOUGH_MEMORY));
        ComPtr<IMMDevice> device;
        auto hr = resolveWasapiEndpoint(eRender, choice, device, resolved);
        if (FAILED(hr)) return checked(hr);
        hr = device->Activate(__uuidof(IAudioClient), CLSCTX_INPROC_SERVER, nullptr,
                              reinterpret_cast<void**>(client.GetAddressOf()));
        if (FAILED(hr)) return checked(hr);

        const auto freeFormat = [](WAVEFORMATEX* format) { CoTaskMemFree(format); };
        WAVEFORMATEX* format = nullptr;
        hr = client->GetMixFormat(&format);
        const std::unique_ptr<WAVEFORMATEX, decltype(freeFormat)> mix(format, freeFormat);
        if (FAILED(hr)) return checked(hr);
        if (!mix || !mix->nSamplesPerSec || !mix->nChannels) return RenderError::unsupportedFormat;
        report.mixRate = mix->nSamplesPerSec;
        report.mixChannels = mix->nChannels;

        WAVEFORMATEX pcm{WAVE_FORMAT_PCM, channelCount, sampleRate, sampleRate * channelCount * 2,
                         channelCount * 2, 16, 0};
        format = nullptr;
        hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, &pcm, &format);
        const std::unique_ptr<WAVEFORMATEX, decltype(freeFormat)> closest(format, freeFormat);
        const bool exact = hr == S_OK;
        if (!exact && hr != S_FALSE && hr != AUDCLNT_E_UNSUPPORTED_FORMAT) return checked(hr);
        auto flags = static_cast<DWORD>(AUDCLNT_STREAMFLAGS_EVENTCALLBACK);
        if (config.requestedFrames) {
            if (!exact) return RenderError::unsupportedFormat;
            ComPtr<IAudioClient3> shared;
            hr = client.As(&shared);
            if (hr == E_NOINTERFACE) return RenderError::unsupportedPeriod;
            if (FAILED(hr)) return checked(hr);
            UINT32 normal = 0, fundamental = 0, minimum = 0, maximum = 0;
            hr = shared->GetSharedModeEnginePeriod(&pcm, &normal, &fundamental, &minimum, &maximum);
            if (FAILED(hr)) return checked(hr);
            const auto period = chooseSharedPeriod(config.requestedFrames, {fundamental, minimum, maximum});
            if (!period) return RenderError::unsupportedPeriod;
            hr = shared->InitializeSharedAudioStream(flags, *period, &pcm, nullptr);
            if (FAILED(hr)) return checked(hr);
            report.selectedPeriodFrames = *period;
        } else {
            if (!exact) flags |= AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &pcm, nullptr);
            if (FAILED(hr)) return checked(hr);
            report.conversionEnabled = !exact;
        }
        hr = client->GetBufferSize(&report.bufferFrames);
        if (FAILED(hr)) return checked(hr);
        hr = client->SetEventHandle(bufferReady.handle);
        if (FAILED(hr)) return checked(hr);
        hr = client->GetService(IID_PPV_ARGS(render.GetAddressOf()));
        if (FAILED(hr)) return checked(hr);
        UINT64 rate = 0;
        if (SUCCEEDED(client->GetService(IID_PPV_ARGS(audioClock.GetAddressOf()))) &&
            SUCCEEDED(audioClock->GetFrequency(&rate)) && rate) {
            clock = StreamClock{rate};
        } else {
            audioClock.Reset();
        }
        return RenderError::none;
    }

    RenderError padding(unsigned& frames) noexcept override { return checked(client->GetCurrentPadding(&frames)); }
    RenderError acquire(unsigned frames, std::span<std::int16_t>& output) noexcept override {
        BYTE* data = nullptr;
        const auto hr = render->GetBuffer(frames, &data);
        if (FAILED(hr)) return checked(hr);
        if (!data) {
            render->ReleaseBuffer(0, 0);
            return RenderError::invalidBuffer;
        }
        output = {reinterpret_cast<std::int16_t*>(data), static_cast<std::size_t>(frames) * channelCount};
        return RenderError::none;
    }
    RenderError release(unsigned frames) noexcept override { return checked(render->ReleaseBuffer(frames, 0)); }
    RenderError start() noexcept override { return checked(client->Start()); }
    RenderError stop() noexcept override { return checked(client->Stop()); }

    RenderError wait(std::stop_token stop, bool& cancelled) noexcept override {
        if (!stop.stop_requested()) sampleClock();
        const HANDLE events[]{stopReady.handle, bufferReady.handle};
        const auto signalled = WaitForMultipleObjects(2, events, FALSE, 2000);
        cancelled = signalled == WAIT_OBJECT_0 || stop.stop_requested();
        if (cancelled || signalled == WAIT_OBJECT_0 + 1) return RenderError::none;
        if (signalled == WAIT_TIMEOUT) {
            unsigned padding = 0;
            // A missing event can also be the only visible sign of device loss.
            const auto error = this->padding(padding);
            return error == RenderError::none ? RenderError::timeout : error;
        }
        return checked(HRESULT_FROM_WIN32(GetLastError()));
    }

    std::uint32_t nativeError() const noexcept override { return static_cast<std::uint32_t>(lastError); }

    Event stopReady{true};
    AudioEndpointInfo resolved;
    StreamClock clock{};

private:
    void sampleClock() noexcept {
        if (!audioClock) return;
        const auto now = referenceClock.now();
        if (!now) {
            clock.observe({}, {});
            return;
        }
        if (lastPoll && now->ticks100ns >= lastPoll->ticks100ns &&
            now->ticks100ns - lastPoll->ticks100ns < qpcTicksPerSecond / 10) return;
        lastPoll = now;
        UINT64 position = 0, qpc = 0;
        std::optional<ClockStamp> stamp;
        // S_FALSE indicates lower timestamp accuracy. Treat it as missing evidence.
        if (audioClock->GetPosition(&position, &qpc) == S_OK) stamp = ClockStamp{{position}, {qpc}};
        clock.observe(stamp, referenceClock.now());
    }

    RenderError checked(HRESULT hr) noexcept {
        lastError = FAILED(hr) ? hr : S_OK;
        if (SUCCEEDED(hr)) return RenderError::none;
        if (hr == AUDCLNT_E_UNSUPPORTED_FORMAT) return RenderError::unsupportedFormat;
        if (hr == AUDCLNT_E_INVALID_DEVICE_PERIOD || hr == AUDCLNT_E_ENGINE_PERIODICITY_LOCKED) {
            return RenderError::unsupportedPeriod;
        }
        if (hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_RESOURCES_INVALIDATED) {
            return RenderError::deviceInvalidated;
        }
        if (hr == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) || hr == AUDCLNT_E_SERVICE_NOT_RUNNING || hr == AUDCLNT_E_DEVICE_IN_USE) {
            return RenderError::deviceUnavailable;
        }
        return RenderError::driver;
    }

    const AudioEndpointChoice& choice;
    Event bufferReady;
    ComPtr<IAudioClient> client;
    ComPtr<IAudioRenderClient> render;
    ComPtr<IAudioClock> audioClock;
    WindowsQpc referenceClock;
    std::optional<QpcTime> lastPoll;
    HRESULT lastError = S_OK;
};
}

std::vector<AudioEndpointInfo> listWasapiRenderEndpoints() {
    return listWasapiEndpoints(eRender);
}

WasapiOutputReport runWasapiOutput(PlaybackMixer& mixer, WasapiOutputConfig config,
                                  const std::atomic<unsigned>& muteMask, std::atomic<unsigned>& played,
                                  std::stop_token stop) noexcept {
    const ComApartment apartment;
    if (FAILED(apartment.result)) {
        SharedRenderReport report;
        report.end = RenderEnd::failed;
        report.error = RenderError::driver;
        report.requestedFrames = config.stream.requestedFrames;
        report.nativeError = static_cast<std::uint32_t>(apartment.result);
        return {report, std::move(config.output), {}};
    }
    WasapiEndpoint endpoint(config.output);
    std::stop_callback wakeOnStop(stop, [&endpoint] {
        if (endpoint.stopReady.handle) SetEvent(endpoint.stopReady.handle);
    });
    const auto report = renderShared(endpoint, mixer, config.stream, muteMask, played, stop);
    return {report, std::move(config.output), std::move(endpoint.resolved), endpoint.clock};
}
}
