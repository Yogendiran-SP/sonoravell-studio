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

void benchmark(const Project& project) {
    using Clock = std::chrono::steady_clock;
    using Microseconds = std::chrono::duration<double, std::micro>;
    constexpr std::array blockSizes{32u, 64u, 128u};
    std::array<std::int16_t, blockSizes.back() * channelCount> samples{};
    std::cout << "Software benchmark. Times exclude device I/O.\n";
    for (const auto storage : {SourceStorage::sparseBlocks, SourceStorage::denseReference}) {
        const auto prepareStart = Clock::now();
        const SessionAudio demo(project, storage);
        const auto prep = Microseconds(Clock::now() - prepareStart);
        std::cout << (storage == SourceStorage::sparseBlocks ? "Sparse blocks" : "Dense reference")
                  << ": " << demo.preparedBytes() << " prepared bytes, " << prep.count() << " us to prepare\n";
        std::cout << "Frames   p95 mix (us)   max mix (us)   buffer duration (us)\n";
        for (unsigned frames : blockSizes) {
            PlaybackMixer mixer(demo, mixerParameters(project));
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
                      << 1'000'000.0 * frames / sampleRate << '\n';
        }
    }
}
}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3 || (argc == 3 && std::string_view(argv[1]) == "--benchmark")) {
        std::cerr << "Usage: sonoravell-render [session.sonora] <output.wav | --benchmark>\n";
        return 2;
    }
    try {
        const auto project = argc == 3 ? openProject(argv[1]) : afterHoursProject();
        if (std::string_view(argv[1]) == "--benchmark") {
            benchmark(project);
        } else {
            const SessionAudio audio(project);
            std::ofstream file(argv[argc - 1], std::ios::binary);
            if (!file) throw std::runtime_error("Could not open WAV output");
            writeWave(file, audio.render(mixerParameters(project)));
            file.close();
            if (!file) throw std::runtime_error("Could not finish WAV output");
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
