#pragma once

#include "effects.hpp"

namespace sonoravell {
class InsertChain {
public:
    void prepare(const InsertList& inserts);
    void setBypass(unsigned mask) noexcept;
    void process(std::span<double> block) noexcept;
    bool empty() const noexcept { return prepared.empty(); }

private:
    struct Entry {
        unsigned slot;
        InternalEffects processor;
    };
    std::vector<Entry> prepared;
};

struct PreparedInserts {
    explicit PreparedInserts(const Project& project);
    InsertChain master;
    std::array<InsertChain, maxTracks> tracks;
};

std::unique_ptr<PreparedInserts> prepareInserts(const Project& project);
}
