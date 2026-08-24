# Changelog

All notable changes to the "KAIJU.NC" extension will be documented in this file.

- Added Chronoblade Trace/As-written motion, Source/Trace line identifiers, and
  a saved Live refresh control. Chronoblade now reuses the shared execution
  stream and formatted Trace-line mapping used by Vision.

- Matched KAIJU Vision's Trace-warning colour to Chronoblade's theme warning
  colour.

- Compacted Chronoblade's top controls into aligned timing, Trace-selector, and
  display-toggle columns, reducing unused space above the report table.

- Made Chronoblade's report table fill the remaining panel height.

- Added reusable Chronoblade timing profiles, a saved per-program Profile
  selector with a bare-bones profile editor, and custom M-code timing rows
  that contribute to Other.

- Simplified the KAIJU Chronoblade report header by removing redundant range,
  source-file, whole-program, selection metadata, and the duplicate in-panel
  title.

- Removed Chronoblade's obsolete Send Whole Program and Send Selection buttons.

- Moved Chronoblade timing guidance into hover tooltips for its G0 rate, G0
  summary, tool-swap time, and extra-station time.

- Compacted Chronoblade's timing controls and display toggles into side-by-side
  vertical stacks with concise labels and explanatory hover text.

- Fixed Chronoblade's compact toggle layout so checkbox labels no longer wrap
  into fragments and both control columns align at the top.

- Moved Chronoblade's summary cards beside its controls in a two-row grid, and
  added Cutting distance plus an `Other` time placeholder.

- Moved Chronoblade's equal-width, non-wrapping summary cards to the left of
  its timing controls and shortened their minute notation to `m`.

- Tightened Chronoblade's timing-input label column so its value fields no
  longer drift away from their labels.

- Reduced Chronoblade's top webview inset to a minimal 2px.

## [0.5.0]

- Added compact KAIJU Vision playback with a classic Play control, automatic and manual execution
  traversal, a five-line Source/Trace context view, a dockable right-side macro list with Number and
  Recently updated sorting, and a non-clipping Value column. Macro values default to three decimal
  places, retaining an explicitly assigned precision up to six; the new
  `kaijuNC.vision.playbackMacroSignificantFiguresOnly` setting trims insignificant zeroes instead.
  Geometry fades based only on completed motions. Playback opens frozen at its first event, changes
  the compact far-right Play action to red Stop, and returns to ordinary Vision when stopped; Live
  stays an independent horizontal refresh control, and the zoom readout sits beside the G0/G1
  legend.
  Its Trace snapshot never re-evaluates while scrubbing or accepts Live refreshes. Its current-
  position dot uses motion, tool, macro, M-command, spindle, compensation, or dark-blue flow
  colours, all included in Vision's persistent legend. Added a bottom-of-view playback Position
  strip that retains every source-used axis.

- Added source-editor navigation from KAIJU Vision playback: clicking a Source or Trace context line
  reveals and selects its authored G-code line.

- Fixed KAIJU Vision playback's current-position dot so combined spindle blocks such as
  `G96 S[#139] M04` use the red spindle colour instead of the light-blue M-command colour.

- Changed KAIJU Vision's machine-mode plane default to X-Y for mill and X-Z for lathe, and reset
  the active program's saved Vision plane when its machine mode changes.

- Fixed fresh KAIJU Vision reports falling back to X-Y when no per-program plane had been saved;
  mill now opens in X-Y and either lathe mode opens in X-Z as configured.

- Improved large-program responsiveness: passive KAIJU Trace runs no longer create rendered
  per-occurrence execution records during file opening. The full trace remains available on demand
  for Vision and Playback, while Trace health and Sense macro history remain current.

- Fixed KAIJU Alert causing long file-open stalls on milling programs by validating every explicit
  arc in one forward modal-state pass instead of replaying the program from the beginning for each
  source line.

- Added `kaijuNC.alerts.illegalArcs.tolerance`, defaulting to `0.001` program units, so small
  centre-offset and R-radius rounding differences do not appear as illegal-arc errors.

- Fixed KAIJU Chronoblade exhausting memory on large programs by virtualising its report table.
  It now renders only the visible rows while preserving scrolling, N-label collapse controls,
  accumulated totals, and display toggles.

- Added a saved KAIJU Vision Live toggle that refreshes the open report after its source program's
  Trace recompiles. If a new Trace cannot be used, Vision keeps the last usable report and shows a
  hoverable Live warning that it is not current.

- Added Apply and Reset to defaults actions to KAIJU Vision's Data > Offsets panel, matching the
  Macro values panel and removing saved per-program offsets on reset.

## [0.4.0]

- Added saved per-program KAIJU Vision controls and a Macro values drawer for saved missing initial
  values or optional header-initialisation overrides.

- Removed Warpaint and its on/off toggle from the editor context menu while its authoring workflow
  is being reconsidered; its Settings option and decoration module remain available.

- Fixed KAIJU Trace's status-bar indicator failing to appear because its synchronous running-state
  notification could recursively restart the trace.

- Improved KAIJU Vision node data so Source-line mode preserves authored macro expressions, while
  Trace-line mode shows the exact unique Decomposition output line number and fully substituted
  instruction for each execution occurrence; changing the line-data toggle now refreshes cached node
  tooltips immediately.

- Added KAIJU Vision Trace motion with saved per-program macro inputs, safety warnings,
  Trace/As-written motion selection, and source/trace node-line inspection; hid the redundant bottom
  motion table.

- Added Ctrl/Cmd-click macro navigation in the G-code editor, targeting the Alias-style source line
  when one exists.

- Clarified KAIJU Sense macro hovers by showing the Alias-style variable name separately from its
  first static assignment and resolved startup value.

- Added KAIJU Trace: a debounced passive macro execution cache with loop/GOTO traversal,
  assumed-zero input reporting, a right-side health status item, and first-five/last-five loop
  values in KAIJU Sense macro hovers.

- Added an optional Kaiju Alert error for explicit `G2`/`G3` arcs that have definite geometric
  errors, controlled by `kaijuNC.alerts.illegalArcs.enabled`.

- Improved KAIJU Chronoblade's compact report table with centered minimum-width Line and Code
  columns, a tighter Spindle/RPM layout, `-` for unknown times, no unknown-time warning banner, and
  a single fixed-RPM value instead of a redundant range.

- Added collapsible N-label sections to KAIJU Chronoblade reports with accumulated time through each
  section.

- Added Chronoblade report toggles and settings for significant-figures display and hiding zero-time
  label sections, with zero-time sections hidden by default.

- Fixed KAIJU Vision merged nodes so ordinary endpoint dots no longer paint over a semantic marker
  at the same position.

- Removed KAIJU Vision's inactive Send Whole Program and Send Selection controls, and added a Legend
  toggle that keeps the complete semantic-marker legend visible.

- Added an `AGENTS.md` architecture guide and module-responsibility documentation for KAIJU.NC
  features and shared Meta capabilities.

- Added Decomposition defaults from initial macro comments with trailing numeric braces, such as
  `(#109 Tool life counter 5 {0})` for `#109 = 0`.

- Fixed KAIJU Alias parsing so trailing curly-brace annotations such as `{0}` do not become part of
  a generated alias name.

- Improved KAIJU Decomposition trace notes with concise syntax-colored `/assignment`, `/comparison`,
  and `/flow` comments that show resolved macro values, evaluated comparisons, results, and
  conditional bodies.

- Added `kaijuNC.sense.modalNames` so verbose KAIJU Sense status-bar modal labels can be overridden
  per code.

- Expanded the KAIJU Sense status-bar modal readout with profile-aware mill and lathe labels for
  distance, units, arc-centre distance, canned cycles and return mode, compensation, tool length,
  extended work offsets, path control, rotation, scaling, spindle state, coolant, and lathe
  cycles/axis programming.

- Added `AND` support to KAIJU Decomposition compound conditions such as `IF[[#105 NE 1.000] AND
  [#105 NE 2.000]] THEN #3000 = 1.000`.

- Fixed KAIJU Sense macro hovers so comment-only macro names like `(#105 = previous removed depth
  [mm])` or `(#105 previous removed depth [mm])` still appear when the macro value is unresolved.

- Fixed KAIJU Chronoblade CSS timing at X0 so centerline moves use the active RPM limit instead of
  reporting unknown time.

- Fixed KAIJU Chronoblade rapid and dwell rows so they no longer display the modal cutting feedrate,
  and counted `G04` dwell time separately from cutting time.

- Improved KAIJU Vision performance for dense programs by drawing toolpaths and arrows on batched
  canvas, virtualizing the motion table, caching projected geometry, caching merged labels by zoom
  bucket with a configurable 128 MB default cache, viewport-culling overlays, removing SVG export,
  and sampling only curved moves.

- Fixed KAIJU Vision's label toggle so it also hides merged label text, renamed it to Labels, and
  added an Endpoints toggle for hiding endpoint dots without hiding toolpaths.

- Added KAIJU Vision endpoint marker colors for program ends, optional stops, spindle speed changes,
  compensation/offset changes, and compensation cancels, including configurable larger split-color
  markers and a hover legend for semantic endpoint colors.

- Changed KAIJU Vision to fill the available viewer space without forcing a square viewport, with
  marker and label sizing based on viewer height.

- Added configurable KAIJU Decomposition execution and output limits with
  `kaijuNC.decomposition.maxExecutionSteps` and `kaijuNC.decomposition.maxOutputLines`.

- Added an optional Kaiju Alert error for adjacent math operators such as `1.00*-2.00`, controlled
  by `kaijuNC.alerts.adjacentOperators.enabled`.

- Changed KAIJU Vision tool-change markers and merged-marker legend slices to use the same neon lime
  color as T-code syntax highlighting.

- Added KAIJU Warpaint for live, per-file section coloring from N-label ranges such as `10-100,
  200-300`, with named colors, per-section enable toggles, priority ordering, `Copy From...`,
  optional soft background tinting, overview-ruler markers, and compact gutter markers that combine
  the active tool with the top two matching Warpaint sections.

- Added a bottom right-click KAIJU Quick Toggles submenu for Warpaint and out-of-order N-label
  alerts.

- Added `Ctrl+Alt+W` / `Cmd+Alt+W` for KAIJU Warpaint and `Ctrl+Alt+Shift+W` / `Cmd+Alt+Shift+W` for
  toggling Warpaint.

- Moved the main KAIJU editor right-click commands into their own top context-menu section instead
  of sharing VS Code's navigation group.

- Added Warpaint panel actions for creating a new top-priority paint named from the selected N-label
  range, or appending the current selection to an existing paint.

- Changed new KAIJU Warpaint sections to start with seeded program-specific colors instead of
  reusing the same default color each time.

## [0.3.0]

- Fixed syntax highlighting for compact CNC blocks without spaces, such as
  `N10G00X200.000Y200.00S3000M03`, using the same letter-plus-value boundaries recognized by KAIJU
  Reconstructor.

- Made KAIJU Decomposition traces close without prompting to save their temporary contents.

- Added Ctrl+Click navigation and a small hover hint for `GOTO` label targets.

- Removed duplicate decoration text from `GOTO` target hovers so they only show the target
  information.

- Tightened GOTO label-reference hover highlights so they clear sooner without changing VS Code's
  normal hover appearance delay.

- Updated KAIJU Decomposition manual-input prompts to include the alias/comment label for unknown
  macros, such as `#101 - input start diameter`.

- Fixed KAIJU Decomposition so later uses of a macro assigned by the program do not prompt for
  manual input just because the assigned expression could not be reduced.

- Fixed KAIJU Decomposition `GOTO` resolution so leading-zero labels and targets like `GOTO 091` and
  `N91` match consistently.

- Fixed KAIJU Decomposition macro-expression evaluation so CNC-style leading-zero numbers like
  `00.50` work inside larger expressions.

- Fixed macro-expression evaluation so compact binary operators like `32.500 +32.0` remain intact
  during numeric normalization.

- Added a KAIJU Syntax error for `GOTO` targets that do not have a matching `N` label.

- Added inline reference decorations after `N` labels targeted by `GOTO` statements.

- Added KAIJU Sense hover details and amber line highlighting for `GOTO` label references.

- Added a left-side KAIJU Sense cursor-state status bar readout backed by modal-code definitions,
  with verbose labels like `G00 (Rapid)` / `M08 (Coolant on)` or compact codes like `G00 M08`.

- Added optional syntax-style colors for the KAIJU Sense cursor-state status bar.

- Added an `Alias: On` / `Alias: Off` / `Alias: Mixed` right-side status bar indicator for KAIJU
  Alias mode.

- Added optional colors for the right-side machine-mode and alias-mode status bar indicators.

- Added a Kaiju Alert error for mixed KAIJU Alias mode when alias macros and their original numeric
  macros are both used in one document.

- Added a Kaiju Alert error for undefined KAIJU Alias names like `#ap_5` when no matching alias
  definition exists before the first G/M block.

- Delayed undefined KAIJU Alias errors until typing pauses so partial alias names do not stay
  flagged mid-edit.

- Added a non-blocking KAIJU Alert warning when an existing `GOTO` target stops being forked after
  duplicate `N` labels are reduced to one, with formatted details available from the alert.

- Expanded the comment-bracket Kaiju Alert so separate comment pairs like `()()` are warned
  alongside nested pairs like `(())`.

- Added a right-side configured machine-mode status bar indicator for Mill, Lathe - Radius, and
  Lathe - Diameter.

- Added KAIJU Rangefinder for selecting current tool ranges, picked tool ranges, N-label spans, and
  the current N block.

- Added a `Ctrl+Alt+F` / `Cmd+Alt+F` shortcut for KAIJU Rangefinder.

- Clarified KAIJU Decomposition as a readable execution trace for inspecting and debugging
  macro-driven G-code, not verified machine-ready output.

- Added shared human-display decimal formatting with configurable minimum and maximum decimal
  places, defaulting to three.

- Added an experimental syntax-colored KAIJU Sense hover value mode for testing; it is currently
  less readable than the default compact hover.

- Added `N` label separator rows to KAIJU Chronoblade reports so program position is easier to
  follow.

- Added `N` label separator rows to the KAIJU Vision motion list.

- Added per-`N` label section totals to KAIJU Chronoblade label separator rows.

- Added narrow tool-color marker columns to the KAIJU Chronoblade and KAIJU Vision webview lists.

- Kept KAIJU Chronoblade label section totals focused on `Total: <time>` without appending
  unknown-row text.

- Showed `Tool change` in webview distance columns for tool-change rows instead of a generic unknown
  value.

- Showed zero-distance motion rows as `0.00` in webview distance columns instead of a generic
  unknown value.

- Added `kaijuNC.vision.zoomStep` and `kaijuNC.vision.wheelZoomStep`, defaulting KAIJU Vision zoom
  controls to larger steps.

- Added a small dark outline to KAIJU Vision endpoint labels so they stay readable over path lines.

- Increased the default KAIJU Vision endpoint/start label font size.

- Brightened and strengthened KAIJU Vision's tool-color path strokes while leaving the shared tool
  decoration colors unchanged.

- Added experimental KAIJU Vision endpoint label avoidance with connector lines, defaulting off
  while the layout behavior is still being tuned.

- Added KAIJU Vision tool-change markers with under-layer green dots and gutter-colored tool
  transition labels.

- Added right-click KAIJU Machine Mode commands for Mill, Lathe (Radius), and Lathe (Diameter), with
  matching Chronoblade/Sense/Vision X-axis settings and motion-analysis feed defaults.

- Added Kaiju Alert checks for duplicate and out-of-order `N` sequence numbers, each with its own
  setting.

- Fixed S-code syntax highlighting so decimal spindle values like `S665.000` are colored as one
  complete S word.

## [0.2.0]

- Added `{...}` as a nested parenthesis-comment highlight style with color `#708E9C`.

- Renamed KAIJU diagnostic hover source text from `Powerful GCode` to `Kaiju Alert`.

- Updated macro variable hovers to use the same `KAIJU Sense` title style as motion hovers.

- Added a warning for nested parenthesis comments such as `((NOTE))`, and made KAIJU Reconstructor
  convert the inner layer to square brackets.

- Added `kaijuNC.alerts.nonAscii.enabled`, defaulting on, to warn about non-ASCII characters that
  some lathe controls may not read reliably.

- Added separate highlighting for parenthesis comments that start with `(=`.

- Added `KAIJU Decomposition`, a right-click temporary-file view that flattens resolvable macro
  expressions and simple macro control flow while prompting for manual values when the source is
  non-deterministic.

- Added `kaijuNC.decomposition.comparisonTolerance` for KAIJU Decomposition macro comparisons.

- Added `KAIJU flow` comments to Decomposition output when jumps, conditionals, or loops affect the
  flattened path.

- Made KAIJU Decomposition format its temporary output with KAIJU Reconstructor.

- Added `KAIJU Sense` motion hovers for `G0`, `G1`, `G2`, and `G3`, combining the old Chronoblade
  timing hover with path geometry details.

- Added Sense geometry details for linear moves, including axis deltas and angle from the X axis.

- Added Sense geometry details for arcs, including direction, plane, center, radius, sweep degrees,
  circle length, and endpoint deltas.

- Added `KAIJU Vision`, a right-click 2D SVG path preview for whole programs or selected sections
  with `X-Z`, `X-Y`, and `Z-Y` plane views.

- Added KAIJU Vision fit/zoom controls and a compact positive/negative axis compass.

- Added KAIJU Vision path direction arrows and compact stacked endpoint labels with finishing line
  numbers.

- Added a KAIJU Vision start-point marker and anchored endpoint labels so tags stay aligned to their
  points.

- Added `kaijuNC.vision.g53.x`, `kaijuNC.vision.g53.y`, and `kaijuNC.vision.g53.z` so KAIJU Vision
  can place `G53` machine-coordinate moves at configured preview coordinates.

- Added a KAIJU Vision page toggle for coloring path lines with the same tool colors used by gutter
  tool decorations.

- Extracted shared tool range and color logic into `MetaToolModel.js` so motion analysis no longer
  depends on the Sense gutter decoration module.

- Added KAIJU Vision mouse-wheel zoom, drag panning, configurable line thickness, configurable arrow
  size, and a locked eight-row result table.

- Added a KAIJU Vision toggle for dashed zero reference lines.

- Made the KAIJU Vision viewport and SVG coordinate view square so paths keep a consistent visual
  scale.

- Made KAIJU Vision paths, arrows, endpoint labels, and compass stay screen-sized while zooming, and
  removed the framed viewer background.

- Added `Save SVG` export from KAIJU Vision.

- Added `kaijuNC.vision.plane`, `kaijuNC.vision.xAxisMode`, `kaijuNC.vision.g53.x`,
  `kaijuNC.vision.g53.y`, `kaijuNC.vision.g53.z`, `kaijuNC.vision.xyOrientation`,
  `kaijuNC.vision.xzOrientation`, `kaijuNC.vision.zyOrientation`,
  `kaijuNC.vision.cssSurfaceSpeedUnit`, `kaijuNC.vision.samples`,
  `kaijuNC.vision.compactPanelWidth`, `kaijuNC.vision.lineThickness`, `kaijuNC.vision.arrowSize`,
  `kaijuNC.vision.endpointSize`, `kaijuNC.vision.startPointSize`, `kaijuNC.vision.labelFontSize`,
  `kaijuNC.vision.labelOffset`, `kaijuNC.vision.compassSize`, `kaijuNC.vision.compassOffsetX`,
  `kaijuNC.vision.compassOffsetY`, and `kaijuNC.vision.rapidRate`.

- Renamed the shared Chronoblade analysis module to `motionEngine` so Sense and Chronoblade can
  reuse the same motion state, geometry, and timing logic.

- Fixed X-Z arc handedness so `G2` displays clockwise in the default lathe-style Vision orientation.

- Fixed KAIJU Vision diameter-mode drawing so X-Z fillets use physical X travel while endpoint
  labels keep programmed X coordinates.

- Fixed KAIJU Vision so `G10` coordinate-setting lines are not drawn as modal motion or used as
  tool-position updates.

- Fixed KAIJU Sense linear angles in diameter X mode so they use physical X travel instead of
  programmed diameter delta.

- Added a diagnostic error for address words accidentally placed inside bracket expressions, such as
  `[F#121 * 0.600]`.

- Added a right-click `KAIJU Chronoblade` cycle-time report webview with whole-program and selection
  sends, `G0` rapid timing, tool swap timing, and per-line motion/tool rows.

- Added `kaijuNC.chronoblade.compactPanelWidth` so the Chronoblade report width can be configured
  separately from Orphan Killer.

- Added `kaijuNC.sense.enabled`, `kaijuNC.sense.xAxisMode`, `kaijuNC.sense.cssSurfaceSpeedUnit`,
  `kaijuNC.sense.samples`, and `kaijuNC.sense.rapidRate` for the new KAIJU Sense hover.

- Added `kaijuNC.syntax.toolDecorations.enabled` so tool-range gutter markers can be toggled from
  the new Syntax settings category.

- Added `kaijuNC.format.leadingWhitespace` and `kaijuNC.format.softTabSize`, defaulting to
  preserving leading tabs and full 4-space soft-tabs while removing stray leading spaces and still
  auto-indenting `WHILE`/`END` blocks using the detected indent style.

- Fixed `KAIJU Reconstructor` operator spacing for named alias macro math, such as `#foo-#bar`.

- Fixed `KAIJU Reconstructor` tool-code normalization so `T9` becomes `T09` without assuming a
  lathe-style `T0909` offset.

- Fixed `KAIJU Reconstructor` spacing around `H` tool-length offset words so lines like `G43 Z4.H2`
  can format correctly.

- Split extension settings into Reconstructor, Alias, Orphan Killer, Sense, Vision, and Chronoblade
  categories in the VS Code Settings UI.

- Split Chronoblade into shared motion analysis, Sense hover, and webview modules so calculation
  changes flow through both UI surfaces.

## [0.1.1] - 2026-05-20

- Finished the `KAIJU Chronoblade` naming pass in user-facing hovers, settings descriptions, and
  documentation because it sounds way cooler.

- Fixed `KAIJU Chronoblade` estimates for lathe arcs that use incremental `U/V/W` axis words and `R`
  radius arcs instead of absolute `X/Y/Z` endpoints with `I/J/K` centers.

- Added `KAIJU Chronoblade` warnings when a motion endpoint or feed expression cannot be resolved,
  so unresolved macros no longer look like silent zero-distance moves.

- Fixed macro expression resolution so hover values and Chronoblade estimates can follow alias
  macros inside dependent expressions and Fanuc math functions.

- Fixed macro hover lookup so aliases created by `KAIJU Alias`, such as `#op1_plane`, resolve back
  to their numbered macro definitions.

- Fixed missing-decimal warnings so named alias macros like `#r1_2_trigon` are not mistaken for
  address values.

- Added `kaijuNC.alias.caseSensitive`, defaulting to case-insensitive alias matching so uppercased
  aliases can still be toggled back to numeric macros.

- Fixed `KAIJU Reconstructor` so named alias macros like `#part_od` keep their original casing while
  code is normalized.

- Added `kaijuNC.orphanKiller.ignoredMacros` so Orphan Killer can ignore page-range style macro
  lists like `100, 123, 3000-4000`; it defaults to `1001-`.

- Added highlighting for `H` milling height/tool-length offset codes, using a softer green companion
  color to `T` codes.

## [0.1.0] - 2026-05-19

- Initial release of KAIJU.NC.

- Fixed zero-padded cutting moves like `G01`, `G02`, and `G03` so they keep the yellow motion-code
  highlight.

- Added `KAIJU Chronoblade` hover estimates for `G1`, `G2`, and `G3` moves.

- Added best-effort compact editor group sizing for the `KAIJU Orphan Killer` side panel, with a
  configurable target width.

- Tightened the `KAIJU Orphan Killer` report layout so the macro/name/line columns use compact
  content-based sizing.

- Added a `Name` column to `KAIJU Orphan Killer` results when a macro has an alias/comment name.

- Fixed `KAIJU Orphan Killer` so aliases created by `KAIJU Alias` are matched back to their numeric
  macro definitions.

- Disabled VS Code default color decorators for `gcode` mode so macro variables like `#100` are not
  treated as fallback CSS colors.

- Associated supported NC/G-code file extensions with `gcode` mode by default so color decorators
  stay disabled across those file types.

- Fixed tool-range decorations when tool calls use aliases created by `KAIJU Alias`.
