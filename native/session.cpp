#include "session.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <ostream>
#include <stdexcept>
#include <utility>

namespace sonoravell {
std::vector<Note> afterHours() {
    constexpr int chords[][4] = {{57, 60, 64, 67}, {53, 57, 60, 64}, {60, 64, 67, 71}, {55, 59, 62, 65}};
    constexpr std::pair<double, unsigned> bass[] = {{0, 0}, {.75, 0}, {1.5, 0}, {2.5, 2}, {3.25, 0}};
    constexpr std::pair<double, unsigned> lead[] = {{.5, 2}, {1.25, 3}, {2.25, 1}, {3, 2}};
    std::vector<Note> notes;
    for (unsigned bar = 0; bar < demoBars; ++bar) {
        const auto& chord = chords[bar % 4];
        const auto add = [&](unsigned track, int pitch, double start, double length, double velocity) {
            notes.push_back({track, pitch, 4.0 * bar + start, length, velocity});
        };
        for (int pitch : chord) {
            add(0, pitch, 0, 1.8, .59);
            add(0, pitch, 2.5, 1.25, .48);
        }
        for (auto [start, tone] : bass) add(1, chord[tone] - 12, start, .36, .72);
        for (double start : {0.0, 1.5, 2.0, 3.25}) add(2, 36, start, .3, .86);
        for (double start : {1.0, 3.0}) add(2, 38, start, .19, .68);
        for (int step = 0; step < 8; ++step) add(2, step == 7 ? 46 : 42, step * .5, .12, step % 2 ? .33 : .46);
        if (bar >= 2) {
            for (auto [start, tone] : lead) add(3, chord[tone] + 12, start, .29, .59);
        }
    }
    return notes;
}

DemoAudio::DemoAudio() {
    constexpr double framesPerBeat = 60 * sampleRate / demoTempo;
    constexpr double tau = 2 * std::numbers::pi;
    constexpr double pan[][2] = {{.85, .65}, {.8, .8}, {.8, .8}, {.55, .85}};
    const auto sampleCount = std::lround(demoBars * 4 * framesPerBeat) * channelCount;
    for (auto& track : tracks) track.resize(sampleCount);
    for (const Note& note : afterHours()) {
        auto& track = tracks[note.track];
        const auto start = std::lround(note.startBeat * framesPerBeat);
        const auto length = std::lround(note.lengthBeats * framesPerBeat);
        const double frequency = 440 * std::exp2((note.pitch - 69) / 12.0);
        std::uint32_t noiseState = 0x8c31274u + static_cast<std::uint32_t>(start);
        for (long frame = 0; frame < length; ++frame) {
            const double time = static_cast<double>(frame) / sampleRate;
            const double phase = tau * frequency * time;
            const double envelope = std::min({1.0, time * 350, (length - frame - 1) / 500.0});
            double voice = std::sin(phase);
            if (note.track == 2) {
                noiseState = noiseState * 1664525u + 1013904223u;
                const double noise = (noiseState >> 8) / 8388608.0 - 1.0;
                voice = note.pitch == 36
                    ? std::sin(tau * (52 * time + 2 * (1 - std::exp(-55 * time)))) * std::exp(-17 * time)
                    : noise * std::exp(-(note.pitch == 38 ? 29 : 65) * time);
            } else if (note.track == 3) {
                voice = (.8 * voice + .2 * std::sin(phase * 2)) * std::exp(-12 * time);
            }
            for (unsigned channel = 0; channel < channelCount; ++channel) {
                track[(start + frame) * channelCount + channel] +=
                    static_cast<float>(.14 * voice * note.velocity * envelope * pan[note.track][channel]);
            }
        }
    }
}

Samples DemoAudio::render(const TrackMutes& muted) const {
    Samples samples(tracks.front().size());
    PlaybackMixer(*this, muted).read(samples, muted);
    return samples;
}

PlaybackMixer::PlaybackMixer(const DemoAudio& audio, const TrackMutes& initialMutes) : audio(audio) {
    for (std::size_t track = 0; track < gains.size(); ++track) {
        gains[track] = initialMutes[track] ? 0 : muteRampFrames;
    }
}

std::size_t PlaybackMixer::read(std::span<std::int16_t> output, const TrackMutes& muted) noexcept {
    const auto count = std::min(output.size() / channelCount * channelCount,
                                audio.tracks.front().size() - position);
    for (std::size_t offset = 0; offset < count; offset += channelCount) {
        double frame[channelCount]{};
        for (std::size_t track = 0; track < gains.size(); ++track) {
            const double gain = static_cast<double>(gains[track]) / muteRampFrames;
            for (unsigned channel = 0; channel < channelCount; ++channel) {
                frame[channel] += audio.tracks[track][position + offset + channel] * gain;
            }
            if (muted[track] && gains[track] > 0) --gains[track];
            if (!muted[track] && gains[track] < muteRampFrames) ++gains[track];
        }
        for (unsigned channel = 0; channel < channelCount; ++channel) {
            output[offset + channel] = static_cast<std::int16_t>(
                std::lround(std::clamp(frame[channel], -1., 1.) * 32767));
        }
    }
    position += count;
    return count;
}

bool PlaybackMixer::finished() const noexcept {
    return position == audio.tracks.front().size();
}

void writeWave(std::ostream& output, const Samples& samples) {
    if (samples.size() > (UINT32_MAX - 36) / 2 || samples.size() % channelCount != 0) {
        throw std::invalid_argument("Invalid stereo PCM size");
    }
    const auto little = [&](std::uint32_t value, unsigned bytes) {
        for (unsigned i = 0; i < bytes; ++i) output.put(static_cast<char>(value >> (8 * i)));
    };
    const auto dataSize = static_cast<std::uint32_t>(samples.size() * 2);
    output.write("RIFF", 4);
    little(36 + dataSize, 4);
    output.write("WAVEfmt ", 8);
    little(16, 4);
    little(1, 2);
    little(channelCount, 2);
    little(sampleRate, 4);
    little(sampleRate * channelCount * 2, 4);
    little(channelCount * 2, 2);
    little(16, 2);
    output.write("data", 4);
    little(dataSize, 4);
    for (auto sample : samples) little(static_cast<std::uint16_t>(sample), 2);
    if (!output) throw std::runtime_error("Could not write WAV file");
}
}
