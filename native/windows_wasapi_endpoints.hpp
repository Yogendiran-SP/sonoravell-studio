#pragma once

#include <mmdeviceapi.h>
#include <wrl/client.h>

#include "audio_endpoints.hpp"

namespace sonoravell {
class ComApartment {
public:
    explicit ComApartment(DWORD model = COINIT_MULTITHREADED) : result(CoInitializeEx(nullptr, model)) {}
    ~ComApartment() { if (SUCCEEDED(result)) CoUninitialize(); }
    const HRESULT result;
};

std::vector<AudioEndpointInfo> listWasapiEndpoints(EDataFlow direction);
HRESULT resolveWasapiEndpoint(EDataFlow direction, const AudioEndpointChoice& choice,
                              Microsoft::WRL::ComPtr<IMMDevice>& device, AudioEndpointInfo& resolved) noexcept;
}
