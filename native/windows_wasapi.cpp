#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <initguid.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>

#include "windows_wasapi.hpp"

#include <memory>
#include <new>
#include <stdexcept>
#include <utility>

namespace sonoravell {
namespace {
using Microsoft::WRL::ComPtr;

class ComApartment {
public:
    explicit ComApartment(DWORD model = COINIT_MULTITHREADED) : result(CoInitializeEx(nullptr, model)) {}
    ~ComApartment() { if (SUCCEEDED(result)) CoUninitialize(); }
    const HRESULT result;
};

class Event {
public:
    explicit Event(bool manual = false) : handle(CreateEventW(nullptr, manual, FALSE, nullptr)) {}
    ~Event() { if (handle) CloseHandle(handle); }
    Event(const Event&) = delete;
    Event& operator=(const Event&) = delete;
    const HANDLE handle;
};

HRESULT makeEnumerator(ComPtr<IMMDeviceEnumerator>& enumerator) noexcept {
    return CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_INPROC_SERVER,
                            IID_PPV_ARGS(enumerator.GetAddressOf()));
}

HRESULT readEndpointId(IMMDevice& device, std::wstring& id) {
    LPWSTR raw = nullptr;
    const auto hr = device.GetId(&raw);
    const auto freeString = [](wchar_t* value) { CoTaskMemFree(value); };
    const std::unique_ptr<wchar_t, decltype(freeString)> allocated(raw, freeString);
    if (FAILED(hr)) return hr;
    if (!raw || !*raw) return E_UNEXPECTED;
    id = raw;
    return S_OK;
}

std::wstring readEndpointName(IMMDevice& device) {
    ComPtr<IPropertyStore> properties;
    if (FAILED(device.OpenPropertyStore(STGM_READ, properties.GetAddressOf()))) return L"Unnamed output";
    struct Property {
        PROPVARIANT value{};
        ~Property() { PropVariantClear(&value); }
    } name;
    if (FAILED(properties->GetValue(PKEY_Device_FriendlyName, &name.value)) ||
        name.value.vt != VT_LPWSTR || !name.value.pwszVal || !*name.value.pwszVal) return L"Unnamed output";
    return name.value.pwszVal;
}

class WasapiEndpoint final : public SharedRenderEndpoint {
public:
    explicit WasapiEndpoint(const RenderEndpointChoice& choice) : choice(choice) {}

    RenderError open(SharedRenderConfig config, SharedRenderReport& report) noexcept override {
        if (!bufferReady.handle || !stopReady.handle) return checked(HRESULT_FROM_WIN32(ERROR_NOT_ENOUGH_MEMORY));
        ComPtr<IMMDeviceEnumerator> enumerator;
        auto hr = makeEnumerator(enumerator);
        if (FAILED(hr)) return checked(hr);

        ComPtr<IMMDevice> device;
        hr = routeRenderEndpoint(choice,
            [&](const std::wstring& id) { return enumerator->GetDevice(id.c_str(), device.GetAddressOf()); },
            [&] { return enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, device.GetAddressOf()); });
        if (FAILED(hr)) return checked(hr);
        DWORD state = 0;
        hr = device->GetState(&state);
        if (FAILED(hr)) return checked(hr);
        if (state != DEVICE_STATE_ACTIVE) return RenderError::deviceUnavailable;
        ComPtr<IMMEndpoint> endpoint;
        hr = device.As(&endpoint);
        if (FAILED(hr)) return checked(hr);
        EDataFlow flow = eAll;
        hr = endpoint->GetDataFlow(&flow);
        if (FAILED(hr)) return checked(hr);
        if (flow != eRender) return RenderError::deviceUnavailable;
        try {
            hr = readEndpointId(*device.Get(), resolved.id);
            if (FAILED(hr)) return checked(hr);
            if (choice && resolved.id != choice->id) return RenderError::deviceUnavailable;
            resolved.name = readEndpointName(*device.Get());
        } catch (const std::bad_alloc&) {
            return checked(E_OUTOFMEMORY);
        }
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
            const auto period = chooseRenderPeriod(config.requestedFrames, {fundamental, minimum, maximum});
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
        return checked(hr);
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
    RenderEndpointInfo resolved;

private:
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

    const RenderEndpointChoice& choice;
    Event bufferReady;
    ComPtr<IAudioClient> client;
    ComPtr<IAudioRenderClient> render;
    HRESULT lastError = S_OK;
};
}

std::vector<RenderEndpointInfo> listWasapiRenderEndpoints() {
    const ComApartment apartment(COINIT_APARTMENTTHREADED);
    if (FAILED(apartment.result) && apartment.result != RPC_E_CHANGED_MODE) {
        throw std::runtime_error("Windows audio services could not initialize for device discovery.");
    }
    ComPtr<IMMDeviceEnumerator> enumerator;
    ComPtr<IMMDeviceCollection> devices;
    if (FAILED(makeEnumerator(enumerator)) ||
        FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, devices.GetAddressOf()))) {
        throw std::runtime_error("Could not list active WASAPI outputs. Check Windows Sound settings and retry.");
    }

    UINT count = 0;
    if (FAILED(devices->GetCount(&count))) throw std::runtime_error("Could not read the WASAPI output list.");
    std::vector<RenderEndpointInfo> endpoints;
    for (UINT index = 0; index < count; ++index) {
        ComPtr<IMMDevice> device;
        RenderEndpointInfo entry;
        if (FAILED(devices->Item(index, device.GetAddressOf())) ||
            FAILED(readEndpointId(*device.Get(), entry.id)) || findRenderEndpoint(endpoints, entry.id)) continue;
        entry.name = readEndpointName(*device.Get());
        endpoints.push_back(std::move(entry));
    }
    sortRenderEndpoints(endpoints);
    return endpoints;
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
    return {report, std::move(config.output), std::move(endpoint.resolved)};
}
}
