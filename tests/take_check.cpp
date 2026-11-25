#include "take_journal.hpp"
#include "take_queue.hpp"

#include <array>
#include <atomic>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <random>
#include <stdexcept>
#include <thread>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <csignal>
#include <sys/wait.h>
#include <unistd.h>
#include <sys/resource.h>
#endif

using namespace sonoravell;

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void mustFail(auto&& action) {
    try { action(); }
    catch (const std::runtime_error&) { return; }
    throw std::runtime_error("The proposed write unexpectedly succeeded.");
}

struct TemporaryDirectory {
    std::filesystem::path path = std::filesystem::temp_directory_path() /
        ("sonoravell-take-" + std::to_string(std::random_device{}()));
    TemporaryDirectory() { check(std::filesystem::create_directory(path), "Could not create the take fixture directory."); }
    ~TemporaryDirectory() {
        std::error_code ignored;
        std::filesystem::remove_all(path, ignored);
    }
};

constexpr std::array<std::int16_t, 3> first{32767, -32768, 42};
constexpr std::array<std::int16_t, 2> second{5, -6};
const Samples firstStereo{32767, 32767, -32768, -32768, 42, 42};

[[noreturn]] void interruptedWriter(const std::filesystem::path& path) {
    TakeWriter writer(path, 960);
    writer.append(first);
    // Exit without running the writer destructor or writing the complete marker.
    std::_Exit(31);
}

void simulateInterruption([[maybe_unused]] const char* executable, const std::filesystem::path& path) {
#ifdef _WIN32
    const auto exe = std::filesystem::absolute(executable).wstring();
    auto command = L"\"" + exe + L"\" --interrupted \"" + path.wstring() + L"\"";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    check(CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process),
          "Could not launch the interrupted Windows writer.");
    const auto wait = WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit = 0;
    const auto knownExit = GetExitCodeProcess(process.hProcess, &exit);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    check(wait == WAIT_OBJECT_0 && knownExit && exit == 31, "The interrupted Windows writer did not reach its exit point.");
#else
    const auto child = fork();
    check(child >= 0, "Could not start the interrupted writer.");
    if (child == 0) interruptedWriter(path);
    int status = 0;
    check(waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 31,
          "The interrupted writer did not reach its exit point.");
#endif
}

void checkQueue() {
    TakeQueue queue;
    CaptureBlock output;
    unsigned queued = 0;
    while (queue.push(first)) ++queued;
    check(queued > 0 && queued < 256, "The capture queue exceeded its configured capacity.");
    for (unsigned i = 0; i < queued; ++i) {
        check(queue.pop(output) && output.count == first.size() &&
              std::equal(first.begin(), first.end(), output.samples.begin()), "The capture queue lost audio.");
    }
    check(!queue.pop(output) && queue.empty(), "The capture queue produced unexpected blocks.");

    std::atomic<bool> ordered{true};
    std::jthread producer([&] {
        for (std::int16_t i = 0; i < 2000; ++i) {
            const std::array block{i};
            while (!queue.push(block)) std::this_thread::yield();
        }
    });
    for (std::int16_t i = 0; i < 2000; ++i) {
        while (!queue.pop(output)) std::this_thread::yield();
        if (output.count != 1 || output.samples.front() != i) ordered = false;
    }
    producer.join();
    check(ordered && queue.empty(), "The capture queue was out of order across threads.");
}
}

int main(int argc, char** argv) {
    try {
        if (argc == 3 && std::string_view(argv[1]) == "--interrupted") interruptedWriter(argv[2]);
        TemporaryDirectory directory;
        const auto plain = directory.path / "normal.sntake";
        {
            TakeWriter writer(plain, 240);
            writer.append(first);
            writer.append(second);
            writer.finalize();
            mustFail([&] { writer.append(first); });
        }
        const auto finished = recoverTake(plain);
        check(finished.finalized && finished.startTick == 240 &&
              finished.stereo == Samples{32767, 32767, -32768, -32768, 42, 42, 5, 5, -6, -6},
              "The finalized take did not round-trip.");
        mustFail([&] { TakeWriter writer(plain, 0); });
        check(recoverTake(plain).stereo == finished.stereo, "A duplicate writer damaged existing audio.");

        const auto crashed = directory.path / "interrupted.sntake";
        simulateInterruption(argv[0], crashed);
        const auto recovered = recoverTake(crashed);
        check(!recovered.finalized && recovered.startTick == 960 && recovered.stereo == firstStereo,
              "Previously committed audio was lost when the process exited abruptly.");

        const auto torn = directory.path / "torn.sntake";
        std::filesystem::copy_file(plain, torn);
        std::filesystem::resize_file(torn, 16 + 8 + first.size() * 2 + 8 + 1);
        const auto prefix = recoverTake(torn);
        check(!prefix.finalized && prefix.stereo == firstStereo, "A torn payload hid the previous complete audio block.");
        std::filesystem::copy_file(plain, torn, std::filesystem::copy_options::overwrite_existing);
        std::fstream changed(torn, std::ios::binary | std::ios::in | std::ios::out);
        changed.seekp(16 + 8 + first.size() * 2 + 8);
        changed.put(99);
        changed.close();
        check(recoverTake(torn).stereo == firstStereo, "Audio after an invalid checksum was accepted.");
#ifndef _WIN32
        const auto limited = directory.path / "file-limit.sntake";
        {
            TakeWriter writer(limited, 0);
            writer.append(first);
            struct rlimit original{};
            check(getrlimit(RLIMIT_FSIZE, &original) == 0, "Could not read the test process file size limit.");
            const struct rlimit limit{32, original.rlim_max};
            const auto oldSignal = std::signal(SIGXFSZ, SIG_IGN);
            check(setrlimit(RLIMIT_FSIZE, &limit) == 0, "Could not inject a filesystem write limit.");
            bool failed = false;
            try { writer.append(second); }
            catch (const std::runtime_error&) { failed = true; }
            const auto restored = setrlimit(RLIMIT_FSIZE, &original);
            std::signal(SIGXFSZ, oldSignal);
            check(restored == 0 && failed, "An injected filesystem write limit was not reported.");
            mustFail([&] { writer.finalize(); });
        }
        check(recoverTake(limited).stereo == firstStereo, "A filesystem write failure damaged previous audio.");
#endif
        Project song;
        song.assets.push_back({1, "Recovered", prefix.stereo});
        song.tracks.push_back({1, "Recovered", Instrument::audio, false, 100, {}, {wholeAudioClip(1, song.assets.front(), prefix.startTick)}});
        const auto session = directory.path / "saved.sonora";
        saveProject(session, song);
        check(openProject(session) == song, "Recovered audio did not survive Session save and reopen.");
        check(recoverTake(torn).stereo == firstStereo, "Import or save changed the recovery file.");
        checkQueue();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
