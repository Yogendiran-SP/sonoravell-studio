#include "session.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {
using namespace sonoravell;

Project largeSession() {
    Project project;
    project.name = "Offline Alpha load fixture";
    project.tempo = 180;
    project.bars = 32;
    project.assets.emplace_back(1, "Repeated PCM", Samples(2 * sampleRate, 3400));
    for (unsigned i = 0; i < maxTracks; ++i) {
        auto& track = project.tracks.emplace_back(Track{
            i + 1, "Track " + std::to_string(i + 1), i % 2 ? Instrument::keys : Instrument::audio, false, 85, {}, {}
        });
        for (unsigned bar = 0; bar < project.bars; bar += 2) {
            const auto tick = bar * ticksPerBeat * beatsPerBar;
            if (i % 2) track.notes.push_back({tick, ticksPerBeat * 2, static_cast<std::uint8_t>(42 + i), 92});
            else track.clips.push_back({bar + 1 + i * maxBars, 1, tick, 0, sampleRate});
        }
        if (i < 8) editInserts(track.inserts, {InsertAction::add, 0, i % 2 ? InsertKind::eq : InsertKind::compressor});
    }
    for (unsigned i = 0; i < 4; ++i) {
        const auto id = editInserts(project.masterInserts, {InsertAction::add, 0, InsertKind::delay});
        editInserts(project.masterInserts, {InsertAction::parameter, id, InsertKind::delay, 0, 2000});
    }
    return project;
}

void benchmark(const Project& project, bool compareDense) {
    using Clock = std::chrono::steady_clock;
    using Microseconds = std::chrono::duration<double, std::micro>;
    constexpr std::array blockSizes{32u, 64u, 128u, 256u};
    std::array<std::int16_t, blockSizes.back() * channelCount> samples{};
    std::cout << "Software benchmark. Times exclude device I/O.\n";
    std::cout << project.name << " / " << project.tracks.size() << " tracks / " << sessionFrames(project) << " frames\n";
    unsigned insertCount = 0, delayMs = 0;
    const auto measure = [&](const InsertList& list) {
        for (const auto& effect : list) {
            if (!effect.enabled) continue;
            ++insertCount;
            if (effect.kind == InsertKind::delay) delayMs += effect.values[0];
        }
    };
    measure(project.masterInserts);
    for (const auto& track : project.tracks) measure(track.inserts);
    std::cout << insertCount << " active inserts / "
              << static_cast<std::uint64_t>(delayMs) * (sampleRate / 1000) * channelCount * sizeof(double)
              << " configured delay payload bytes\n";
    for (const auto storage : {SourceStorage::sparseBlocks, SourceStorage::denseReference}) {
        if (storage == SourceStorage::denseReference && !compareDense) continue;
        const auto prepareStart = Clock::now();
        const SessionAudio demo(project, storage);
        const auto prep = Microseconds(Clock::now() - prepareStart);
        std::cout << (storage == SourceStorage::sparseBlocks ? "Sparse blocks" : "Dense reference")
                  << ": " << demo.preparedBytes() << " prepared bytes, " << prep.count() << " us to prepare\n";
        std::cout << "Frames   p95 mix (us)   max mix (us)   buffer duration (us)\n";
        for (unsigned frames : blockSizes) {
            const auto rackStart = Clock::now();
            auto rack = prepareInserts(project);
            const auto rackTime = Microseconds(Clock::now() - rackStart).count();
            PlaybackMixer mixer(demo, mixerParameters(project));
            mixer.attachInserts(rack.get());
            std::vector<double> durations;
            auto output = std::span(samples).first(frames * channelCount);
            while (!mixer.finished()) {
                const auto start = Clock::now();
                mixer.read(output);
                const auto elapsed = Clock::now() - start;
                durations.push_back(Microseconds(elapsed).count());
            }
            std::ranges::sort(durations);
            const auto percentile = (95 * durations.size() + 99) / 100 - 1;
            std::cout << frames << '\t' << durations[percentile] << '\t' << durations.back() << '\t'
                      << 1'000'000.0 * frames / sampleRate << " us buffer / " << rackTime << " us rack prep\n";
        }
    }
}
}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3 || (argc == 3 && std::string_view(argv[1]).starts_with("--"))) {
        std::cerr << "Usage: sonoravell-render [session.sonora] <output.wav | --benchmark> or --benchmark-alpha\n";
        return 2;
    }
    try {
        const auto option = std::string_view(argv[argc - 1]);
        if (argc == 2 && option == "--benchmark-alpha") {
            benchmark(largeSession(), false);
            return 0;
        }
        const auto project = argc == 3 ? openProject(argv[1]) : afterHoursProject();
        if (option == "--benchmark") {
            benchmark(project, true);
        } else {
            const SessionAudio audio(project);
            std::ofstream file(argv[argc - 1], std::ios::binary);
            if (!file) throw std::runtime_error("Could not open WAV output");
            writeWave(file, audio.renderProject(project));
            file.close();
            if (!file) throw std::runtime_error("Could not finish WAV output");
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
