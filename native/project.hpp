#pragma once

#include <cstdint>
#include <filesystem>
#include <iosfwd>
#include <string>
#include <vector>

namespace sonoravell {
inline constexpr unsigned sampleRate = 48000;
inline constexpr unsigned channelCount = 2;
inline constexpr unsigned ticksPerBeat = 960;
inline constexpr unsigned beatsPerBar = 4;
inline constexpr unsigned maxTracks = 16;
inline constexpr unsigned maxBars = 128;
inline constexpr unsigned maxAssets = 64;
inline constexpr unsigned maxAssetSamples = sampleRate * channelCount * 120;
inline constexpr unsigned maxProjectSamples = maxAssetSamples * 2;
using Samples = std::vector<std::int16_t>;

enum class Instrument : std::uint8_t { keys, bass, drums, pluck, audio };

struct MidiNote {
    std::uint32_t tick;
    std::uint32_t length;
    std::uint8_t pitch;
    std::uint8_t velocity;
    bool operator==(const MidiNote&) const = default;
};

struct AudioAsset {
    std::uint32_t id;
    std::string name;
    Samples stereo; // 48 kHz, interleaved.
    bool operator==(const AudioAsset&) const = default;
};

struct AudioClip {
    std::uint32_t assetId;
    std::uint32_t tick;
    bool operator==(const AudioClip&) const = default;
};

struct Track {
    std::uint32_t id;
    std::string name;
    Instrument instrument;
    bool muted = false;
    unsigned volume = 100;
    std::vector<MidiNote> notes;
    std::vector<AudioClip> clips;
    bool operator==(const Track&) const = default;
};

struct Project {
    std::string name = "Untitled Session";
    unsigned tempo = 120;
    unsigned bars = 8;
    std::vector<Track> tracks;
    std::vector<AudioAsset> assets;
    bool operator==(const Project&) const = default;
};

Project afterHoursProject();
std::uint32_t frameAtTick(std::uint32_t tick, unsigned tempo);
std::uint32_t sessionFrames(const Project& project);
const AudioAsset& findAsset(const Project& project, std::uint32_t id);
void validateProject(const Project& project);
std::uint32_t recordingCapacity(const Project& project, std::uint32_t tick);
AudioAsset readWave(std::istream& input, std::uint32_t id, std::string name, bool requireSessionRate = false);
Project openProject(const std::filesystem::path& path);
void saveProject(const std::filesystem::path& path, const Project& project);
}
