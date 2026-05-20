# Change Log

All notable changes to the "KAIJU.NC" extension will be documented in this file.

## [Unreleased]

## [0.1.1] - 2026-05-20

- Fixed macro expression resolution so hover values and Chronometer estimates can follow alias macros inside dependent expressions and Fanuc math functions.
- Fixed macro hover lookup so aliases created by `KAIJU Alias`, such as `#op1_bore_plane`, resolve back to their numbered macro definitions.
- Fixed missing-decimal warnings so named alias macros like `#r1_2_rh_shiage_trigon` are not mistaken for address values.
- Added `kaijuNC.alias.caseSensitive`, defaulting to case-insensitive alias matching so uppercased aliases can still be toggled back to numeric macros.
- Fixed `KAIJU Reconstructor` so named alias macros like `#part_od` keep their original casing while code is normalized.
- Added `kaijuNC.orphanKiller.ignoredMacros` so Orphan Killer can ignore page-range style macro lists like `100, 123, 3000-4000`; it defaults to `1001-`.
- Added highlighting for `H` milling height/tool-length offset codes, using a softer green companion color to `T` codes.

## [0.1.0] - 2026-05-19

- Initial release of KAIJU.NC.
- Fixed zero-padded cutting moves like `G01`, `G02`, and `G03` so they keep the yellow motion-code highlight.
- Added `KAIJU Chronometer` hover estimates for `G1`, `G2`, and `G3` moves.
- Added best-effort compact editor group sizing for the `KAIJU Orphan Killer` side panel, with a configurable target width.
- Tightened the `KAIJU Orphan Killer` report layout so the macro/name/line columns use compact content-based sizing.
- Added a `Name` column to `KAIJU Orphan Killer` results when a macro has an alias/comment name.
- Fixed `KAIJU Orphan Killer` so aliases created by `KAIJU Alias` are matched back to their numeric macro definitions.
- Disabled VS Code default color decorators for `gcode` mode so macro variables like `#100` are not treated as fallback CSS colors.
- Associated supported NC/G-code file extensions with `gcode` mode by default so color decorators stay disabled across those file types.
- Fixed tool-range decorations when tool calls use aliases created by `KAIJU Alias`.
