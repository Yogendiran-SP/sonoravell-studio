#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>

#include "project.hpp"
#include "windows_devices.hpp"

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace sonoravell {
namespace {
struct Discovered {
    unsigned driverId;
    WindowsAudioEndpoint endpoint;
};

std::vector<Discovered> discover(AudioDirection direction) {
    const bool input = direction == AudioDirection::input;
    const auto count = input ? waveInGetNumDevs() : waveOutGetNumDevs();
    std::vector<Discovered> devices;
    for (unsigned id = 0; id < count; ++id) {
        if (input) {
            WAVEINCAPSW capabilities{};
            if (waveInGetDevCapsW(id, &capabilities, sizeof(capabilities)) == MMSYSERR_NOERROR) {
                devices.push_back({id, {capabilities.szPname, capabilities.wMid, capabilities.wPid, capabilities.vDriverVersion}});
            }
        } else {
            WAVEOUTCAPSW capabilities{};
            if (waveOutGetDevCapsW(id, &capabilities, sizeof(capabilities)) == MMSYSERR_NOERROR) {
                devices.push_back({id, {capabilities.szPname, capabilities.wMid, capabilities.wPid, capabilities.vDriverVersion}});
            }
        }
    }
    return devices;
}
}

std::vector<WindowsAudioEndpoint> listWindowsAudioEndpoints(AudioDirection direction) {
    std::vector<WindowsAudioEndpoint> endpoints;
    for (auto& row : discover(direction)) endpoints.push_back(std::move(row.endpoint));
    return endpoints;
}

unsigned resolveWindowsAudioEndpoint(AudioDirection direction, const EndpointChoice& choice) {
    if (!choice) return WAVE_MAPPER;
    const auto devices = discover(direction);
    const auto found = std::ranges::find(devices, *choice, &Discovered::endpoint);
    if (found == devices.end()) throw std::runtime_error("The selected Windows audio device is unavailable. Reopen Audio Devices.");
    if (std::ranges::count(devices, *choice, &Discovered::endpoint) != 1) {
        throw std::runtime_error("Windows reports indistinguishable devices. Select the Windows default endpoint.");
    }
    const bool input = direction == AudioDirection::input;
    const WORD channels = input ? 1 : channelCount;
    WAVEFORMATEX format{WAVE_FORMAT_PCM, channels, sampleRate, sampleRate * channels * 2,
                        static_cast<WORD>(channels * 2), 16, 0};
    const auto support = input ? waveInOpen(nullptr, found->driverId, &format, 0, 0, WAVE_FORMAT_QUERY)
                               : waveOutOpen(nullptr, found->driverId, &format, 0, 0, WAVE_FORMAT_QUERY);
    if (support != MMSYSERR_NOERROR) {
        throw std::runtime_error("The selected Windows device rejected this preview's 48 kHz PCM format.");
    }
    return found->driverId;
}
}
