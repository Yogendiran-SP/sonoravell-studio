#pragma once

#include "insert_processing.hpp"
#include "mixer_parameters.hpp"
#include "playback_position.hpp"
#include "metronome.hpp"
#include "source_blocks.hpp"

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <optional>
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
    explicit SessionAudio(const Project& project, SourceStorage storage = SourceStorage::sparseBlocks);
    Samples render(const MixerParameters& parameters, AudioBlockProcessor* effects = nullptr) const;
    Samples renderProject(const Project& project) const;
    std::size_t preparedBytes() const noexcept;

private:
    friend class PlaybackMixer;
    std::vector<PreparedTrack> tracks;
    std::size_t sampleCount;
    std::optional<Metronome> metronome;
};

class PlaybackMixer {
public:
    static constexpr unsigned rampFrames = sampleRate / 200;

    PlaybackMixer(const SessionAudio& audio, const MixerParameters& initial = {}, std::size_t startFrame = 0,
                  std::atomic<std::uint32_t>* peakMeter = nullptr, MixerParameterMailbox* mailbox = nullptr, bool loop = false, AudioBlockProcessor* effects = nullptr, bool click = false);
    void attachInserts(PreparedInserts* prepared) noexcept { inserts = prepared; }
    bool setLoopRegion(PlaybackLoop range) noexcept;
    void setParameters(const MixerParameters& parameters) noexcept;
    // Mix complete interleaved frames from the current position. No allocation.
    std::size_t read(std::span<std::int16_t> output) noexcept;
    bool finished() const noexcept;
    unsigned remainingFrames() const noexcept;

private:
    void mixBlock(std::span<std::int16_t> output, std::size_t index, std::size_t first,
                  std::array<unsigned, channelCount>& peaks) noexcept;
    const SessionAudio& audio;
    std::size_t position = 0;
    std::atomic<std::uint32_t>* peakMeter;
    MixerParameterMailbox* mailbox;
    bool loop;
    std::size_t loopFirst = 0, loopEnd = 0;
    AudioBlockProcessor* effects;
    PreparedInserts* inserts = nullptr;
    bool click;
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
