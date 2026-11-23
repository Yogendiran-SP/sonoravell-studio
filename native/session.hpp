#pragma once

#include "project.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <span>
#include <vector>

namespace sonoravell {
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
using TrackMutes = std::array<bool, maxTracks>;
TrackMutes trackMutes(const Project& project);

// The After Hours score from Sonoravell Studio 1.0.2.
std::vector<Note> afterHours();

class SessionAudio {
public:
    explicit SessionAudio(const Project& project);
    Samples render(const TrackMutes& muted) const;

private:
    friend class PlaybackMixer;
    std::vector<std::vector<float>> tracks;
    std::size_t sampleCount;
};

class PlaybackMixer {
public:
    static constexpr unsigned muteRampFrames = sampleRate / 200;

    PlaybackMixer(const SessionAudio& audio, const TrackMutes& initialMutes);
    // Mix complete interleaved frames from the current position. No allocation.
    std::size_t read(std::span<std::int16_t> output, const TrackMutes& muted) noexcept;
    bool finished() const noexcept;

private:
    const SessionAudio& audio;
    std::size_t position = 0;
    std::array<unsigned, maxTracks> gains{};
};

void writeWave(std::ostream& output, const Samples& samples);
}
