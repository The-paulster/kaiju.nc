# KAIJU Trace

**Sources:** `src/kaijuTrace/` and shared `src/MetaExecutionTrace.js`

## Responsibility

KAIJU Trace runs a debounced, bounded execution pass after a G-code document
settles. It presents trace health in the right-side status bar. Its tooltip
lists every assumed-zero macro and every safety or flow problem.

## Connections

- `MetaExecutionTrace` owns reusable execution state, loop/GOTO traversal and
  nested `IF [...] THEN` / `ELSE` / `ENDIF` branch selection,
  macro history, initial macro state, per-occurrence trace lines and macro
  deltas for explicit inspection, the execution-to-formatted-line mapping, and
  the cache. Its passive file-open run
  keeps only the health and macro-history data needed by Trace and Sense;
  Vision and Chronoblade explicitly request the fuller per-occurrence data when opened.
- Decomposition consumes the same occurrence stream and formats its optional
  condition/assignment metadata; it is not a second execution engine.
- Sense consumes per-line macro histories, showing all values through ten
  occurrences and otherwise the first five and last five.
- Decomposition remains interactive and requests unresolved macro values when
  explicitly run, then rebuilds this same shared execution stream with them.

## Boundary

Trace status presents shared results; it does not implement macro parsing or
control flow. The passive trace never prompts for values: unresolved macros are
assumed to be zero and reported visibly, while execution caps and repeated
states prevent an unresolved loop from running indefinitely.

Structured conditional syntax is interpreted whenever it appears in a program;
it is not enabled or disabled by the active machine profile. Trace pairs nested
blocks, executes only the selected branch, and exposes that branch's effective
NC text to motion consumers. An inline `IF [...] THEN action ELSE action` also
contributes only its selected action. Unmatched `ELSE` or `ENDIF`, duplicate
`ELSE`, and missing `ENDIF` markers are reported through the shared flow checks.

An explicit playback consumer may request initial macro state, recorded
per-occurrence macro deltas, and source-defined decimal precision for macro
assignments. Ordinary passive Trace runs do not create that extra snapshot
data. Playback restores and reuses the prepared data; it does not evaluate
source text while navigating.

To supply a passive default, place an initial header comment before the first
executable G/M block, for example `(#100 {3.000})`. The trailing numeric braces
provide Trace's value for `#100`.
