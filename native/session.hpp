#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <span>
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

class DemoAudio {
public:
    DemoAudio();
    Samples render(const TrackMutes& muted) const;

private:
    friend class PlaybackMixer;
    std::array<std::vector<float>, trackNames.size()> tracks;
};

class PlaybackMixer {
public:
    static constexpr unsigned muteRampFrames = sampleRate / 200;

    PlaybackMixer(const DemoAudio& audio, const TrackMutes& initialMutes);
    // Mix complete interleaved frames from the current position. No allocation.
    std::size_t read(std::span<std::int16_t> output, const TrackMutes& muted) noexcept;
    bool finished() const noexcept;

private:
    const DemoAudio& audio;
    std::size_t position = 0;
    std::array<unsigned, trackNames.size()> gains{};
};

void writeWave(std::ostream& output, const Samples& samples);
}
