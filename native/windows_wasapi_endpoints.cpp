#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <initguid.h>
#include <functiondiscoverykeys_devpkey.h>

#include "windows_wasapi_endpoints.hpp"

#include <memory>
#include <new>
#include <stdexcept>
#include <utility>

namespace sonoravell {
namespace {
using Microsoft::WRL::ComPtr;

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
    if (FAILED(device.OpenPropertyStore(STGM_READ, properties.GetAddressOf()))) return L"Unnamed audio endpoint";
    struct Property {
        PROPVARIANT value{};
        ~Property() { PropVariantClear(&value); }
    } name;
    if (FAILED(properties->GetValue(PKEY_Device_FriendlyName, &name.value)) ||
        name.value.vt != VT_LPWSTR || !name.value.pwszVal || !*name.value.pwszVal) return L"Unnamed audio endpoint";
    return name.value.pwszVal;
}

}
HRESULT resolveWasapiEndpoint(EDataFlow direction, const AudioEndpointChoice& choice,
                              ComPtr<IMMDevice>& device, AudioEndpointInfo& resolved) noexcept {
    ComPtr<IMMDeviceEnumerator> enumerator;
    auto hr = makeEnumerator(enumerator);
    if (FAILED(hr)) return hr;
    hr = routeAudioEndpoint(choice,
        [&](const std::wstring& id) { return enumerator->GetDevice(id.c_str(), device.GetAddressOf()); },
        [&] { return enumerator->GetDefaultAudioEndpoint(direction, eMultimedia, device.GetAddressOf()); });
    if (FAILED(hr)) return hr;
    DWORD state = 0;
    hr = device->GetState(&state);
    if (FAILED(hr)) return hr;
    if (state != DEVICE_STATE_ACTIVE) return HRESULT_FROM_WIN32(ERROR_NOT_FOUND);

    ComPtr<IMMEndpoint> endpoint;
    hr = device.As(&endpoint);
    if (FAILED(hr)) return hr;
    EDataFlow flow = eAll;
    hr = endpoint->GetDataFlow(&flow);
    if (FAILED(hr)) return hr;
    if (flow != direction) return HRESULT_FROM_WIN32(ERROR_NOT_FOUND);

    try {
        hr = readEndpointId(*device.Get(), resolved.id);
        if (FAILED(hr)) return hr;
        if (choice && resolved.id != choice->id) return HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
        resolved.name = readEndpointName(*device.Get());
    } catch (const std::bad_alloc&) {
        return E_OUTOFMEMORY;
    }
    return S_OK;
}

std::vector<AudioEndpointInfo> listWasapiEndpoints(EDataFlow direction) {
    const ComApartment apartment(COINIT_APARTMENTTHREADED);
    if (FAILED(apartment.result) && apartment.result != RPC_E_CHANGED_MODE) {
        throw std::runtime_error("Windows audio services could not initialize for device discovery.");
    }
    ComPtr<IMMDeviceEnumerator> enumerator;
    ComPtr<IMMDeviceCollection> devices;
    if (FAILED(makeEnumerator(enumerator)) ||
        FAILED(enumerator->EnumAudioEndpoints(direction, DEVICE_STATE_ACTIVE, devices.GetAddressOf()))) {
        throw std::runtime_error("Could not list active WASAPI endpoints. Check Windows Sound settings and retry.");
    }

    UINT count = 0;
    if (FAILED(devices->GetCount(&count))) throw std::runtime_error("Could not read the WASAPI endpoint list.");
    std::vector<AudioEndpointInfo> endpoints;
    for (UINT index = 0; index < count; ++index) {
        ComPtr<IMMDevice> device;
        AudioEndpointInfo entry;
        if (FAILED(devices->Item(index, device.GetAddressOf())) ||
            FAILED(readEndpointId(*device.Get(), entry.id)) || findAudioEndpoint(endpoints, entry.id)) continue;
        entry.name = readEndpointName(*device.Get());
        endpoints.push_back(std::move(entry));
    }
    sortAudioEndpoints(endpoints);
    return endpoints;
}

}
