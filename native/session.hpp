#pragma once

#include "mixer_parameters.hpp"

#include <array>
#include <atomic>
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

// The After Hours score from Sonoravell Studio 1.0.2.
std::vector<Note> afterHours();

class SessionAudio {
public:
    explicit SessionAudio(const Project& project);
    Samples render(const MixerParameters& parameters) const;

private:
    friend class PlaybackMixer;
    std::vector<std::vector<float>> tracks;
    std::size_t sampleCount;
};

class PlaybackMixer {
public:
    static constexpr unsigned rampFrames = sampleRate / 200;

    PlaybackMixer(const SessionAudio& audio, const MixerParameters& initial = {}, std::size_t startFrame = 0,
                  std::atomic<std::uint32_t>* peakMeter = nullptr, MixerParameterMailbox* mailbox = nullptr);
    void setParameters(const MixerParameters& parameters) noexcept;
    // Mix complete interleaved frames from the current position. No allocation.
    std::size_t read(std::span<std::int16_t> output) noexcept;
    bool finished() const noexcept;
    unsigned remainingFrames() const noexcept;

private:
    const SessionAudio& audio;
    std::size_t position = 0;
    std::atomic<std::uint32_t>* peakMeter;
    MixerParameterMailbox* mailbox;
    struct Ramp {
        double value = 1.;
        double target = 1.;
        double step = 0.;
        unsigned remaining = 0;
        void set(double next) noexcept;
        double next() noexcept;
    };
    std::array<std::array<Ramp, channelCount>, maxTracks> gains{};
    Ramp master;
};

void writeWave(std::ostream& output, const Samples& samples);
}
