#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <mmreg.h>

#include "shared_audio_period.hpp"
#include "windows_wasapi_capture.hpp"
#include "windows_wasapi_endpoints.hpp"
#include "windows_qpc.hpp"

#include <limits>
#include <memory>
#include <utility>

namespace sonoravell {
namespace {
using Microsoft::WRL::ComPtr;
constexpr auto missingPosition = std::numeric_limits<UINT64>::max();

// These are the two standard WAVEFORMATEXTENSIBLE subtypes used here.
constexpr GUID pcmSubtype{WAVE_FORMAT_PCM, 0, 0x0010, {0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71}};
constexpr GUID floatSubtype{WAVE_FORMAT_IEEE_FLOAT, 0, 0x0010, {0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71}};

CaptureEncoding readEncoding(const WAVEFORMATEX& format) noexcept {
    auto tag = format.wFormatTag;
    auto bits = format.wBitsPerSample;
    if (tag == WAVE_FORMAT_EXTENSIBLE && format.cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
        const auto& extended = reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format);
        if (extended.SubFormat == pcmSubtype) tag = WAVE_FORMAT_PCM;
        if (extended.SubFormat == floatSubtype) tag = WAVE_FORMAT_IEEE_FLOAT;
        if (extended.Samples.wValidBitsPerSample != bits) return CaptureEncoding::unsupported;
    }
    if (format.nBlockAlign != format.nChannels * bits / 8) return CaptureEncoding::unsupported;
    if (tag == WAVE_FORMAT_PCM && bits == 16) return CaptureEncoding::pcm16;
    if (tag == WAVE_FORMAT_IEEE_FLOAT && bits == 32) return CaptureEncoding::float32;
    return CaptureEncoding::unsupported;
}

class WasapiCaptureEndpoint final : public SharedCaptureEndpoint {
public:
    WasapiCaptureEndpoint(const AudioEndpointChoice& input, HANDLE stopEvent) noexcept
        : choice(input), stopEvent(stopEvent) {}
    ~WasapiCaptureEndpoint() override {
        capture.Reset();
        client.Reset();
        if (ready) CloseHandle(ready);
    }

    CaptureError open(CaptureStreamConfig configuration, CaptureStreamReport& report) noexcept override {
        if (!ready) return checked(HRESULT_FROM_WIN32(ERROR_NOT_ENOUGH_MEMORY));
        ComPtr<IMMDevice> device;
        auto hr = resolveWasapiEndpoint(eCapture, choice, device, resolved);
        if (FAILED(hr)) return checked(hr);
        hr = device->Activate(__uuidof(IAudioClient), CLSCTX_INPROC_SERVER, nullptr,
                              reinterpret_cast<void**>(client.GetAddressOf()));
        if (FAILED(hr)) return checked(hr);

        WAVEFORMATEX* raw = nullptr;
        hr = client->GetMixFormat(&raw);
        const auto freeFormat = [](WAVEFORMATEX* format) { CoTaskMemFree(format); };
        const std::unique_ptr<WAVEFORMATEX, decltype(freeFormat)> mix(raw, freeFormat);
        if (FAILED(hr)) return checked(hr);
        if (!mix) return CaptureError::unsupportedFormat;
        report.rate = mix->nSamplesPerSec;
        report.channels = mix->nChannels;
        report.encoding = readEncoding(*mix);
        if (report.rate != sampleRate || (report.channels != 1 && report.channels != 2) ||
            report.encoding == CaptureEncoding::unsupported) return CaptureError::unsupportedFormat;

        if (configuration.requestedFrames) {
            ComPtr<IAudioClient3> shared;
            hr = client.As(&shared);
            if (hr == E_NOINTERFACE) return CaptureError::unsupportedBuffer;
            if (FAILED(hr)) return checked(hr);
            UINT32 normal = 0, fundamental = 0, minimum = 0, maximum = 0;
            hr = shared->GetSharedModeEnginePeriod(mix.get(), &normal, &fundamental, &minimum, &maximum);
            if (FAILED(hr)) return checked(hr);
            const auto period = chooseSharedPeriod(configuration.requestedFrames, {fundamental, minimum, maximum});
            if (!period) return CaptureError::unsupportedBuffer;
            hr = shared->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, *period, mix.get(), nullptr);
            if (FAILED(hr)) return checked(hr);
            report.selectedPeriodFrames = *period;
        } else {
            hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 0, 0, mix.get(), nullptr);
            if (FAILED(hr)) return checked(hr);
        }
        hr = client->GetBufferSize(&bufferFrames);
        if (FAILED(hr)) return checked(hr);
        report.bufferFrames = bufferFrames;
        frameBytes = mix->nBlockAlign;
        hr = client->SetEventHandle(ready);
        if (FAILED(hr)) return checked(hr);
        return checked(client->GetService(IID_PPV_ARGS(capture.GetAddressOf())));
    }

    CaptureError start() noexcept override { return checked(client->Start()); }
    CaptureError stop() noexcept override { return checked(client->Stop()); }
    bool stoppedByUserOrWriter() const noexcept override {
        return WaitForSingleObject(stopEvent, 0) == WAIT_OBJECT_0;
    }

    CaptureError wait() noexcept override {
        const HANDLE events[]{stopEvent, ready};
        const auto state = WaitForMultipleObjects(2, events, FALSE, 2000);
        if (state == WAIT_OBJECT_0 || state == WAIT_OBJECT_0 + 1) return CaptureError::none;
        if (state == WAIT_TIMEOUT) {
            UINT32 frames = 0;
            const auto probe = checked(capture->GetNextPacketSize(&frames));
            return probe == CaptureError::none ? CaptureError::timeout : probe;
        }
        return checked(HRESULT_FROM_WIN32(GetLastError()));
    }

    CaptureError acquire(CapturePacket& packet) noexcept override {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        UINT64 device = missingPosition, qpc = 0;
        const auto hr = capture->GetBuffer(&data, &frames, &flags, &device, &qpc);
        if (hr == AUDCLNT_S_BUFFER_EMPTY) return CaptureError::none;
        if (FAILED(hr)) return checked(hr);
        if (!frames) {
            const auto released = release(0);
            return released == CaptureError::none ? CaptureError::invalidPacket : released;
        }
        packet.frames = frames;
        packet.silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
        packet.discontinuity = (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0;
        packet.timestampError = (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) != 0;
        if (device != missingPosition) packet.deviceFrame = device;
        if (qpc) packet.qpc100ns = qpc;
        packet.observedAt = referenceClock.now();
        if (data && frames <= bufferFrames && !packet.silent) {
            packet.bytes = {reinterpret_cast<const std::byte*>(data), static_cast<std::size_t>(frames) * frameBytes};
        }
        return CaptureError::none;
    }

    CaptureError release(unsigned frames) noexcept override { return checked(capture->ReleaseBuffer(frames)); }
    std::uint32_t nativeError() const noexcept override { return static_cast<std::uint32_t>(lastError); }
    AudioEndpointInfo resolved;

private:
    CaptureError checked(HRESULT hr) noexcept {
        lastError = FAILED(hr) ? hr : S_OK;
        if (SUCCEEDED(hr)) return CaptureError::none;
        if (hr == AUDCLNT_E_UNSUPPORTED_FORMAT) return CaptureError::unsupportedFormat;
        if (hr == AUDCLNT_E_INVALID_DEVICE_PERIOD || hr == AUDCLNT_E_ENGINE_PERIODICITY_LOCKED ||
            hr == AUDCLNT_E_BUFFER_SIZE_ERROR) return CaptureError::unsupportedBuffer;
        if (hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_RESOURCES_INVALIDATED) {
            return CaptureError::deviceInvalidated;
        }
        if (hr == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) || hr == AUDCLNT_E_SERVICE_NOT_RUNNING ||
            hr == AUDCLNT_E_DEVICE_IN_USE) return CaptureError::deviceUnavailable;
        return CaptureError::driver;
    }

    const AudioEndpointChoice& choice;
    const HANDLE stopEvent, ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    ComPtr<IAudioClient> client;
    ComPtr<IAudioCaptureClient> capture;
    WindowsQpc referenceClock;
    unsigned bufferFrames = 0, frameBytes = 0;
    HRESULT lastError = S_OK;
};
}

std::vector<AudioEndpointInfo> listWasapiCaptureEndpoints() {
    return listWasapiEndpoints(eCapture);
}

WasapiInputReport runWasapiCapture(CaptureSink& sink, WasapiInputConfig config,
                                   unsigned limit, void* stopEvent, std::atomic<bool>* ready) noexcept {
    const ComApartment apartment;
    if (FAILED(apartment.result)) {
        CaptureStreamReport report;
        report.timing.clock = StreamClock{sampleRate, config.stream.attempt};
        report.error = CaptureError::driver;
        report.nativeError = static_cast<std::uint32_t>(apartment.result);
        report.requestedPeriodFrames = config.stream.requestedFrames;
        return {report, std::move(config.input), {}};
    }
    WasapiCaptureEndpoint endpoint(config.input, stopEvent);
    const auto report = captureShared(endpoint, sink, config.stream, limit, ready);
    return {report, std::move(config.input), std::move(endpoint.resolved)};
}
}
