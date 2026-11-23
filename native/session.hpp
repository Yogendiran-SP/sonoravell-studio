#pragma once

#include <array>
#include <cstdint>
#include <iosfwd>
#include <vector>

namespace sonoravell {
inline constexpr unsigned sampleRate = 48000;
inline constexpr unsigned channelCount = 2;
inline constexpr double demoTempo = 104;
inline constexpr unsigned demoBars = 8;

struct Note {
    unsigned track;
    int pitch;
    double startBeat;
    double lengthBeats;
    double velocity;
};

inline constexpr std::array trackNames{L"Electric Keys", L"Sub Bass", L"Drum Machine", L"Glass Plucks"};
using TrackMutes = std::array<bool, trackNames.size()>;
using Samples = std::vector<std::int16_t>;

// The After Hours score from Sonoravell Studio 1.0.2.
std::vector<Note> afterHours();
Samples render(const TrackMutes& muted);
void writeWave(std::ostream& output, const Samples& samples);
}
