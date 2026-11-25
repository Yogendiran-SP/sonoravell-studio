#include "inserts.hpp"

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace sonoravell {
std::span<const InsertParameter> insertParameters(InsertKind kind) noexcept {
    static constexpr std::array gain{InsertParameter{L"Gain (0.1 dB)", -240, 240, 0}};
    static constexpr std::array eq{InsertParameter{L"Frequency (Hz)", 20, 20000, 1000},
                                   InsertParameter{L"Gain (0.1 dB)", -180, 180, 0},
                                   InsertParameter{L"Q (0.01)", 10, 1000, 100}};
    static constexpr std::array compressor{InsertParameter{L"Threshold (0.1 dB)", -600, 0, -180},
                                           InsertParameter{L"Ratio (0.1)", 10, 200, 40},
                                           InsertParameter{L"Attack (0.1 ms)", 1, 1000, 100},
                                           InsertParameter{L"Release (ms)", 10, 1000, 100}};
    static constexpr std::array delay{InsertParameter{L"Time (ms)", 1, maxDelayMilliseconds, 250},
                                      InsertParameter{L"Feedback (%)", -90, 90, 25},
                                      InsertParameter{L"Mix (%)", 0, 100, 20}};
    switch (kind) {
    case InsertKind::gain: return gain;
    case InsertKind::eq: return eq;
    case InsertKind::compressor: return compressor;
    case InsertKind::delay: return delay;
    }
    return {};
}

const wchar_t* insertName(InsertKind kind) noexcept {
    switch (kind) {
    case InsertKind::gain: return L"Gain";
    case InsertKind::eq: return L"Parametric EQ";
    case InsertKind::compressor: return L"Compressor";
    case InsertKind::delay: return L"Delay";
    }
    return L"Unknown effect";
}

std::uint32_t editInserts(InsertList& list, const InsertCommand& command) {
    if (command.action == InsertAction::add) {
        const auto schema = insertParameters(command.kind);
        if (schema.empty() || list.size() >= maxInsertsPerBus) throw std::runtime_error("Cannot add another insert on this bus.");
        std::uint32_t maximum = 0;
        for (const auto& insert : list) maximum = std::max(maximum, insert.id);
        if (maximum == std::numeric_limits<std::uint32_t>::max()) throw std::runtime_error("Effect IDs exhausted.");
        EffectInsert added{maximum + 1, command.kind};
        for (std::size_t i = 0; i < schema.size(); ++i) added.values[i] = schema[i].initial;
        list.push_back(added);
        return added.id;
    }
    const auto found = std::ranges::find(list, command.id, &EffectInsert::id);
    if (found == list.end()) throw std::runtime_error("Select an effect first.");
    switch (command.action) {
    case InsertAction::toggleBypass: found->bypassed = !found->bypassed; break;
    case InsertAction::toggleEnabled: found->enabled = !found->enabled; break;
    case InsertAction::earlier: if (found != list.begin()) std::iter_swap(found, found - 1); break;
    case InsertAction::later: if (found + 1 != list.end()) std::iter_swap(found, found + 1); break;
    case InsertAction::remove: list.erase(found); return 0;
    case InsertAction::parameter: {
        const auto schema = insertParameters(found->kind);
        if (command.parameter >= schema.size() || command.value < schema[command.parameter].minimum ||
            command.value > schema[command.parameter].maximum) throw std::runtime_error("Effect parameter is out of range.");
        found->values[command.parameter] = command.value;
        break;
    }
    case InsertAction::add: break;
    }
    return command.id;
}

unsigned insertBypassMask(const InsertList& list) noexcept {
    unsigned mask = 0;
    for (std::size_t i = 0; i < std::min<std::size_t>(list.size(), maxInsertsPerBus); ++i) {
        if (list[i].bypassed) mask |= 1u << i;
    }
    return mask;
}

void validateInserts(const InsertList& list) {
    if (list.size() > maxInsertsPerBus) throw std::runtime_error("Too many effects on an insert bus.");
    for (std::size_t i = 0; i < list.size(); ++i) {
        const auto& slot = list[i];
        const auto schema = insertParameters(slot.kind);
        if (!slot.id || schema.empty() || std::ranges::find(std::span(list).first(i), slot.id, &EffectInsert::id) != std::span(list).first(i).end()) {
            throw std::runtime_error("Unknown effect type or duplicate or invalid effect ID.");
        }
        for (std::size_t p = 0; p < slot.values.size(); ++p) {
            const auto value = slot.values[p];
            if (p < schema.size() ? value < schema[p].minimum || value > schema[p].maximum : value != 0) {
                throw std::runtime_error("Invalid effect parameters.");
            }
        }
    }
}
}
