#include "project.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <fstream>
#include <limits>
#include <random>
#include <stdexcept>
#include <system_error>
#include <unordered_set>
#include <utility>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace sonoravell {
namespace {
constexpr std::uint32_t schemaVersion = 3;
constexpr std::uint32_t maxEventsPerTrack = 16384;
constexpr std::uint64_t maxMixSamples = 64ull * 1024 * 1024; // 256 MiB of float track audio.
constexpr std::size_t maxNameLength = 200;
constexpr std::array<char, 8> signature{'S', 'O', 'N', 'O', 'S', 'E', 'S', 'S'};

void require(bool valid, const char* reason) {
    if (!valid) throw std::runtime_error(reason);
}

void validateName(const std::string& name) {
    require(!name.empty() && name.size() <= maxNameLength && name.find('\0') == name.npos,
            "Invalid project, track or audio name.");
}

std::uint32_t readNumber(std::istream& file, unsigned bytes = 4) {
    std::uint32_t value = 0;
    for (unsigned i = 0; i < bytes; ++i) {
        const auto byte = file.get();
        require(byte != std::char_traits<char>::eof(), "Unexpected end of file.");
        value |= static_cast<std::uint32_t>(byte) << (i * 8);
    }
    return value;
}

void writeNumber(std::ostream& file, std::uint32_t value, unsigned bytes = 4) {
    for (unsigned i = 0; i < bytes; ++i) file.put(static_cast<char>(value >> (i * 8)));
}

std::string readName(std::istream& file) {
    const auto size = readNumber(file);
    require(size <= maxNameLength, "Invalid project, track or audio name length.");
    std::string name(size, '\0');
    require(static_cast<bool>(file.read(name.data(), size)), "Unexpected end of file.");
    validateName(name);
    return name;
}

void writeName(std::ostream& file, const std::string& name) {
    writeNumber(file, static_cast<std::uint32_t>(name.size()));
    file.write(name.data(), name.size());
}

template<std::size_t Size>
std::array<char, Size> readTag(std::istream& file) {
    std::array<char, Size> tag{};
    require(static_cast<bool>(file.read(tag.data(), Size)), "Unexpected end of file.");
    return tag;
}

void readPcm(std::istream& file, Samples& samples) {
    // PCM and project payloads both use little endian signed 16-bit samples.
    file.read(reinterpret_cast<char*>(samples.data()), samples.size() * sizeof(std::int16_t));
    require(static_cast<bool>(file), "Audio data is truncated.");
    if constexpr (std::endian::native == std::endian::big) {
        for (auto& sample : samples) {
            const auto bits = static_cast<std::uint16_t>(sample);
            sample = std::bit_cast<std::int16_t>(static_cast<std::uint16_t>((bits << 8) | (bits >> 8)));
        }
    }
}

void writePcm(std::ostream& file, const Samples& samples) {
    if constexpr (std::endian::native == std::endian::little) {
        file.write(reinterpret_cast<const char*>(samples.data()), samples.size() * sizeof(std::int16_t));
    } else {
        for (auto sample : samples) writeNumber(file, static_cast<std::uint16_t>(sample), 2);
    }
}

void writeProject(std::ostream& file, const Project& project) {
    file.write(signature.data(), signature.size());
    writeNumber(file, schemaVersion);
    writeName(file, project.name);
    writeNumber(file, project.tempo);
    writeNumber(file, project.bars);
    writeNumber(file, project.masterVolume, 1);
    writeNumber(file, static_cast<std::uint32_t>(project.tracks.size()));
    for (const auto& track : project.tracks) {
        writeNumber(file, track.id);
        writeName(file, track.name);
        writeNumber(file, static_cast<std::uint8_t>(track.instrument), 1);
        writeNumber(file, track.muted, 1);
        writeNumber(file, track.volume, 1);
        writeNumber(file, static_cast<unsigned>(track.pan + 100), 1);
        writeNumber(file, track.solo, 1);
        writeNumber(file, static_cast<std::uint32_t>(track.notes.size()));
        for (const auto& note : track.notes) {
            writeNumber(file, note.tick);
            writeNumber(file, note.length);
            writeNumber(file, note.pitch, 1);
            writeNumber(file, note.velocity, 1);
        }
        writeNumber(file, static_cast<std::uint32_t>(track.clips.size()));
        for (const auto& clip : track.clips) {
            writeNumber(file, clip.id);
            writeNumber(file, clip.assetId);
            writeNumber(file, clip.tick);
            writeNumber(file, clip.sourceFrame);
            writeNumber(file, clip.frameCount);
        }
    }
    writeNumber(file, static_cast<std::uint32_t>(project.assets.size()));
    for (const auto& asset : project.assets) {
        writeNumber(file, asset.id);
        writeName(file, asset.name);
        writeNumber(file, static_cast<std::uint32_t>(asset.stereo().size()));
        writePcm(file, asset.stereo());
    }
}

Project readProject(std::istream& file) {
    require(readTag<8>(file) == signature, "This is not a native Sonoravell Session.");
    const auto version = readNumber(file);
    require(version >= 1 && version <= schemaVersion, "Unsupported Sonoravell Session version.");
    Project project;
    project.name = readName(file);
    project.tempo = readNumber(file);
    project.bars = readNumber(file);
    if (version >= 3) {
        project.masterVolume = readNumber(file, 1);
        require(project.masterVolume <= 100, "Invalid master level.");
    }
    const auto trackCount = readNumber(file);
    require(trackCount <= maxTracks, "Too many tracks in the Session.");
    std::uint32_t legacyClipId = 0;
    for (std::uint32_t i = 0; i < trackCount; ++i) {
        const auto id = readNumber(file);
        auto name = readName(file);
        const auto kind = readNumber(file, 1);
        const auto muted = readNumber(file, 1);
        require(kind <= static_cast<unsigned>(Instrument::audio) && muted <= 1, "Invalid track format.");
        Track track{id, std::move(name), static_cast<Instrument>(kind), muted != 0, readNumber(file, 1), {}, {}};
        if (version >= 3) {
            const auto pan = readNumber(file, 1);
            const auto solo = readNumber(file, 1);
            require(pan <= 200 && solo <= 1, "Invalid track mixer settings.");
            track.pan = static_cast<int>(pan) - 100;
            track.solo = solo != 0;
        }
        const auto notes = readNumber(file);
        require(notes <= maxEventsPerTrack, "Too many MIDI notes in the track.");
        for (std::uint32_t n = 0; n < notes; ++n) {
            track.notes.push_back({readNumber(file), readNumber(file), static_cast<std::uint8_t>(readNumber(file, 1)),
                                   static_cast<std::uint8_t>(readNumber(file, 1))});
        }
        const auto clips = readNumber(file);
        require(clips <= maxEventsPerTrack, "Too many audio clips in the track.");
        for (std::uint32_t n = 0; n < clips; ++n) {
            if (version == 1) track.clips.push_back({++legacyClipId, readNumber(file), readNumber(file), 0, 0});
            else track.clips.push_back({readNumber(file), readNumber(file), readNumber(file), readNumber(file), readNumber(file)});
        }
        project.tracks.push_back(std::move(track));
    }
    const auto assets = readNumber(file);
    require(assets <= maxAssets, "Too many audio sources in the Session.");
    std::size_t totalSamples = 0;
    for (std::uint32_t i = 0; i < assets; ++i) {
        const auto id = readNumber(file);
        auto name = readName(file);
        const auto samples = readNumber(file);
        require(samples && samples <= maxAssetSamples && samples % channelCount == 0 &&
                totalSamples + samples <= maxProjectSamples, "Invalid embedded audio size.");
        totalSamples += samples;
        Samples audio(samples);
        readPcm(file, audio);
        project.assets.emplace_back(id, std::move(name), std::move(audio));
    }
    require(file.peek() == std::char_traits<char>::eof() && !file.bad(), "Unexpected extra or unreadable Session data.");
    if (version == 1) {
        for (auto& track : project.tracks) {
            for (auto& clip : track.clips) clip = wholeAudioClip(clip.id, findAsset(project, clip.assetId), clip.tick);
        }
    }
    validateProject(project);
    return project;
}

class SaveStaging {
public:
    explicit SaveStaging(const std::filesystem::path& destination) {
        std::random_device entropy;
        for (int attempt = 0; attempt < 20; ++attempt) {
            auto candidate = destination.parent_path() / (".sonoravell-save-" + std::to_string(entropy()));
            if (std::filesystem::create_directory(candidate)) {
                path = std::move(candidate);
                return;
            }
        }
        throw std::runtime_error("Could not create temporary Session storage.");
    }
    ~SaveStaging() {
        std::error_code ignored;
        std::filesystem::remove(path / "session", ignored);
        std::filesystem::remove(path, ignored);
    }
    std::filesystem::path path;
};

void commitSave(const std::filesystem::path& temporary, const std::filesystem::path& destination) {
#ifdef _WIN32
    const auto file = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    require(file != INVALID_HANDLE_VALUE, "Could not reopen the staged Session.");
    const auto flushed = FlushFileBuffers(file);
    CloseHandle(file);
    require(flushed, "Could not flush the staged Session.");
    require(MoveFileExW(temporary.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH),
            "Could not replace the Session file.");
#else
    const int file = ::open(temporary.c_str(), O_RDONLY);
    require(file >= 0, "Could not reopen the staged Session.");
    const int flushed = fsync(file);
    close(file);
    require(flushed == 0, "Could not flush the staged Session.");
    std::filesystem::rename(temporary, destination);
    // Best effort for filesystems that do not support syncing directory metadata.
    const int directory = ::open(destination.parent_path().c_str(), O_RDONLY);
    if (directory >= 0) {
        fsync(directory);
        close(directory);
    }
#endif
}
}

AudioAsset::AudioAsset(std::uint32_t id, std::string name, Samples stereo)
    : id(id), name(std::move(name)), pcm(std::make_shared<const Samples>(std::move(stereo))) {}

const Samples& AudioAsset::stereo() const noexcept {
    static const Samples empty;
    return pcm ? *pcm : empty;
}

bool AudioAsset::operator==(const AudioAsset& other) const {
    return id == other.id && name == other.name && (pcm == other.pcm || stereo() == other.stereo());
}

std::uint32_t frameAtTick(std::uint32_t tick, unsigned tempo) {
    require(tempo != 0, "Cannot convert a timeline position at zero tempo.");
    const auto divisor = static_cast<std::uint64_t>(tempo) * ticksPerBeat;
    const auto frame = (static_cast<std::uint64_t>(tick) * 60 * sampleRate + divisor / 2) / divisor;
    require(frame <= std::numeric_limits<std::uint32_t>::max(), "Timeline position exceeds the supported frame range.");
    return static_cast<std::uint32_t>(frame);
}

const AudioAsset& findAsset(const Project& project, std::uint32_t id) {
    const auto found = std::ranges::find(project.assets, id, &AudioAsset::id);
    require(found != project.assets.end(), "A clip refers to a missing audio source.");
    return *found;
}

AudioClip wholeAudioClip(std::uint32_t id, const AudioAsset& asset, std::uint32_t tick) {
    require(asset.stereo().size() <= maxAssetSamples && asset.stereo().size() % channelCount == 0,
            "Invalid audio source size.");
    return {id, asset.id, tick, 0, static_cast<std::uint32_t>(asset.stereo().size() / channelCount)};
}

std::uint32_t newAudioClipId(const Project& project) {
    std::uint32_t maximum = 0;
    for (const auto& track : project.tracks) {
        for (const auto& clip : track.clips) maximum = std::max(maximum, clip.id);
    }
    require(maximum < std::numeric_limits<std::uint32_t>::max(), "No new audio clip ID is available.");
    return maximum + 1;
}

std::uint32_t sessionFrames(const Project& project) {
    auto frames = frameAtTick(project.bars * beatsPerBar * ticksPerBeat, project.tempo);
    for (const auto& track : project.tracks) {
        for (const auto& note : track.notes) {
            frames = std::max(frames, frameAtTick(note.tick + note.length, project.tempo));
        }
        for (const auto& clip : track.clips) {
            const auto end = static_cast<std::uint64_t>(frameAtTick(clip.tick, project.tempo)) + clip.frameCount;
            require(end <= std::numeric_limits<std::uint32_t>::max(), "Audio clip end exceeds the supported frame range.");
            frames = std::max(frames, static_cast<std::uint32_t>(end));
        }
    }
    return frames;
}

namespace {
std::uint64_t renderWork(const Project& project) {
    std::uint64_t frames = 0;
    for (const auto& track : project.tracks) {
        for (const auto& note : track.notes) {
            frames += frameAtTick(note.tick + note.length, project.tempo) - frameAtTick(note.tick, project.tempo);
        }
        for (const auto& clip : track.clips) frames += clip.frameCount;
    }
    return frames;
}
}

std::uint32_t recordingCapacity(const Project& project, std::uint32_t tick) {
    validateProject(project);
    if (project.tracks.size() >= maxTracks || project.assets.size() >= maxAssets || tick >= maxTimelineTick) return 0;
    const auto frameLimit = maxMixSamples / (channelCount * (project.tracks.size() + 1));
    const auto start = frameAtTick(tick, project.tempo);
    if (sessionFrames(project) > frameLimit || start >= frameLimit) return 0;
    std::size_t remainingSamples = maxProjectSamples;
    for (const auto& source : project.assets) remainingSamples -= source.stereo().size();
    return static_cast<std::uint32_t>(std::min<std::uint64_t>({
        frameLimit - start, maxMixSamples - renderWork(project),
        remainingSamples / channelCount, maxAssetSamples / channelCount
    }));
}

void validateProject(const Project& project) {
    validateName(project.name);
    require(project.tempo >= 30 && project.tempo <= 300 && project.bars >= 1 && project.bars <= maxBars,
            "Session tempo or length is outside the supported range.");
    require(project.masterVolume <= 100, "Invalid master level.");
    require(project.tracks.size() <= maxTracks && project.assets.size() <= maxAssets, "Too many tracks or audio sources.");
    std::vector<std::uint32_t> assetIds;
    std::size_t totalSamples = 0;
    for (const auto& asset : project.assets) {
        validateName(asset.name);
        require(asset.id && std::ranges::find(assetIds, asset.id) == assetIds.end(), "Duplicate or invalid audio source ID.");
        assetIds.push_back(asset.id);
        require(!asset.stereo().empty() && asset.stereo().size() <= maxAssetSamples && asset.stereo().size() % channelCount == 0,
                "Invalid embedded audio size.");
        totalSamples += asset.stereo().size();
        require(totalSamples <= maxProjectSamples, "The Session has too much embedded audio.");
    }
    std::vector<std::uint32_t> trackIds;
    std::unordered_set<std::uint32_t> clipIds;
    for (const auto& track : project.tracks) {
        validateName(track.name);
        require(track.id && std::ranges::find(trackIds, track.id) == trackIds.end(), "Duplicate or invalid track ID.");
        trackIds.push_back(track.id);
        require(track.instrument <= Instrument::audio && track.volume <= 100 && track.pan >= -100 && track.pan <= 100 &&
                track.notes.size() <= maxEventsPerTrack && track.clips.size() <= maxEventsPerTrack, "Invalid track settings.");
        require(track.instrument == Instrument::audio ? track.notes.empty() : track.clips.empty(),
                "Track events do not match its type.");
        for (const auto& note : track.notes) {
            require(note.tick < maxTimelineTick && note.length && note.length <= maxTimelineTick - note.tick &&
                    note.pitch <= 127 && note.velocity && note.velocity <= 127, "Invalid MIDI note.");
        }
        for (const auto& clip : track.clips) {
            require(clip.id && clipIds.insert(clip.id).second, "Duplicate or invalid audio clip ID.");
            require(clip.tick < maxTimelineTick, "Audio clip is outside the supported timeline.");
            const auto frames = findAsset(project, clip.assetId).stereo().size() / channelCount;
            require(clip.frameCount && clip.sourceFrame < frames && clip.frameCount <= frames - clip.sourceFrame,
                    "Audio clip range is outside its source.");
        }
    }
    require(renderWork(project) <= maxMixSamples, "Too many overlapping audio or MIDI events for this preview.");
    const auto frames = sessionFrames(project);
    require(static_cast<std::uint64_t>(frames) * channelCount * std::max<std::size_t>(1, project.tracks.size()) <= maxMixSamples,
            "The Session exceeds this preview's playback memory budget.");
}

Project openProject(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    require(static_cast<bool>(file), "Could not open the Session.");
    return readProject(file);
}

void saveProject(const std::filesystem::path& path, const Project& project) {
    validateProject(project);
    const auto destination = std::filesystem::absolute(path);
    if (std::filesystem::is_regular_file(destination)) {
        std::ifstream existing(destination, std::ios::binary);
        require(static_cast<bool>(existing), "Could not check the existing Session version.");
        std::array<char, signature.size()> header{};
        if (existing.read(header.data(), header.size()) && header == signature) {
            require(readNumber(existing) == schemaVersion, "Save to a new filename to preserve the existing Session version.");
        }
    }
    const SaveStaging staging(destination);
    const auto temporary = staging.path / "session";
    std::ofstream file(temporary, std::ios::binary);
    require(static_cast<bool>(file), "Could not create a staged Session file.");
    writeProject(file, project);
    file.close();
    require(static_cast<bool>(file), "Could not finish writing the Session.");
    commitSave(temporary, destination);
}

AudioAsset readWave(std::istream& file, std::uint32_t id, std::string name, bool requireSessionRate) {
    validateName(name);
    require(readTag<4>(file) == std::array{'R', 'I', 'F', 'F'}, "Select a PCM WAV file.");
    const auto riffSize = readNumber(file);
    require(riffSize >= 4 && riffSize <= 64u * 1024 * 1024 && readTag<4>(file) == std::array{'W', 'A', 'V', 'E'}, "Invalid WAV header.");
    auto remaining = riffSize - 4;
    unsigned channels = 0, rate = 0;
    Samples pcm;
    while (remaining >= 8) {
        const auto tag = readTag<4>(file);
        const auto size = readNumber(file);
        const auto padded = static_cast<std::uint64_t>(size) + (size % 2);
        remaining -= 8;
        require(padded <= remaining, "Invalid WAV chunk length.");
        if (tag == std::array{'f', 'm', 't', ' '}) {
            require(!channels && size >= 16 && readNumber(file, 2) == 1, "Use uncompressed 16-bit PCM WAV.");
            channels = readNumber(file, 2);
            rate = readNumber(file);
            const auto byteRate = readNumber(file);
            const auto alignment = readNumber(file, 2);
            const auto bits = readNumber(file, 2);
            require((channels == 1 || channels == 2) && (rate == 44100 || rate == sampleRate) &&
                    bits == 16 && alignment == channels * 2 && byteRate == rate * alignment,
                    "Use mono or stereo 16-bit PCM WAV at 44.1 or 48 kHz.");
            require(!requireSessionRate || rate == sampleRate, "Use an unresampled 48 kHz PCM WAV for timing analysis.");
            file.ignore(static_cast<std::streamsize>(padded - 16));
        } else if (tag == std::array{'d', 'a', 't', 'a'}) {
            require(channels && pcm.empty() && size > 0 && size % (channels * 2) == 0 &&
                    size / (channels * 2) <= rate * 120, "Missing or oversized WAV audio.");
            pcm.resize(size / 2);
            readPcm(file, pcm);
        } else {
            // Bound skip work even for files advertising huge metadata chunks.
            require(padded <= 16 * 1024 * 1024, "WAV metadata exceeds the supported size.");
            file.ignore(static_cast<std::streamsize>(padded));
        }
        require(static_cast<bool>(file), "WAV data is truncated.");
        remaining -= static_cast<std::uint32_t>(padded);
    }
    require(!remaining && !pcm.empty(), "WAV has incomplete or missing audio.");

    const auto inputFrames = pcm.size() / channels;
    const auto outputFrames = (static_cast<std::uint64_t>(inputFrames) * sampleRate + rate - 1) / rate;
    Samples stereo(outputFrames * channelCount);
    for (std::size_t frame = 0; frame < outputFrames; ++frame) {
        const auto fraction = static_cast<std::uint64_t>(frame) * rate;
        const auto from = static_cast<std::size_t>(fraction / sampleRate);
        const auto next = std::min(from + 1, inputFrames - 1);
        const auto weight = static_cast<int>(fraction % sampleRate);
        for (unsigned channel = 0; channel < channelCount; ++channel) {
            const auto index = channels == 1 ? 0 : channel;
            const auto a = pcm[from * channels + index];
            const auto b = pcm[next * channels + index];
            stereo[frame * channelCount + channel] =
                static_cast<std::int16_t>((a * (static_cast<int>(sampleRate) - weight) + b * weight) /
                                          static_cast<int>(sampleRate));
        }
    }
    return {id, std::move(name), std::move(stereo)};
}
}
