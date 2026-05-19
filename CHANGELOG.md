# Change Log

All notable changes to the "KAIJU.NC" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Added `KAIJU Chronometer` hover estimates for `G1`, `G2`, and `G3` moves.
- Added best-effort compact editor group sizing for the `KAIJU Orphan Killer` side panel, with a configurable target width.
- Tightened the `KAIJU Orphan Killer` report layout so the macro/name/line columns use compact content-based sizing.
- Added a `Name` column to `KAIJU Orphan Killer` results when a macro has an alias/comment name.
- Fixed `KAIJU Orphan Killer` so aliases created by `KAIJU Alias` are matched back to their numeric macro definitions.
- Disabled VS Code default color decorators for `gcode` mode so macro variables like `#100` are not treated as fallback CSS colors.
- Associated supported NC/G-code file extensions with `gcode` mode by default so color decorators stay disabled across those file types.
- Fixed tool-range decorations when tool calls use aliases created by `KAIJU Alias`.

## [0.1.0] - 2026-05-19

- Initial release of KAIJU.NC.
