#include "take_journal.hpp"

#include <array>
#include <bit>
#include <fstream>
#include <stdexcept>
#include <string_view>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <share.h>
#include <sys/stat.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace sonoravell {
namespace {
constexpr std::string_view magic = "SONTAKE1";
constexpr unsigned maxFrames = maxAssetSamples / channelCount;
constexpr unsigned maxTick = maxBars * beatsPerBar * ticksPerBeat;

void encode32(std::span<char, 4> bytes, std::uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) bytes[i] = static_cast<char>(value >> (i * 8));
}

std::uint32_t decode32(std::span<const char, 4> bytes) {
    std::uint32_t value = 0;
    for (unsigned i = 0; i < 4; ++i) value |= static_cast<std::uint32_t>(static_cast<unsigned char>(bytes[i])) << (i * 8);
    return value;
}

std::uint32_t checksum(std::span<const char> bytes) {
    std::uint32_t value = 2166136261u;
    for (unsigned char byte : bytes) value = (value ^ byte) * 16777619u;
    return value;
}

std::FILE* createFile(const std::filesystem::path& path) {
#ifdef _WIN32
    int fd = -1;
    if (_wsopen_s(&fd, path.c_str(), _O_CREAT | _O_EXCL | _O_WRONLY | _O_BINARY,
                  _SH_DENYRW, _S_IREAD | _S_IWRITE) != 0) return nullptr;
    auto* file = _fdopen(fd, "wb");
    if (!file) _close(fd);
#else
    const auto fd = ::open(path.c_str(), O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fd < 0) return nullptr;
    auto* file = fdopen(fd, "wb");
    if (!file) close(fd);
#endif
    return file;
}
}

TakeWriter::TakeWriter(const std::filesystem::path& path, std::uint32_t startTick) {
    if (startTick >= maxTick) throw std::runtime_error("The recording start is outside the supported timeline.");
    file.reset(createFile(path));
    if (!file) throw std::runtime_error("Could not create the recording recovery file.");
    if (std::setvbuf(file.get(), nullptr, _IONBF, 0) != 0) throw std::runtime_error("Could not configure recording writes.");
    std::array<char, 8> header{};
    encode32(std::span(header).first<4>(), startTick);
    encode32(std::span(header).last<4>(), checksum(std::span(header).first<4>()));
    if (std::fwrite(magic.data(), 1, magic.size(), file.get()) != magic.size() ||
        std::fwrite(header.data(), 1, header.size(), file.get()) != header.size()) {
        throw std::runtime_error("Could not write the recording recovery header.");
    }
    sync();
#ifndef _WIN32
    // Persist the directory entry where the filesystem supports directory fsync.
    const auto parent = path.has_parent_path() ? path.parent_path() : std::filesystem::path(".");
    const auto directory = ::open(parent.c_str(), O_RDONLY);
    if (directory >= 0) {
        fsync(directory);
        close(directory);
    }
#endif
}

void TakeWriter::append(std::span<const std::int16_t> mono) {
    if (mono.empty() || mono.size() > takeBlockFrames || frames + mono.size() > maxFrames) {
        throw std::runtime_error("Invalid recording block size.");
    }
    writeRecord(mono);
    frames += mono.size();
}

void TakeWriter::finalize() {
    writeRecord({});
    finalized = true;
}

void TakeWriter::writeRecord(std::span<const std::int16_t> mono) {
    if (failed || finalized) throw std::runtime_error("The recording journal is closed to new blocks.");
    std::array<char, 8 + 2 * takeBlockFrames> block;
    auto sizeBytes = std::span(block).first<4>();
    encode32(sizeBytes, static_cast<std::uint32_t>(mono.size()));
    auto pcm = std::span(block).subspan(8, mono.size() * 2);
    for (std::size_t i = 0; i < mono.size(); ++i) {
        const auto value = static_cast<std::uint16_t>(mono[i]);
        pcm[i * 2] = static_cast<char>(value);
        pcm[i * 2 + 1] = static_cast<char>(value >> 8);
    }
    encode32(std::span(block).subspan<4, 4>(), checksum(pcm) ^ checksum(sizeBytes));
    failed = true;
    if (std::fwrite(block.data(), 1, 8 + pcm.size(), file.get()) != 8 + pcm.size()) {
        throw std::runtime_error("Recording storage write failed.");
    }
    sync();
    failed = false;
}

void TakeWriter::sync() {
    if (std::fflush(file.get()) != 0) throw std::runtime_error("Recording storage flush failed.");
#ifdef _WIN32
    const auto result = _commit(_fileno(file.get()));
#else
    const auto result = fsync(fileno(file.get()));
#endif
    if (result != 0) throw std::runtime_error("Could not commit recording audio to storage.");
}

RecoveredTake recoverTake(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    std::array<char, 8> signature{}, header{};
    if (!file.read(signature.data(), signature.size()) || std::string_view(signature.data(), signature.size()) != magic ||
        !file.read(header.data(), header.size())) {
        throw std::runtime_error("The take is still in use or has an invalid recovery header.");
    }
    RecoveredTake take;
    take.startTick = decode32(std::span(header).first<4>());
    if (take.startTick >= maxTick ||
        decode32(std::span(header).last<4>()) != checksum(std::span(header).first<4>())) {
        throw std::runtime_error("The take start position is damaged.");
    }

    std::array<char, takeBlockFrames * 2> pcm;
    while (file.read(header.data(), header.size())) {
        const auto bytes = std::span(header).first<4>();
        const auto frames = decode32(bytes);
        if (frames > takeBlockFrames || frames > maxFrames - take.stereo.size() / channelCount) break;
        const auto payload = std::span(pcm).first(frames * 2);
        if (!file.read(payload.data(), payload.size()) ||
            decode32(std::span(header).last<4>()) != (checksum(payload) ^ checksum(bytes))) break;
        if (!frames) {
            take.finalized = file.peek() == std::char_traits<char>::eof() && !file.bad();
            break;
        }
        for (unsigned i = 0; i < frames; ++i) {
            const auto bits = static_cast<std::uint16_t>(static_cast<unsigned char>(pcm[i * 2]) |
                                                        (static_cast<unsigned char>(pcm[i * 2 + 1]) << 8));
            const auto sample = std::bit_cast<std::int16_t>(bits);
            take.stereo.push_back(sample);
            take.stereo.push_back(sample);
        }
    }
    return take;
}
}
