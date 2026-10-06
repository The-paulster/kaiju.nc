# KAIJU Orphan Killer

**Sources:** `src/kaijuOrphanKiller/`

## Responsibility

Orphan Killer reports macro definitions and references so an operator can find
unused or unresolved macro relationships. It owns that report's command,
webview, findings, and options.

Its compact report shell follows the shared KAIJU panel presentation: a title
toolbar, finding-count cards, and two bordered finding tables. Its per-program
Live toggle is off by default and refreshes the open report shortly after an
edit to that same document; Refresh remains available for a manual snapshot.

Clicking a macro or source line makes that finding active in the report and
selects/reveals its exact token in the source editor, with a find-style
decoration that remains visible while the report has focus. Previous/Next
(Enter/Shift+Enter in the report) cycle individual occurrences from both
tables in source order and wrap. The navigation counter counts occurrences;
summary cards still count distinct macros. Source edits invalidate navigation
until Refresh or Live rebuilds the report. Closing the report clears its
editor decoration.

`inspectOrphanMacros()` retains its `macro`, `name`, and deduplicated one-based
`lines` fields and adds `occurrences` with zero-based `line`, `start`, and
exclusive `end` source offsets from the existing protected-text-aware scan.

## Connections

- Uses `MetaMacroEngine` for macro alias/reference modeling.
- Uses `MetaTextRanges` while scanning source text.
- Is adjacent to Alias and Sense macro hovers, but does not own their commands
  or UI.

## Boundary

This feature inspects and reports; it does not edit aliases or become a generic
macro engine. Add shared macro parsing to Meta, then render the result here.


`getOrphanSettingsSnapshot(document)` returns saved choices and effective options, including the normalized Live toggle, for File Settings.
