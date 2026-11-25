#include "workspace_layout.hpp"

#include <stdexcept>

using namespace sonoravell;

namespace {
void check(bool result, const char* message) {
    if (!result) throw std::runtime_error(message);
}
}

int main() {
    const WorkspaceLayout custom{false, true, false, true, 203, 277};
    const auto bytes = encodeWorkspace(custom);
    check(decodeWorkspace(bytes) == custom, "Custom layout and panel sizes must round-trip.");
    check(decodeWorkspace(encodeWorkspace({})) == WorkspaceLayout{}, "Reset must round-trip the factory layout.");
    auto bad = bytes;
    bad[3] = 2;
    check(!decodeWorkspace(bad), "A newer layout version must be rejected.");
    bad = bytes;
    bad[4] = 16;
    check(!decodeWorkspace(bad), "Reserved layout flags must be rejected.");
    bad = bytes;
    bad[6] = 10;
    check(!decodeWorkspace(bad), "An out-of-range panel width must be rejected.");
    check(!decodeWorkspace(std::span(bytes).first(bytes.size() - 1)), "A partial layout cannot apply.");
    const WorkspaceLayout extremes{true, false, true, false, 0, 1000};
    const auto clamped = decodeWorkspace(encodeWorkspace(extremes));
    check(clamped && clamped->inspectorWidth == defaultPanelWidth && clamped->browserWidth == maxPanelWidth,
          "Panel widths must be bounded before persistence.");
}
