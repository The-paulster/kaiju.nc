# Change Log

All notable changes to the "KAIJU.NC" extension will be documented in this file.

## [Unreleased]

- Added a right-click `KAIJU Chronoblade` cycle-time report webview with whole-program and selection sends, `G0` rapid timing, tool swap timing, and per-line motion/tool rows.
- Added `kaijuNC.chronoblade.compactPanelWidth` so the Chronoblade report width can be configured separately from Orphan Killer.
- Added `kaijuNC.syntax.toolDecorations.enabled` so tool-range gutter markers can be toggled from the new Syntax settings category.
- Added `kaijuNC.format.leadingWhitespace` and `kaijuNC.format.softTabSize`, defaulting to preserving leading tabs and full 4-space soft-tabs while removing stray leading spaces and still auto-indenting `WHILE`/`END` blocks using the detected indent style.
- Fixed `KAIJU Reconstructor` operator spacing for named alias macro math, such as `#foo-#bar`.
- Split extension settings into Reconstructor, Alias, Orphan Killer, and Chronoblade categories in the VS Code Settings UI.
- Split Chronoblade into shared engine, hover, and webview modules so calculation changes flow through both UI surfaces.

## [0.1.1] - 2026-05-20

- Finished the `KAIJU Chronoblade` naming pass in user-facing hovers, settings descriptions, and documentation because it sounds way cooler.
- Fixed `KAIJU Chronoblade` estimates for lathe arcs that use incremental `U/V/W` axis words and `R` radius arcs instead of absolute `X/Y/Z` endpoints with `I/J/K` centers.
- Added `KAIJU Chronoblade` warnings when a motion endpoint or feed expression cannot be resolved, so unresolved macros no longer look like silent zero-distance moves.
- Fixed macro expression resolution so hover values and Chronoblade estimates can follow alias macros inside dependent expressions and Fanuc math functions.
- Fixed macro hover lookup so aliases created by `KAIJU Alias`, such as `#op1_plane`, resolve back to their numbered macro definitions.
- Fixed missing-decimal warnings so named alias macros like `#r1_2_trigon` are not mistaken for address values.
- Added `kaijuNC.alias.caseSensitive`, defaulting to case-insensitive alias matching so uppercased aliases can still be toggled back to numeric macros.
- Fixed `KAIJU Reconstructor` so named alias macros like `#part_od` keep their original casing while code is normalized.
- Added `kaijuNC.orphanKiller.ignoredMacros` so Orphan Killer can ignore page-range style macro lists like `100, 123, 3000-4000`; it defaults to `1001-`.
- Added highlighting for `H` milling height/tool-length offset codes, using a softer green companion color to `T` codes.

## [0.1.0] - 2026-05-19

- Initial release of KAIJU.NC.
- Fixed zero-padded cutting moves like `G01`, `G02`, and `G03` so they keep the yellow motion-code highlight.
- Added `KAIJU Chronoblade` hover estimates for `G1`, `G2`, and `G3` moves.
- Added best-effort compact editor group sizing for the `KAIJU Orphan Killer` side panel, with a configurable target width.
- Tightened the `KAIJU Orphan Killer` report layout so the macro/name/line columns use compact content-based sizing.
- Added a `Name` column to `KAIJU Orphan Killer` results when a macro has an alias/comment name.
- Fixed `KAIJU Orphan Killer` so aliases created by `KAIJU Alias` are matched back to their numeric macro definitions.
- Disabled VS Code default color decorators for `gcode` mode so macro variables like `#100` are not treated as fallback CSS colors.
- Associated supported NC/G-code file extensions with `gcode` mode by default so color decorators stay disabled across those file types.
- Fixed tool-range decorations when tool calls use aliases created by `KAIJU Alias`.
