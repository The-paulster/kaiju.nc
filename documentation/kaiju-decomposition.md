# KAIJU Decomposition

**Sources:** `src/kaijuDecomposition/`

## Responsibility

Decomposition turns macro-driven G-code into a readable execution trace for
inspection and debugging. It owns trace control-flow interpretation, trace
output, and its configuration reads. Its generated notes are concise,
single-line meta-comments: `/assignment` records resolved assignments,
`/comparison` records resolved macro values, the numeric test, Boolean result,
and the conditional body, and `/flow` records unconditional control flow.
In the initial comment section, a macro label ending in `{number}` seeds a
Decomposition-only default—for example `(#109 Tool life counter 5 {0})` gives
`#109` the value `0` without prompting for manual input. Other unresolved
macro inputs are requested when the user explicitly runs Decomposition.

## Connections

- Uses `MetaMacroEngine` for shared macro aliases, numeric literals, and
  expression evaluation.
- Uses `MetaTextRanges` when scanning source text.
- Reuses Reconstructor formatting for output formatting rather than duplicating
  it.

## Boundary

Decomposition explains execution; it does not own the general formatter, Alias
editing, live macro hovers, or cycle-time calculation. Keep source-text parsing
and trace semantics deterministic, especially for loops, labels, alarms, and
terminal program behavior.
