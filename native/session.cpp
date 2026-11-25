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

Project afterHoursProject() {
    Project project;
    project.name = "After Hours";
    project.tempo = static_cast<unsigned>(demoTempo);
    project.bars = demoBars;
    constexpr std::array names{"Electric Keys", "Sub Bass", "Drum Machine", "Glass Plucks"};
    for (unsigned index = 0; index < names.size(); ++index) {
        project.tracks.push_back({index + 1, names[index], static_cast<Instrument>(index), false, 100, {}, {}});
    }
    for (const auto& note : afterHours()) {
        project.tracks[note.track].notes.push_back({
            static_cast<std::uint32_t>(std::lround(note.startBeat * ticksPerBeat)),
            static_cast<std::uint32_t>(std::lround(note.lengthBeats * ticksPerBeat)),
            static_cast<std::uint8_t>(note.pitch),
            static_cast<std::uint8_t>(std::lround(note.velocity * 127))
        });
    }
    return project;
}

TrackMutes trackMutes(const Project& project) {
    TrackMutes muted{};
    const bool soloed = std::ranges::any_of(project.tracks, &Track::solo);
    for (std::size_t index = 0; index < project.tracks.size(); ++index) {
        const auto& track = project.tracks[index];
        muted[index] = track.muted || (soloed && !track.solo);
    }
    return muted;
}

SessionAudio::SessionAudio(const Project& project) : masterGain(project.masterVolume / 100.) {
    validateProject(project);
    constexpr double tau = 2 * std::numbers::pi;
    constexpr double voiceBalance[][2] = {{.85, .65}, {.8, .8}, {.8, .8}, {.55, .85}, {1, 1}};
    sampleCount = static_cast<std::size_t>(sessionFrames(project)) * channelCount;
    tracks.resize(project.tracks.size());
    for (std::size_t index = 0; index < tracks.size(); ++index) {
        const auto& track = project.tracks[index];
        auto& samples = tracks[index];
        samples.resize(sampleCount);
        const double volume = track.volume / 100.;
        const std::array balance{(100 - std::max(track.pan, 0)) / 100.,
                                 (100 + std::min(track.pan, 0)) / 100.};
        for (const auto& clip : track.clips) {
            const auto& audio = findAsset(project, clip.assetId).stereo();
            const auto start = static_cast<std::size_t>(frameAtTick(clip.tick, project.tempo)) * channelCount;
            const auto source = static_cast<std::size_t>(clip.sourceFrame) * channelCount;
            const auto count = static_cast<std::size_t>(clip.frameCount) * channelCount;
            for (std::size_t sample = 0; sample < count; ++sample) {
                samples[start + sample] += static_cast<float>(audio[source + sample] * (volume / 32768.) * balance[sample % channelCount]);
            }
        }
        for (const auto& note : track.notes) {
            const auto start = frameAtTick(note.tick, project.tempo);
            const auto length = frameAtTick(note.tick + note.length, project.tempo) - start;
            const double frequency = 440 * std::exp2((note.pitch - 69) / 12.0);
            const double level = .14 * note.velocity / 127 * volume;
            std::uint32_t noiseState = 0x8c31274u + start;
            for (std::uint32_t frame = 0; frame < length; ++frame) {
                const double time = static_cast<double>(frame) / sampleRate;
                const double phase = tau * frequency * time;
                const double envelope = std::min({1.0, time * 350, (length - frame - 1) / 500.0});
                double voice = std::sin(phase);
                if (track.instrument == Instrument::drums) {
                    noiseState = noiseState * 1664525u + 1013904223u;
                    const double noise = (noiseState >> 8) / 8388608.0 - 1.0;
                    voice = note.pitch == 36
                        ? std::sin(tau * (52 * time + 2 * (1 - std::exp(-55 * time)))) * std::exp(-17 * time)
                        : noise * std::exp(-(note.pitch == 38 ? 29 : 65) * time);
                } else if (track.instrument == Instrument::pluck) {
                    voice = (.8 * voice + .2 * std::sin(phase * 2)) * std::exp(-12 * time);
                }
                for (unsigned channel = 0; channel < channelCount; ++channel) {
                    samples[(start + frame) * channelCount + channel] +=
                        static_cast<float>(level * voice * envelope * voiceBalance[static_cast<unsigned>(track.instrument)][channel] * balance[channel]);
                }
            }
        }
    }
}

Samples SessionAudio::render(const TrackMutes& muted) const {
    Samples samples(sampleCount);
    PlaybackMixer(*this, muted).read(samples, muted);
    return samples;
}

static_assert(std::atomic<std::uint32_t>::is_always_lock_free);

PlaybackMixer::PlaybackMixer(const SessionAudio& audio, const TrackMutes& initialMutes, std::size_t startFrame,
                             std::atomic<std::uint32_t>* peakMeter)
    : audio(audio), position(std::min(startFrame, audio.sampleCount / channelCount) * channelCount), peakMeter(peakMeter) {
    for (std::size_t track = 0; track < gains.size(); ++track) {
        gains[track] = initialMutes[track] ? 0 : muteRampFrames;
    }
}

std::size_t PlaybackMixer::read(std::span<std::int16_t> output, const TrackMutes& muted) noexcept {
    const auto count = std::min(output.size() / channelCount * channelCount,
                                audio.sampleCount - position);
    std::array<unsigned, channelCount> peaks{};
    for (std::size_t offset = 0; offset < count; offset += channelCount) {
        double frame[channelCount]{};
        for (std::size_t track = 0; track < audio.tracks.size(); ++track) {
            const double gain = static_cast<double>(gains[track]) / muteRampFrames;
            for (unsigned channel = 0; channel < channelCount; ++channel) {
                frame[channel] += audio.tracks[track][position + offset + channel] * gain;
            }
            if (muted[track] && gains[track] > 0) --gains[track];
            if (!muted[track] && gains[track] < muteRampFrames) ++gains[track];
        }
        for (unsigned channel = 0; channel < channelCount; ++channel) {
            const auto sample = std::lround(std::clamp(frame[channel] * audio.masterGain, -1., 1.) * 32767);
            output[offset + channel] = static_cast<std::int16_t>(sample);
            if (peakMeter) peaks[channel] = std::max(peaks[channel], static_cast<unsigned>(std::abs(sample)));
        }
    }
    if (peakMeter) peakMeter->store(peaks[0] | (peaks[1] << 16), std::memory_order_relaxed);
    position += count;
    return count;
}

bool PlaybackMixer::finished() const noexcept {
    return position == audio.sampleCount;
}

unsigned PlaybackMixer::remainingFrames() const noexcept {
    return static_cast<unsigned>((audio.sampleCount - position) / channelCount);
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
