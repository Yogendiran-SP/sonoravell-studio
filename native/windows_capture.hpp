#pragma once

#include "take_journal.hpp"

#include <memory>

namespace sonoravell {
std::filesystem::path takeRecoveryDirectory();

struct CaptureResult {
    std::filesystem::path path;
    RecoveredTake take;
    bool interrupted = false;
};

class Capture {
public:
    Capture();
    ~Capture();

    bool active() const;
    bool finished() const;
    void start(unsigned frames, unsigned tick, unsigned deviceId);
    void requestStop();
    CaptureResult finish();

private:
    struct Run;
    std::unique_ptr<Run> run;
};
}
