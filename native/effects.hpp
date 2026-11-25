#pragma once

#include "project.hpp"

#include <array>
#include <optional>
#include <span>
#include <vector>

namespace sonoravell {
class AudioBlockProcessor {
public:
    virtual ~AudioBlockProcessor() = default;
    // A block is interleaved stereo at the Session rate, with at most
    // sourceBlockFrames complete frames. One render owner per instance.
    virtual void process(std::span<double> block) noexcept = 0;
};

struct ParametricEq {
    double frequencyHz;
    double gainDb;
    double q;
};

struct Compressor {
    double thresholdDb;
    double ratio;
    double attackMs;
    double releaseMs;
};

struct Delay {
    unsigned frames;
    double feedback;
    double wet;
};

struct EffectSettings {
    double gainDb = 0.;
    std::optional<ParametricEq> eq;
    std::optional<Compressor> compressor;
    std::optional<Delay> delay;
};

class InternalEffects final : public AudioBlockProcessor {
public:
    static constexpr unsigned maxDelayFrames = 2 * sampleRate;
    static constexpr unsigned bypassRampFrames = sampleRate / 200;

    // Validate, prepare coefficients and allocate delay memory before rendering.
    explicit InternalEffects(const EffectSettings& settings);
    void process(std::span<double> block) noexcept override;
    void setBypassed(bool bypassed) noexcept;
    // Restore initial processor state once the render owner has settled.
    // This clears the preallocated delay buffer and belongs off the audio path.
    void reset() noexcept;

private:
    struct EqState {
        double b0, b1, b2, a1, a2;
        std::array<double, channelCount> z1{}, z2{};
        void process(std::array<double, channelCount>& frame) noexcept;
    };

    struct CompressorState {
        double threshold, slope, attack, release;
        double envelope = 0.;
        void process(std::array<double, channelCount>& frame) noexcept;
    };

    double gain = 1.;
    std::optional<EqState> eq;
    std::optional<CompressorState> compressor;
    std::vector<std::array<double, channelCount>> delay;
    std::size_t delayCursor = 0;
    double feedback = 0., wet = 0.;
    double mix = 1., target = 1., step = 0.;
    unsigned remaining = 0;
};
}
