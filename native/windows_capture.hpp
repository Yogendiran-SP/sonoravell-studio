#pragma once

#include "take_journal.hpp"
#include "windows_wasapi_capture.hpp"

#include <memory>

namespace sonoravell {
std::filesystem::path takeRecoveryDirectory();

struct CaptureResult {
    std::filesystem::path path;
    RecoveredTake take;
    bool interrupted = false;
    bool storageFailed = false;
    std::optional<WasapiInputReport> wasapi;
    bool diagnosticsSaved = false;
};

class Capture {
public:
    Capture();
    ~Capture();

    bool active() const;
    bool finished() const;
    void start(unsigned frames, unsigned tick, unsigned deviceId, std::optional<WasapiInputConfig> wasapi = {});
    void requestStop();
    CaptureResult finish();

private:
    struct Run;
    std::unique_ptr<Run> run;
};
}
