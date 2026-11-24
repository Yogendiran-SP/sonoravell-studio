# Recording-first duplex coordination

This control-thread state machine prepares ENG-01, ENG-04 and REC-01. It
consumes the [stream clock model](WASAPI_CLOCKS.md) contract through the same
attempt identifier. Its effects are requests for a future transport adapter.
The existing GUI continues to run capture and render independently. The
model runs offline with no device or storage calls. Roll back by reverting
this increment.

| State | Entry and transition |
| --- | --- |
| Idle | After a writable take journal is prepared, Start assigns a fresh attempt ID and requests both workers. |
| Starting | Either endpoint can report ready first. If output exits first, allow the input to finish opening. If input exits, request output Stop. |
| Running | Both endpoints are ready. Output completion or failure leaves capture running. Input completion or failure ends playback. |
| Capture only | Input keeps feeding the same journal after the output completes or fails. End through user Stop, capture failure, storage failure, or the recording limit. There is no automatic output restart. |
| Stopping | Request each pending or running worker to stop once. Completion requires both endpoint exits and a closed journal. |

The controller processes events serially on the control thread. Workers
acknowledge exit after releasing their endpoint resources and report the
attempt ID they were started with. The writer reports a failed operation as
soon as it is known and confirms final closure with an authoritative
storage outcome. Capture loss or queue overflow drains the previously
accepted prefix and leaves an interrupted journal. A storage failure requests
both workers to stop and preserves the checksummed prefix. A new Start waits
for the previous attempt to settle. Late and duplicate acknowledgements
cannot change another attempt's state or replay Stop.

An eventual adapter must retain the immutable Session snapshot through worker
cleanup, start with a freshly prepared journal, dispatch its failure and
closure events, and release a take for recovery only after the model completes.
The model issues no monitor or loopback routing. The first simultaneous test
build should render the Session and capture a selected physical input. Live
input monitoring and loopback sources require a separate routing decision and
feedback tests.

## Verification boundary

`duplex_coordination_check` tests both start orders, output and input loss,
user cancellation while opening, duplicate and delayed events, repeated
Start/Stop, queue saturation, storage errors, and journal close ordering.
It drives a bounded queue to saturation, writes the verified prefix to the
existing journal format and saves and reopens the recovered Session beside
the prior committed Session. The existing take suite covers abruptly
terminated writes, checksum failures and POSIX write faults. The state
machine tests simulate endpoint and writer notifications. The [physical
clock and failure gates](WASAPI_CLOCKS.md#software-and-physical-gates) apply
to a future simultaneous build before enabling the mode in the transport.
