#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>

#include "take_queue.hpp"
#include "windows_capture.hpp"

#include <chrono>
#include <fstream>
#include <random>
#include <stdexcept>
#include <thread>

namespace sonoravell {
namespace {
class Event {
public:
    explicit Event(bool manualReset = false) : handle(CreateEventW(nullptr, manualReset, FALSE, nullptr)) {
        if (!handle) throw std::runtime_error("Could not create the audio recording events.");
    }
    ~Event() { CloseHandle(handle); }
    Event(const Event&) = delete;
    Event& operator=(const Event&) = delete;
    HANDLE get() const { return handle; }
    void signal() const { SetEvent(handle); }

private:
    HANDLE handle;
};

class InputDevice {
public:
    void open(unsigned deviceId) {
        WAVEFORMATEX format{WAVE_FORMAT_PCM, 1, sampleRate, sampleRate * 2, 2, 16, 0};
        if (waveInOpen(&handle, deviceId, &format, reinterpret_cast<DWORD_PTR>(ready.get()), 0,
                       CALLBACK_EVENT) != MMSYSERR_NOERROR) {
            handle = nullptr;
            throw std::runtime_error("Could not open the selected Windows input at 48 kHz mono.");
        }
        for (auto& block : blocks) {
            block.header.lpData = reinterpret_cast<LPSTR>(block.samples.data());
            block.header.dwBufferLength = sizeof(block.samples);
            if (waveInPrepareHeader(handle, &block.header, sizeof(block.header)) != MMSYSERR_NOERROR) {
                throw std::runtime_error("Windows could not prepare the recording buffers.");
            }
        }
    }

    bool queue(unsigned frames) noexcept {
        auto& header = blocks[(oldest + pending) % blocks.size()].header;
        header.dwBufferLength = frames * sizeof(std::int16_t);
        header.dwBytesRecorded = 0;
        if (waveInAddBuffer(handle, &header, sizeof(header)) != MMSYSERR_NOERROR) return false;
        ++pending;
        return true;
    }

    bool readyToRead() const noexcept { return pending && (blocks[oldest].header.dwFlags & WHDR_DONE); }

    bool drained() const noexcept {
        for (unsigned offset = 0; offset < pending; ++offset) {
            if (!(blocks[(oldest + offset) % blocks.size()].header.dwFlags & WHDR_DONE)) return false;
        }
        return true;
    }

    std::span<const std::int16_t> pop() noexcept {
        const auto& block = blocks[oldest];
        --pending;
        oldest = (oldest + 1) % blocks.size();
        return std::span(block.samples).first(std::min<std::size_t>(
            block.header.dwBytesRecorded / sizeof(std::int16_t), block.samples.size()));
    }

    bool reset() const noexcept { return !handle || waveInReset(handle) == MMSYSERR_NOERROR; }

    bool close() noexcept {
        if (!handle) return true;
        for (auto& block : blocks) {
            auto& header = block.header;
            if ((header.dwFlags & WHDR_PREPARED) &&
                waveInUnprepareHeader(handle, &header, sizeof(header)) != MMSYSERR_NOERROR) return false;
        }
        if (waveInClose(handle) != MMSYSERR_NOERROR) return false;
        handle = nullptr;
        return true;
    }

    static constexpr unsigned bufferCount = 12;
    Event ready;
    HWAVEIN handle = nullptr;
    unsigned pending = 0;

private:
    struct Buffer {
        std::array<std::int16_t, captureBlockFrames> samples;
        WAVEHDR header;
    };
    std::array<Buffer, bufferCount> blocks{};
    std::size_t oldest = 0;
};

std::string utf8(const std::wstring& source) {
    if (source.empty()) return {};
    const auto length = static_cast<int>(source.size());
    const auto count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, source.data(), length, nullptr, 0, nullptr, nullptr);
    if (!count) return {};
    std::string encoded(count, '\0');
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, source.data(), length, encoded.data(), count, nullptr, nullptr)) return {};
    return encoded;
}

bool saveCaptureDiagnostics(const std::filesystem::path& journal, const WasapiInputReport& report,
                            bool storageFailed, std::size_t verifiedFrames) noexcept {
    try {
        auto path = journal;
        path += L".capture.txt";
        std::ofstream output(path);
        if (!output) return false;
        const auto& stream = report.stream;
        const auto& clock = stream.timing.clock;
        const auto rejected = clock.rejected();
        output << "WASAPI shared capture\n"
               << "Requested input: " << (report.requested ? utf8(report.requested->name) : "Windows default") << '\n'
               << "Requested endpoint ID: " << (report.requested ? utf8(report.requested->id) : "Default") << '\n'
               << "Resolved input: " << utf8(report.resolved.name) << '\n'
               << "Resolved endpoint ID: " << utf8(report.resolved.id) << '\n'
               << "Outcome: " << (storageFailed || stream.end == CaptureEnd::interrupted ? "Interrupted" :
                                   stream.end == CaptureEnd::stopped ? "User Stop" : "Session frame limit") << '\n'
               << "Stage: " << captureStageText(stream.stage) << '\n'
               << "Stream error: " << captureErrorText(stream.error) << '\n'
               << "Storage failed: " << (storageFailed ? "Yes" : "No") << '\n'
               << "Native status: 0x" << std::hex << stream.nativeError << std::dec << '\n'
               << "Mix rate and channels: " << stream.rate << ' ' << stream.channels << '\n'
               << "Requested period frames (0 = system): " << stream.requestedPeriodFrames << '\n'
               << "Selected custom period frames: " << stream.selectedPeriodFrames << '\n'
               << "Allocated buffer frames: " << stream.bufferFrames << '\n'
               << "Queued frames: " << stream.acceptedFrames << '\n'
               << "Verified journal frames: " << verifiedFrames << '\n'
               << "Genuine silent frames: " << stream.silentFrames << '\n'
               << "First packet flagged at frame zero: " << (stream.initialDiscontinuityFlag ? "Yes" : "No") << '\n'
               << "Missing / stale / nonmonotonic timestamps: " << rejected.missing << ' '
               << rejected.stale << ' ' << rejected.nonmonotonic << '\n'
               << "Clock reset detected: " << (rejected.reset ? "Yes" : "No") << '\n';
        if (stream.timing.firstDeviceFrame) output << "First device frame: " << *stream.timing.firstDeviceFrame << '\n';
        if (stream.timing.lastDeviceFrame) output << "Last packet device frame: " << *stream.timing.lastDeviceFrame << '\n';
        if (clock.first()) output << "First correlated frame/QPC (100 ns): "
                                  << clock.first()->position.units << ' ' << clock.first()->qpc.ticks100ns << '\n';
        if (clock.last()) output << "Last correlated frame/QPC (100 ns): "
                                 << clock.last()->position.units << ' ' << clock.last()->qpc.ticks100ns << '\n';
        if (const auto drift = stream.timing.driftPpm()) output << "Observed rate error vs 48 kHz (ppm): " << *drift << '\n';
        output.close();
        return static_cast<bool>(output);
    } catch (...) {
        return false;
    }
}
}

struct Capture::Run final : CaptureSink {
    Run(std::filesystem::path destination, unsigned tick)
        : path(std::move(destination)), journal(std::make_unique<TakeWriter>(path, tick)) {}

    ~Run() {
        stop.signal();
        if (producer.joinable()) producer.join();
        inputDone.store(true);
        dataAvailable.signal();
        if (writer.joinable()) writer.join();
        // Suspect drivers may retain a header after reporting an error. Keep the
        // driver-owned buffer addresses valid until process exit in that case.
        if (input && (!input->reset() || !input->close())) (void)input.release();
    }

    void begin(unsigned frames, unsigned deviceId, std::optional<WasapiInputConfig> config) {
        if (config) {
            writer = std::thread([this] { write(); });
            producer = std::thread([this, frames, config = std::move(*config)]() mutable {
                wasapi = runWasapiCapture(*this, std::move(config), frames, stop.get());
                if (wasapi->stream.end == CaptureEnd::interrupted) interrupted.store(true);
                inputDone.store(true);
                dataAvailable.signal();
            });
            return;
        }
        input = std::make_unique<InputDevice>();
        input->open(deviceId);
        queueAvailable(frames);
        if (interrupted.load() || waveInStart(input->handle) != MMSYSERR_NOERROR) {
            throw std::runtime_error("Windows could not start recording.");
        }
        writer = std::thread([this] { write(); });
        producer = std::thread([this, frames] { capture(frames); });
    }

    void queueAvailable(unsigned& frames) noexcept {
        while (frames && input->pending < InputDevice::bufferCount) {
            const auto count = std::min(frames, captureBlockFrames);
            if (!input->queue(count)) {
                interrupted.store(true);
                return;
            }
            frames -= count;
        }
    }

    bool enqueue(std::span<const std::int16_t> block) noexcept {
        if (block.empty()) return true;
        if (!queue.push(block)) {
            interrupted.store(true);
            return false;
        }
        dataAvailable.signal();
        return true;
    }

    CaptureError push(std::span<const std::int16_t> packet) noexcept override {
        if (writeFailed.load()) return CaptureError::storage;
        if (!queue.pushPacket(packet)) return CaptureError::queueFull;
        dataAvailable.signal();
        return CaptureError::none;
    }

    void capture(unsigned remaining) noexcept {
        const HANDLE events[]{stop.get(), input->ready.get()};
        bool lost = false;
        while (input->pending && !interrupted.load()) {
            if (WaitForSingleObject(stop.get(), 0) == WAIT_OBJECT_0) break;
            if (input->readyToRead()) {
                if (remaining && input->drained()) {
                    // The device could have discarded data while no headers were queued.
                    interrupted.store(true);
                    break;
                }
                // Drain in device submission order before recycling the header.
                if (!enqueue(input->pop())) { lost = true; break; }
                queueAvailable(remaining);
            } else {
                const auto event = WaitForMultipleObjects(2, events, FALSE, INFINITE);
                if (event == WAIT_OBJECT_0) break;
                if (event != WAIT_OBJECT_0 + 1) {
                    interrupted.store(true);
                    break;
                }
            }
        }
        if (!input->reset()) interrupted.store(true);
        while (!lost && !writeFailed.load() && input->readyToRead()) {
            if (!enqueue(input->pop())) break;
        }
        if (input->pending || !input->close()) interrupted.store(true);
        inputDone.store(true);
        dataAvailable.signal();
    }

    void write() noexcept {
        try {
            std::array<std::int16_t, takeBlockFrames> batch;
            CaptureBlock block;
            unsigned used = 0;
            for (;;) {
                if (!queue.pop(block)) {
                    if (inputDone.load() && queue.empty()) break;
                    if (WaitForSingleObject(dataAvailable.get(), INFINITE) != WAIT_OBJECT_0) {
                        throw std::runtime_error("Recording writer wake failed.");
                    }
                    continue;
                }
                auto source = std::span(block.samples).first(block.count);
                while (!source.empty()) {
                    const auto count = std::min<std::size_t>(batch.size() - used, source.size());
                    std::ranges::copy(source.first(count), batch.begin() + used);
                    used += static_cast<unsigned>(count);
                    source = source.subspan(count);
                    if (used == batch.size()) {
                        journal->append(batch);
                        used = 0;
                    }
                }
            }
            if (used) journal->append(std::span(batch).first(used));
            if (!interrupted.load()) journal->finalize();
        } catch (...) {
            writeFailed.store(true);
            interrupted.store(true);
            stop.signal();
        }
        journal.reset();
        writerDone.store(true);
    }

    std::filesystem::path path;
    std::unique_ptr<TakeWriter> journal;
    Event stop{true}, dataAvailable;
    std::unique_ptr<InputDevice> input;
    std::optional<WasapiInputReport> wasapi;
    TakeQueue queue;
    std::atomic<bool> inputDone{false}, writerDone{false}, interrupted{false}, writeFailed{false};
    std::thread producer, writer;
};

std::filesystem::path takeRecoveryDirectory() {
    const auto size = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
    if (!size) throw std::runtime_error("Windows does not provide a Local AppData folder for recording recovery.");
    std::wstring local(size, L'\0');
    const auto length = GetEnvironmentVariableW(L"LOCALAPPDATA", local.data(), size);
    if (!length || length >= size) throw std::runtime_error("Could not read the local recording recovery folder.");
    local.resize(length);
    return std::filesystem::path(local) / L"Sonoravell Studio" / L"Recovery";
}

Capture::Capture() = default;
Capture::~Capture() = default;
bool Capture::active() const { return static_cast<bool>(run); }
bool Capture::finished() const { return run && run->writerDone.load() && run->inputDone.load(); }

void Capture::start(unsigned frames, unsigned tick, unsigned deviceId, std::optional<WasapiInputConfig> wasapi) {
    if (active() || !frames || frames > maxAssetSamples / channelCount) {
        throw std::runtime_error("There is no capacity for another recording.");
    }
    const auto directory = takeRecoveryDirectory();
    std::filesystem::create_directories(directory);
    const auto stamp = std::chrono::system_clock::now().time_since_epoch().count();
    const auto name = "Take-" + std::to_string(stamp) + "-" + std::to_string(std::random_device{}()) + takeExtension;
    auto next = std::make_unique<Run>(directory / name, tick);
    next->begin(frames, deviceId, std::move(wasapi));
    run = std::move(next);
}

void Capture::requestStop() { if (run) run->stop.signal(); }

CaptureResult Capture::finish() {
    if (!finished()) throw std::runtime_error("The recording is still being committed to local storage.");
    const auto path = run->path;
    const auto interrupted = run->interrupted.load();
    const auto storageFailed = run->writeFailed.load();
    auto wasapi = std::move(run->wasapi);
    run.reset();
    auto take = recoverTake(path);
    const bool diagnosticsSaved = wasapi && saveCaptureDiagnostics(path, *wasapi, storageFailed, take.stereo.size() / channelCount);
    return {path, std::move(take), interrupted, storageFailed, std::move(wasapi), diagnosticsSaved};
}
}
