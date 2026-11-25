#include "insert_processing.hpp"

#include <algorithm>
#include <stdexcept>

namespace sonoravell {
namespace {
EffectSettings settings(const EffectInsert& effect) {
    const auto& v = effect.values;
    EffectSettings configured;
    switch (effect.kind) {
    case InsertKind::gain:
        configured.gainDb = v[0] / 10.;
        break;
    case InsertKind::eq:
        configured.eq = ParametricEq{static_cast<double>(v[0]), v[1] / 10., v[2] / 100.};
        break;
    case InsertKind::compressor:
        configured.compressor = Compressor{v[0] / 10., v[1] / 10., v[2] / 10., static_cast<double>(v[3])};
        break;
    case InsertKind::delay:
        configured.delay = Delay{static_cast<unsigned>(v[0]) * (sampleRate / 1000), v[1] / 100., v[2] / 100.};
        break;
    }
    return configured;
}
}

void InsertChain::prepare(const InsertList& inserts) {
    validateInserts(inserts);
    std::vector<Entry> staged;
    staged.reserve(inserts.size());
    for (unsigned i = 0; i < inserts.size(); ++i) {
        if (!inserts[i].enabled) continue;
        auto& processor = staged.emplace_back(Entry{i, InternalEffects(settings(inserts[i]))}).processor;
        processor.setBypassed(inserts[i].bypassed);
        processor.reset();
    }
    prepared.swap(staged);
}

void InsertChain::setBypass(unsigned mask) noexcept {
    for (auto& insert : prepared) insert.processor.setBypassed((mask & (1u << insert.slot)) != 0);
}

void InsertChain::process(std::span<double> block) noexcept {
    for (auto& insert : prepared) insert.processor.process(block);
}

PreparedInserts::PreparedInserts(const Project& project) {
    validateProjectInserts(project);
    master.prepare(project.masterInserts);
    for (std::size_t i = 0; i < project.tracks.size(); ++i) tracks.at(i).prepare(project.tracks[i].inserts);
}

std::unique_ptr<PreparedInserts> prepareInserts(const Project& project) {
    if (project.masterInserts.empty() &&
        std::ranges::all_of(project.tracks, [](const Track& t) { return t.inserts.empty(); })) return {};
    return std::make_unique<PreparedInserts>(project);
}
}
