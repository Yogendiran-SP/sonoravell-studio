#pragma once

#include <filesystem>
#include <functional>
#include <iosfwd>

namespace sonoravell {
// Offline/control-thread operation. Encode in a sibling staging directory,
// then inspect any prior destination and replace it only after a flush.
void writeLocalFileAtomically(const std::filesystem::path& path,
                              const std::function<void(std::ostream&)>& encode,
                              const std::function<void(std::istream&)>& inspectExisting);
}
