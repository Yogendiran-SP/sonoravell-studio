#include "stream_clock.hpp"

#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace sonoravell;

namespace {
constexpr auto second = qpcTicksPerSecond;
constexpr std::uint64_t epoch = 9'000'000'000'000'000'000ull;

void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void stamp(StreamClock& clock, std::uint64_t position, std::uint64_t qpc) {
    clock.observe(ClockStamp{{position}, {qpc}}, QpcTime{qpc + 1});
}

void checkStartOrders() {
    constexpr std::uint64_t captureUnits = 48'000, renderUnits = 44'100 * 4;
    constexpr std::uint64_t captureObserved = 48'024, renderObserved = 176'364;
    constexpr ClockPosition captureOrigin{32100}, renderOrigin{20000};
    for (const bool captureFirst : {false, true}) {
        StreamClock capture{captureUnits, 7, captureOrigin};
        StreamClock render{renderUnits, 7, renderOrigin};
        const auto earlier = epoch;
        const auto later = epoch + second / 5;
        const auto captureStart = captureFirst ? earlier : later;
        const auto renderStart = captureFirst ? later : earlier;
        // The first observation happens a half second after each actual start.
        // Position units also differ from the timeline frame counts.
        stamp(capture, captureOrigin.units + captureObserved / 2, captureStart + second / 2);
        stamp(capture, captureOrigin.units + captureObserved * 11 / 2, captureStart + second * 11 / 2);
        stamp(render, renderOrigin.units + renderObserved / 2, renderStart + second / 2);
        stamp(render, renderOrigin.units + renderObserved * 11 / 2, renderStart + second * 11 / 2);

        const auto now = QpcTime{later + second * 11 / 2 + 2};
        const auto relation = correlateClocks(capture, render, now);
        check(relation.has_value(), "Expected overlapping qualified evidence.");
        check(std::abs(relation->captureStartOffsetSeconds - (captureFirst ? -0.2 : 0.2)) < 1e-9,
              "Stream start offset must account for first observation and clock origin.");
        const auto expectedPpm = ((static_cast<double>(captureObserved) / captureUnits) /
                                  (static_cast<double>(renderObserved) / renderUnits) - 1.0) * 1'000'000.0;
        check(std::abs(relation->captureRelativeDriftPpm - expectedPpm) < 1e-6,
              "Drift must compare normalized rates and preserve its sign.");
        check(!correlateClocks(capture, render, QpcTime{now.ticks100ns + clockMaxSampleAge}),
              "A pair with expired evidence cannot correlate.");
    }
}

void checkInvalidSamples() {
    StreamClock clock{48'000, 4};
    stamp(clock, 0, epoch);
    clock.observe({}, QpcTime{epoch + 2});
    clock.observe(ClockStamp{{1}, {0}}, QpcTime{epoch + 3});
    clock.observe(ClockStamp{{1}, {epoch + 4}}, {});
    clock.observe(ClockStamp{{1}, {epoch + 5}}, QpcTime{epoch + 4});
    clock.observe(ClockStamp{{1}, {epoch - 1}}, QpcTime{epoch + 5});
    clock.observe(ClockStamp{{1}, {epoch}}, QpcTime{epoch + 6});
    clock.observe(ClockStamp{{0}, {epoch + 6}}, QpcTime{epoch + 7});
    clock.observe(ClockStamp{{1}, {epoch + 8}}, QpcTime{epoch + 9 + clockMaxSampleAge});
    const auto rejected = clock.rejected();
    check(rejected.missing == 3 && rejected.stale == 2 && rejected.nonmonotonic == 3 && !rejected.reset,
          "Missing, future, regressing, duplicate and old samples must be classified.");
    check(clock.last()->position.units == 0 && !clock.rateRatio(), "Invalid samples cannot alter anchors.");
    stamp(clock, 48'000 * 3, epoch + 3 * second);
    check(clock.rateRatio() == 1.0, "Valid evidence must resume after a bad sample.");

    stamp(clock, 0, epoch + 4 * second);
    stamp(clock, 48'000 * 5, epoch + 5 * second);
    check(clock.rejected().reset && !clock.rateRatio() && clock.last()->position.units == 48'000 * 3,
          "A device reset must invalidate the run and preserve the prior diagnostics.");

    StreamClock resetReference{48'000, 5};
    stamp(resetReference, 0, epoch);
    resetReference.observe(ClockStamp{{48'000}, {epoch - 2}}, QpcTime{epoch - 1});
    check(resetReference.rejected().reset && !resetReference.rateRatio(), "A reset reference clock must invalidate its evidence.");
}

void checkPairIsolation() {
    const auto simulated = [](std::uint64_t attempt, std::uint64_t start, std::uint64_t firstPosition = 0) {
        StreamClock clock{48'000, attempt};
        stamp(clock, firstPosition, start);
        stamp(clock, firstPosition + 48'000, start + second);
        return clock;
    };
    const auto capture = simulated(1, epoch);
    const auto render = simulated(1, epoch);
    const auto restartedRender = simulated(2, epoch + second / 2);
    check(!correlateClocks(capture, restartedRender, QpcTime{epoch + 2 * second}),
          "Overlapping reports from different attempts must not be paired.");
    const auto restartedCapture = simulated(2, epoch + second / 4);
    const auto restarted = correlateClocks(restartedCapture, restartedRender, QpcTime{epoch + 2 * second});
    check(restarted && restarted->captureStartOffsetSeconds == -0.25 && restarted->captureRelativeDriftPpm == 0,
          "A new attempt must estimate using only new evidence.");

    const auto independent = simulated(0, epoch);
    check(!correlateClocks(independent, independent, QpcTime{epoch + second}), "Independent previews cannot be paired.");
    const auto separated = simulated(1, epoch + 2 * second);
    check(!correlateClocks(capture, separated, QpcTime{epoch + 3 * second}), "Disjoint evidence cannot be paired.");
    const auto late = simulated(1, epoch, 3 * 48'000);
    check(!correlateClocks(capture, late, QpcTime{epoch + second}), "A late first observation cannot estimate a start.");
    check(!correlateClocks(capture, render, QpcTime{epoch}), "Future evidence cannot be used.");

    StreamClock incomplete{48'000, 1};
    stamp(incomplete, 0, epoch);
    check(!correlateClocks(capture, incomplete, QpcTime{epoch + second}), "A single anchor cannot fit a rate.");
    stamp(incomplete, 48, epoch + second / 1000);
    check(!correlateClocks(capture, incomplete, QpcTime{epoch + second}), "A sub-window overlap cannot fit a pair.");
}
}

int main() {
    try {
        checkStartOrders();
        checkInvalidSamples();
        checkPairIsolation();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
