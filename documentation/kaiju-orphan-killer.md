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

## Connections

- Uses `MetaMacroEngine` for macro alias/reference modeling.
- Uses `MetaTextRanges` while scanning source text.
- Is adjacent to Alias and Sense macro hovers, but does not own their commands
  or UI.

## Boundary

This feature inspects and reports; it does not edit aliases or become a generic
macro engine. Add shared macro parsing to Meta, then render the result here.
