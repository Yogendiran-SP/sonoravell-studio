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

MixerParameters mixerParameters(const Project& project) noexcept {
    MixerParameters parameters;
    parameters.master = project.masterVolume / 100.;
    const bool soloed = std::ranges::any_of(project.tracks, &Track::solo);
    for (std::size_t index = 0; index < std::min(project.tracks.size(), parameters.tracks.size()); ++index) {
        const auto& track = project.tracks[index];
        const double volume = track.muted || (soloed && !track.solo) ? 0. : track.volume / 100.;
        parameters.tracks[index] = {volume * (100 - std::max(track.pan, 0)) / 100.,
                                    volume * (100 + std::min(track.pan, 0)) / 100.};
    }
    return parameters;
}

SessionAudio::SessionAudio(const Project& project, SourceStorage storage) {
    validateProject(project);
    constexpr double tau = 2 * std::numbers::pi;
    constexpr double voiceBalance[][2] = {{.85, .65}, {.8, .8}, {.8, .8}, {.55, .85}, {1, 1}};
    sampleCount = static_cast<std::size_t>(sessionFrames(project)) * channelCount;
    metronome.emplace(project.tempo, static_cast<unsigned>(sampleCount / channelCount));
    tracks.reserve(project.tracks.size());
    for (const auto& track : project.tracks) {
        auto& samples = tracks.emplace_back(sampleCount, storage);
        for (const auto& clip : track.clips) {
            const auto& audio = findAsset(project, clip.assetId).stereo();
            const auto start = static_cast<std::size_t>(frameAtTick(clip.tick, project.tempo)) * channelCount;
            const auto source = static_cast<std::size_t>(clip.sourceFrame) * channelCount;
            const auto count = static_cast<std::size_t>(clip.frameCount) * channelCount;
            for (std::size_t sample = 0; sample < count; ++sample) {
                samples.add(start + sample, static_cast<float>(audio[source + sample] / 32768.));
            }
        }
        for (const auto& note : track.notes) {
            const auto start = frameAtTick(note.tick, project.tempo);
            const auto length = frameAtTick(note.tick + note.length, project.tempo) - start;
            const double frequency = 440 * std::exp2((note.pitch - 69) / 12.0);
            const double level = .14 * note.velocity / 127;
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
                    samples.add((start + frame) * channelCount + channel,
                        static_cast<float>(level * voice * envelope * voiceBalance[static_cast<unsigned>(track.instrument)][channel]));
                }
            }
        }
    }
}

Samples SessionAudio::render(const MixerParameters& parameters, AudioBlockProcessor* effects) const {
    Samples samples(sampleCount);
    PlaybackMixer(*this, parameters, 0, nullptr, nullptr, false, effects).read(samples);
    return samples;
}

std::size_t SessionAudio::preparedBytes() const noexcept {
    std::size_t bytes = tracks.capacity() * sizeof(PreparedTrack) + metronome->scheduledBytes();
    for (const auto& track : tracks) bytes += track.preparedBytes();
    return bytes;
}

static_assert(std::atomic<std::uint32_t>::is_always_lock_free);

void PlaybackMixer::Ramp::set(double next) noexcept {
    if (next == target) return;
    target = next;
    remaining = rampFrames;
    step = (target - value) / remaining;
}

double PlaybackMixer::Ramp::next() noexcept {
    const auto previous = value;
    if (remaining) value = --remaining ? value + step : target;
    return previous;
}

PlaybackMixer::PlaybackMixer(const SessionAudio& audio, const MixerParameters& initial, std::size_t startFrame,
                             std::atomic<std::uint32_t>* peakMeter, MixerParameterMailbox* mailbox, bool loop,
                             AudioBlockProcessor* effects, bool click)
    : audio(audio), position(std::min(startFrame, audio.sampleCount / channelCount) * channelCount),
      peakMeter(peakMeter), mailbox(mailbox), loop(loop && audio.sampleCount != 0), effects(effects), click(click),
      master{initial.master, initial.master} {
    if (this->loop && position == audio.sampleCount) position = 0;
    for (std::size_t track = 0; track < audio.tracks.size(); ++track) {
        const auto gain = initial.tracks[track];
        gains[track] = {Ramp{gain.left, gain.left}, Ramp{gain.right, gain.right}};
    }
}

void PlaybackMixer::setParameters(const MixerParameters& parameters) noexcept {
    for (std::size_t track = 0; track < audio.tracks.size(); ++track) {
        gains[track][0].set(parameters.tracks[track].left);
        gains[track][1].set(parameters.tracks[track].right);
    }
    master.set(parameters.master);
}

std::size_t PlaybackMixer::read(std::span<std::int16_t> output) noexcept {
    if (mailbox) setParameters(mailbox->readLatest());
    const auto capacity = output.size() / channelCount * channelCount;
    const auto count = loop ? capacity : std::min(capacity, audio.sampleCount - position);
    std::array<unsigned, channelCount> peaks{};
    for (std::size_t offset = 0; offset < count;) {
        const auto index = position / sourceBlockSamples;
        const auto first = position % sourceBlockSamples;
        const auto blockSamples = std::min({count - offset, sourceBlockSamples - first, audio.sampleCount - position});
        mixBlock(output.subspan(offset, blockSamples), index, first, peaks);
        offset += blockSamples;
        position += blockSamples;
        if (loop && position == audio.sampleCount) position = 0;
    }
    if (peakMeter) peakMeter->store(peaks[0] | (peaks[1] << 16), std::memory_order_relaxed);
    return count;
}

void PlaybackMixer::mixBlock(std::span<std::int16_t> output, std::size_t index, std::size_t first,
                             std::array<unsigned, channelCount>& peaks) noexcept {
    std::array<const float*, maxTracks> sources{};
    for (std::size_t track = 0; track < audio.tracks.size(); ++track) {
        sources[track] = audio.tracks[track].block(index);
    }
    std::array<double, sourceBlockSamples> scratch;
    for (std::size_t offset = 0; offset < output.size(); offset += channelCount) {
        double frame[channelCount]{};
        for (std::size_t track = 0; track < audio.tracks.size(); ++track) {
            for (unsigned channel = 0; channel < channelCount; ++channel) {
                const auto gain = gains[track][channel].next();
                if (sources[track]) frame[channel] += sources[track][first + offset + channel] * gain;
            }
        }
        for (unsigned channel = 0; channel < channelCount; ++channel) scratch[offset + channel] = frame[channel];
    }
    auto prepared = std::span(scratch).first(output.size());
    if (effects) effects->process(prepared);
    if (click) audio.metronome->add(prepared, static_cast<unsigned>((index * sourceBlockSamples + first) / channelCount));
    for (std::size_t offset = 0; offset < output.size(); offset += channelCount) {
        const auto masterGain = master.next();
        for (unsigned channel = 0; channel < channelCount; ++channel) {
            const auto sample = std::lround(std::clamp(scratch[offset + channel] * masterGain, -1., 1.) * 32767);
            output[offset + channel] = static_cast<std::int16_t>(sample);
            if (peakMeter) peaks[channel] = std::max(peaks[channel], static_cast<unsigned>(std::abs(sample)));
        }
    }
}

bool PlaybackMixer::finished() const noexcept {
    return !loop && position == audio.sampleCount;
}

unsigned PlaybackMixer::remainingFrames() const noexcept {
    return static_cast<unsigned>((audio.sampleCount - (loop ? 0 : position)) / channelCount);
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
