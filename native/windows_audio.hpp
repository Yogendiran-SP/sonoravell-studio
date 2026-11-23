#pragma once

#include "session.hpp"

#include <windows.h>
#include <mmsystem.h>

#include <algorithm>
#include <atomic>
#include <stdexcept>
#include <stop_token>
#include <thread>
#include <utility>

namespace sonoravell {
class WaveStream {
    static constexpr std::size_t framesPerBuffer = sampleRate / 50;
    struct Buffer {
        std::array<std::int16_t, framesPerBuffer * channelCount> samples{};
        WAVEHDR header{};
    };
    std::array<Buffer, 2> buffers;
    HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HWAVEOUT device = nullptr;

public:
    ~WaveStream() {
        if (device) {
            waveOutReset(device);
            for (auto& buffer : buffers) {
                if (buffer.header.dwFlags & WHDR_PREPARED) {
                    waveOutUnprepareHeader(device, &buffer.header, sizeof(buffer.header));
                }
            }
            waveOutClose(device);
        }
        if (ready) CloseHandle(ready);
    }

    bool run(PlaybackMixer& mixer, const std::atomic<unsigned>& muteMask,
             std::atomic<unsigned>& played, unsigned deviceId, std::stop_token stop) {
        if (!ready) return false;
        std::stop_callback wakeOnStop(stop, [this] { SetEvent(ready); });
        if (stop.stop_requested()) return true;
        WAVEFORMATEX format{WAVE_FORMAT_PCM, channelCount, sampleRate, sampleRate * channelCount * 2,
                            channelCount * 2, 16, 0};
        if (waveOutOpen(&device, deviceId, &format, reinterpret_cast<DWORD_PTR>(ready), 0,
                        CALLBACK_EVENT) != MMSYSERR_NOERROR) {
            device = nullptr;
            return false;
        }
        if (waveOutPause(device) != MMSYSERR_NOERROR) return false;
        std::size_t pending = 0;
        for (auto& buffer : buffers) {
            if (mixer.finished()) break;
            buffer.header.lpData = reinterpret_cast<LPSTR>(buffer.samples.data());
            buffer.header.dwBufferLength = static_cast<DWORD>(sizeof(buffer.samples));
            if (waveOutPrepareHeader(device, &buffer.header, sizeof(buffer.header)) != MMSYSERR_NOERROR ||
                !queue(buffer, mixer, muteMask)) return false;
            ++pending;
        }
        if (!pending || stop.stop_requested()) return true;
        if (waveOutRestart(device) != MMSYSERR_NOERROR) return false;

        std::size_t oldest = 0;
        while (pending && !stop.stop_requested()) {
            auto& buffer = buffers[oldest];
            if (!(buffer.header.dwFlags & WHDR_DONE)) {
                if (WaitForSingleObject(ready, INFINITE) != WAIT_OBJECT_0) return false;
                continue;
            }
            MMTIME elapsed{};
            elapsed.wType = TIME_SAMPLES;
            if (waveOutGetPosition(device, &elapsed, sizeof(elapsed)) == MMSYSERR_NOERROR) {
                if (elapsed.wType == TIME_SAMPLES) played.store(elapsed.u.sample);
                if (elapsed.wType == TIME_BYTES) played.store(elapsed.u.cb / (2 * channelCount));
                if (elapsed.wType == TIME_MS) played.store(elapsed.u.ms * (sampleRate / 1000));
            }
            // Recycle in playback order even when several buffers completed before we woke.
            oldest = (oldest + 1) % buffers.size();
            --pending;
            if (!mixer.finished()) {
                if (!queue(buffer, mixer, muteMask)) return false;
                ++pending;
            }
        }
        return true;
    }

    static TrackMutes decodeMutes(unsigned mask) {
        TrackMutes muted{};
        for (std::size_t track = 0; track < muted.size(); ++track) {
            muted[track] = (mask & (1u << track)) != 0;
        }
        return muted;
    }

private:
    bool queue(Buffer& buffer, PlaybackMixer& mixer, const std::atomic<unsigned>& muteMask) {
        const auto count = mixer.read(buffer.samples, decodeMutes(muteMask.load()));
        buffer.header.dwBufferLength = static_cast<DWORD>(count * sizeof(buffer.samples.front()));
        return waveOutWrite(device, &buffer.header, sizeof(buffer.header)) == MMSYSERR_NOERROR;
    }
};

class Output {
public:
    enum class State { stopped, playing, completed, failed };

    State state() const { return playbackState.load(); }
    unsigned framesPlayed() const { return played.load(); }

    void stop() {
        if (worker.joinable()) {
            worker.request_stop();
            worker.join();
        }
        playbackState.store(State::stopped);
    }

    void setMutes(const TrackMutes& muted) {
        unsigned mask = 0;
        for (std::size_t track = 0; track < muted.size(); ++track) {
            if (muted[track]) mask |= 1u << track;
        }
        muteMask.store(mask);
    }

    void play(const SessionAudio& session, unsigned startFrame, unsigned deviceId) {
        stop();
        played.store(0);
        playbackState.store(State::playing);
        try {
            worker = std::jthread([this, &session, startFrame, deviceId](std::stop_token stopToken) {
                PlaybackMixer mixer(session, WaveStream::decodeMutes(muteMask.load()), startFrame);
                bool ok;
                {
                    WaveStream stream;
                    ok = stream.run(mixer, muteMask, played, deviceId, stopToken);
                }
                playbackState.store(ok ? State::completed : State::failed);
            });
        } catch (...) {
            playbackState.store(State::stopped);
            throw;
        }
    }

private:
    std::atomic<unsigned> muteMask{0};
    std::atomic<unsigned> played{0};
    std::atomic<State> playbackState{State::stopped};
    std::jthread worker;
};

}
