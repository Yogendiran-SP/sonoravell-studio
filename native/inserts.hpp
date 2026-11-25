#pragma once

#include <array>
#include <cstdint>
#include <span>
#include <vector>

namespace sonoravell {
inline constexpr unsigned maxInsertsPerBus = 4;
inline constexpr unsigned maxSessionInserts = 12;
inline constexpr unsigned maxDelayMilliseconds = 2000;
inline constexpr unsigned maxSessionDelayMilliseconds = 8000;

enum class InsertKind : std::uint8_t { gain, eq, compressor, delay };

struct InsertParameter {
    const wchar_t* label;
    int minimum, maximum, initial;
};

struct EffectInsert {
    std::uint32_t id;
    InsertKind kind;
    bool enabled = true;
    bool bypassed = false;
    std::array<std::int32_t, 4> values{};
    bool operator==(const EffectInsert&) const = default;
};
using InsertList = std::vector<EffectInsert>;

enum class InsertAction { add, toggleBypass, toggleEnabled, earlier, later, remove, parameter };

struct InsertCommand {
    InsertAction action;
    std::uint32_t id = 0;
    InsertKind kind = InsertKind::gain;
    unsigned parameter = 0;
    int value = 0;
};

std::span<const InsertParameter> insertParameters(InsertKind kind) noexcept;
const wchar_t* insertName(InsertKind kind) noexcept;
std::uint32_t editInserts(InsertList& list, const InsertCommand& command);
unsigned insertBypassMask(const InsertList& list) noexcept;
void validateInserts(const InsertList& list);
}
