# KAIJU Trace

**Sources:** `src/kaijuTrace/` and shared `src/MetaExecutionTrace.js`

## Responsibility

KAIJU Trace runs a debounced, bounded execution pass after a G-code document
settles. It presents trace health in the right-side status bar. Its tooltip
lists every assumed-zero macro and every safety or flow problem.

## Connections

- `MetaExecutionTrace` owns reusable execution state, loop/GOTO traversal,
  macro history, evaluated per-occurrence trace lines, and the cache.
- Sense consumes per-line macro histories, showing all values through ten
  occurrences and otherwise the first five and last five.
- Decomposition remains interactive and requests unresolved macro values when
  the user explicitly runs it.

## Boundary

Trace status presents shared results; it does not implement macro parsing or
control flow. The passive trace never prompts for values: unresolved macros are
assumed to be zero and reported visibly, while execution caps and repeated
states prevent an unresolved loop from running indefinitely.
