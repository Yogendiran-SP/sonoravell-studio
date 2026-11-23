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

void benchmark(const DemoAudio& demo) {
    using Clock = std::chrono::steady_clock;
    using Microseconds = std::chrono::duration<double, std::micro>;
    constexpr std::array blockSizes{32u, 64u, 128u};
    std::array<std::int16_t, blockSizes.back() * channelCount> samples{};
    std::cout << "Native mixer only. Times exclude device I/O and track preparation.\n";
    std::cout << "Frames   p95 mix (us)   max mix (us)   buffer duration (us)\n";
    for (unsigned frames : blockSizes) {
        PlaybackMixer mixer(demo, {});
        std::vector<double> durations;
        auto output = std::span(samples).first(frames * channelCount);
        while (!mixer.finished()) {
            const auto start = Clock::now();
            mixer.read(output, {});
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

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "Usage: sonoravell-render <output.wav | --benchmark>\n";
        return 2;
    }
    try {
        const DemoAudio demo;
        if (std::string_view(argv[1]) == "--benchmark") {
            benchmark(demo);
        } else {
            std::ofstream file(argv[1], std::ios::binary);
            if (!file) throw std::runtime_error("Could not open WAV output");
            writeWave(file, demo.render({}));
            file.close();
            if (!file) throw std::runtime_error("Could not finish WAV output");
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
