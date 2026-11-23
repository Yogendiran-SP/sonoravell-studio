#pragma once

#include <optional>
#include <string>
#include <vector>

namespace sonoravell {
enum class AudioDirection { input, output };

struct WindowsAudioEndpoint {
    std::wstring name;
    unsigned manufacturer;
    unsigned product;
    unsigned driverVersion;
    bool operator==(const WindowsAudioEndpoint&) const = default;
};

using EndpointChoice = std::optional<WindowsAudioEndpoint>;

std::vector<WindowsAudioEndpoint> listWindowsAudioEndpoints(AudioDirection direction);
// Resolve an explicit selection against the current list before starting I/O.
// Returning to the Windows default is always an explicit user choice.
unsigned resolveWindowsAudioEndpoint(AudioDirection direction, const EndpointChoice& choice);
}
