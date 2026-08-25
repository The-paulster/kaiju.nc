# KAIJU Decomposition

**Sources:** `src/kaijuDecomposition/`

## Responsibility

Decomposition turns the shared execution occurrence stream into a readable
G-code trace for inspection and debugging. `MetaExecutionTrace` owns all
control-flow decisions; Decomposition owns interactive input collection,
trace output formatting, and its configuration reads. Its generated notes are concise,
single-line meta-comments: `/assignment` records resolved assignments,
`/comparison` records resolved macro values, the numeric test, Boolean result,
and the conditional body, and `/flow` records unconditional control flow.
In the initial comment section, a macro label ending in `{number}` seeds a
shared Trace default—for example `(#109 Tool life counter 5 {0})` gives
`#109` the value `0` without prompting for manual input. Other unresolved
macro inputs are requested when the user explicitly runs Decomposition.
The module also exposes the formatted output instruction and its exact,
one-based generated-document line number for consumers that need to identify a
specific execution occurrence.

## Connections

- Uses `MetaMacroEngine` for shared macro aliases, numeric literals, and
  expression evaluation.
- Uses `MetaTextRanges` when scanning source text.
- Consumes `MetaExecutionTrace` occurrence records, resolved conditions,
  assignments, termination state, and safety problems. It never walks program
  control flow independently.
- Reuses Reconstructor formatting for output formatting rather than duplicating
  it.

## Boundary

Decomposition explains execution; it does not own execution order, the general
formatter, Alias editing, live macro hovers, or cycle-time calculation. An
interactive run may collect missing initial values and rebuild the shared Trace
until its path is resolved. Passive consumers supply an existing enriched Trace
and never prompt.
