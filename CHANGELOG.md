# Change Log

All notable changes to the "KAIJU.NC" extension will be documented in this file.

## [Unreleased]

- Added `KAIJU Decomposition`, a right-click temporary-file view that flattens resolvable macro expressions and simple macro control flow while prompting for manual values when the source is non-deterministic.
- Added `kaijuNC.decomposition.comparisonTolerance` for KAIJU Decomposition macro comparisons.
- Added `KAIJU flow` comments to Decomposition output when jumps, conditionals, or loops affect the flattened path.
- Made KAIJU Decomposition format its temporary output with KAIJU Reconstructor.
- Added `KAIJU Sense` motion hovers for `G0`, `G1`, `G2`, and `G3`, combining the old Chronoblade timing hover with path geometry details.
- Added Sense geometry details for linear moves, including axis deltas and angle from the X axis.
- Added Sense geometry details for arcs, including direction, plane, center, radius, sweep degrees, circle length, and endpoint deltas.
- Added `KAIJU Vision`, a right-click 2D SVG path preview for whole programs or selected sections with `X-Z`, `X-Y`, and `Z-Y` plane views.
- Added KAIJU Vision fit/zoom controls and a compact positive/negative axis compass.
- Added KAIJU Vision path direction arrows and compact stacked endpoint labels with finishing line numbers.
- Added a KAIJU Vision start-point marker and anchored endpoint labels so tags stay aligned to their points.
- Added `kaijuNC.vision.g53.x`, `kaijuNC.vision.g53.y`, and `kaijuNC.vision.g53.z` so KAIJU Vision can place `G53` machine-coordinate moves at configured preview coordinates.
- Added KAIJU Vision mouse-wheel zoom, drag panning, configurable line thickness, configurable arrow size, and a locked eight-row result table.
- Added a KAIJU Vision toggle for dashed zero reference lines.
- Made the KAIJU Vision viewport and SVG coordinate view square so paths keep a consistent visual scale.
- Made KAIJU Vision paths, arrows, endpoint labels, and compass stay screen-sized while zooming, and removed the framed viewer background.
- Added `Save SVG` export from KAIJU Vision.
- Added `kaijuNC.vision.plane`, `kaijuNC.vision.xAxisMode`, `kaijuNC.vision.g53.x`, `kaijuNC.vision.g53.y`, `kaijuNC.vision.g53.z`, `kaijuNC.vision.xyOrientation`, `kaijuNC.vision.xzOrientation`, `kaijuNC.vision.zyOrientation`, `kaijuNC.vision.cssSurfaceSpeedUnit`, `kaijuNC.vision.samples`, `kaijuNC.vision.compactPanelWidth`, `kaijuNC.vision.lineThickness`, `kaijuNC.vision.arrowSize`, `kaijuNC.vision.endpointSize`, `kaijuNC.vision.startPointSize`, `kaijuNC.vision.labelFontSize`, `kaijuNC.vision.labelOffset`, `kaijuNC.vision.compassSize`, `kaijuNC.vision.compassOffsetX`, `kaijuNC.vision.compassOffsetY`, and `kaijuNC.vision.rapidRate`.
- Renamed the shared Chronoblade analysis module to `motionEngine` so Sense and Chronoblade can reuse the same motion state, geometry, and timing logic.
- Fixed X-Z arc handedness so `G2` displays clockwise in the default lathe-style Vision orientation.
- Fixed KAIJU Vision diameter-mode drawing so X-Z fillets use physical X travel while endpoint labels keep programmed X coordinates.
- Fixed KAIJU Vision so `G10` coordinate-setting lines are not drawn as modal motion or used as tool-position updates.
- Fixed KAIJU Sense linear angles in diameter X mode so they use physical X travel instead of programmed diameter delta.
- Added a right-click `KAIJU Chronoblade` cycle-time report webview with whole-program and selection sends, `G0` rapid timing, tool swap timing, and per-line motion/tool rows.
- Added `kaijuNC.chronoblade.compactPanelWidth` so the Chronoblade report width can be configured separately from Orphan Killer.
- Added `kaijuNC.sense.enabled`, `kaijuNC.sense.xAxisMode`, `kaijuNC.sense.cssSurfaceSpeedUnit`, `kaijuNC.sense.samples`, and `kaijuNC.sense.rapidRate` for the new KAIJU Sense hover.
- Added `kaijuNC.syntax.toolDecorations.enabled` so tool-range gutter markers can be toggled from the new Syntax settings category.
- Added `kaijuNC.format.leadingWhitespace` and `kaijuNC.format.softTabSize`, defaulting to preserving leading tabs and full 4-space soft-tabs while removing stray leading spaces and still auto-indenting `WHILE`/`END` blocks using the detected indent style.
- Fixed `KAIJU Reconstructor` operator spacing for named alias macro math, such as `#foo-#bar`.
- Split extension settings into Reconstructor, Alias, Orphan Killer, Sense, Vision, and Chronoblade categories in the VS Code Settings UI.
- Split Chronoblade into shared motion analysis, Sense hover, and webview modules so calculation changes flow through both UI surfaces.

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
