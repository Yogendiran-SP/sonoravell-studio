#include "atomic_output.hpp"

#include <fstream>
#include <random>
#include <stdexcept>
#include <system_error>
#include <utility>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace sonoravell {
namespace {
void require(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}

class SaveStaging {
public:
    explicit SaveStaging(const std::filesystem::path& destination) {
        std::random_device entropy;
        for (int attempt = 0; attempt < 20; ++attempt) {
            auto candidate = destination.parent_path() / (".sonoravell-save-" + std::to_string(entropy()));
            auto output = candidate / "output";
            if (std::filesystem::create_directory(candidate)) {
                directory = std::move(candidate);
                path = std::move(output);
                return;
            }
        }
        throw std::runtime_error("Could not create temporary output storage.");
    }

    ~SaveStaging() {
        std::error_code ignored;
        std::filesystem::remove(path, ignored);
        std::filesystem::remove(directory, ignored);
    }

    const std::filesystem::path& payload() const noexcept { return path; }

private:
    std::filesystem::path directory, path;
};

void commitSave(const std::filesystem::path& temporary, const std::filesystem::path& destination) {
#ifdef _WIN32
    const auto file = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    require(file != INVALID_HANDLE_VALUE, "Could not reopen the staged output.");
    const auto flushed = FlushFileBuffers(file);
    CloseHandle(file);
    require(flushed, "Could not flush the staged output.");
    require(MoveFileExW(temporary.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH),
            "Could not replace the destination file.");
#else
    const int file = ::open(temporary.c_str(), O_RDONLY);
    require(file >= 0, "Could not reopen the staged output.");
    const auto flushed = fsync(file);
    close(file);
    require(flushed == 0, "Could not flush the staged output.");
    std::filesystem::rename(temporary, destination);
    // Some filesystems do not support syncing directory metadata.
    const int directory = ::open(destination.parent_path().c_str(), O_RDONLY);
    if (directory >= 0) {
        fsync(directory);
        close(directory);
    }
#endif
}
}

void writeLocalFileAtomically(const std::filesystem::path& path,
                              const std::function<void(std::ostream&)>& encode,
                              const std::function<void(std::istream&)>& inspectExisting) {
    const auto destination = std::filesystem::absolute(path);
    const SaveStaging staging(destination);
    const auto temporary = staging.payload();
    {
        std::ofstream file(temporary, std::ios::binary);
        require(static_cast<bool>(file), "Could not create a staged output file.");
        encode(file);
        file.close();
        require(static_cast<bool>(file), "Could not finish writing the staged output.");
    }
    {
        std::error_code error;
        const auto type = std::filesystem::symlink_status(destination, error);
        require(!error || error == std::errc::no_such_file_or_directory, "Could not check the destination file.");
        if (std::filesystem::exists(type)) {
            require(std::filesystem::is_regular_file(type), "Choose a regular file or a new filename.");
            std::ifstream existing(destination, std::ios::binary);
            require(static_cast<bool>(existing), "Could not read the existing destination file.");
            inspectExisting(existing);
        }
    }
    commitSave(temporary, destination);
}
}
