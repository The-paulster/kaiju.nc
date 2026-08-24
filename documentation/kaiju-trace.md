# KAIJU Trace

**Sources:** `src/kaijuTrace/` and shared `src/MetaExecutionTrace.js`

## Responsibility

KAIJU Trace runs a debounced, bounded execution pass after a G-code document
settles. It presents trace health in the right-side status bar. Its tooltip
lists every assumed-zero macro and every safety or flow problem.

## Connections

- `MetaExecutionTrace` owns reusable execution state, loop/GOTO traversal,
  macro history, evaluated per-occurrence trace lines, initial macro state,
  per-occurrence macro deltas, and the cache.
- Sense consumes per-line macro histories, showing all values through ten
  occurrences and otherwise the first five and last five.
- Decomposition remains interactive and requests unresolved macro values when
  the user explicitly runs it.

## Boundary

Trace status presents shared results; it does not implement macro parsing or
control flow. The passive trace never prompts for values: unresolved macros are
assumed to be zero and reported visibly, while execution caps and repeated
states prevent an unresolved loop from running indefinitely.

An explicit playback consumer may request initial macro state, recorded
per-occurrence macro deltas, and source-defined decimal precision for macro
assignments. Ordinary passive Trace runs do not create that extra snapshot
data. Playback restores and reuses the prepared data; it does not evaluate
source text while navigating.

To supply a passive default, place an initial header comment before the first
executable G/M block, for example `(#100 {3.000})`. The trailing numeric braces
provide Trace's value for `#100`.
