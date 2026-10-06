# KAIJU Chronoblade

**Sources:** `src/kaijuChronoblade/`

## Canned cycles

Profile-bound basic G17/G90 mill drilling uses shared generated rapid/feed/retract moves and existing timing calculations. Marker-only or unsupported drilling formats produce explicit unknown-time rows. Documented-only lathe cycles have no cycle-time implementation.

## Responsibility

Machine-profile G54-G59 X/Y/Z/C defaults and saved program work-offset
overrides feed shared motion analysis. Vision's Apply stores the same overrides
used here, and Reset to defaults restores the active machine's values. Offset
changes refresh an open report. Frame selection alone adds no motion or time;
the next move measures travel between physical positions, including G53 moves
and angular C offsets. The first program move retains the existing omission
when Chronoblade has no known start position.

Chronoblade presents a compact cycle-time report for the active G-code document
or selected range. It owns the command/webview lifecycle, report layout, row
presentation, and Chronoblade-specific options.

The report does not repeat a title, range, or source-file metadata inside the
webview; the VS Code tab title supplies the feature name.
Its webview uses a minimal 2px top inset, keeping the report close to the tab
without changing its side or bottom spacing.

Chronoblade uses the active editor selection when it opens; its report does
not include controls to resend the whole program or selection.
Macro expressions such as `SQRT[...]` and `TAN[...]` are evaluated by the
shared macro engine; their function names do not count as tool commands.

Chronoblade offers the same per-program Trace methodology as Vision: Motion
defaults to Trace and can be changed per program to As written, Line selects
Source or Trace identifiers, and Live refreshes the open report after a
successful passive Trace update. Source
rows use non-unique `S###` identifiers; Trace rows use unique execution-order
`T###` identifiers. Trace expands loop/GOTO occurrences using the shared
execution stream, while As written analyses each authored line once. An
unusable Trace falls back to as-written timing and displays a hoverable warning.

Timing assumptions are explained on hover: the read-only G0 rate and G0 summary
describe rapid timing, while tool-swap and extra-station fields state their
respective seconds-based timing contributions.
Outside polar interpolation, G1 moves with C travel use the shared default
controller-feed length of one linear program unit per C degree, combined with
linear-axis travel. Their report distance and cutting time use that feed length;
it is not the physical cutter path. Machine profiles may instead use scaled
degrees, physical swept distance, or linear-only rotary feed length. C-axis
G0 time becomes available with a configured angular rapid rate; rotary G2/G3
time remains unknown. Axis-specific rapid rates, circular turret indexing,
effective machine/program spindle caps, CSS units, and startup modes all come
from the shared machine context and Motion Engine.

All timing values come from the active regular machine profile returned by
`MetaMachineMode`, including Generic Machine for an unassigned program.
Chronoblade does not read separate timing presets or report-specific timing
fields. Obsolete saved values are ignored on load and dropped the next time
report controls are saved. Its removed Settings entries are rapidRate,
toolChangeSeconds, extraStationSeconds, and timingProfiles.

The report shows the machine name (ellipsis with full hover text), its base
rapid/tool values read-only, and **Edit**, which opens the machine-profile
**Timing** tab for the report's source document. Machine `customTimes` entries
produce individual `Other` rows and contribute to the Other summary. Trace
charges every executed M-code occurrence, including loop repetitions.
Machine changes refresh the open report from the active machine profile.
C-axis wrapping and reset behavior also come from shared machine context.

The three read-only timing values, Motion/Line selectors, and vertically stacked display
toggles form three aligned compact columns. Each checkbox remains horizontal
with its label. Their visible labels are concise; full behaviour remains in
their hover text. The Trace warning uses the spare selector row, so it does not
add vertical whitespace before the report table.

The report table is a flex scroll region and fills all remaining webview height
beneath those controls.

The summary cards sit to the left of these controls in a two-row, four-column
grid. All cards have the same minimum width and never wrap their values or
labels. Their compact minute notation uses `m`, such as `6 m 48.5 s`. They show
total and cutting time, G0, dwell, tool time, total distance, cutting distance,
and time contributed by configured `Other` M-code events.
The timing-value labels use a fixed compact column, keeping each value field
close to its label.

Its N-label separator rows can be collapsed in the report to hide the ordinary
rows belonging to that label section; this is presentation-only and does not
alter the cycle-time analysis. Each label displays the accumulated estimated
time through its own section in Total, alongside that section's own estimated
time in Time.
The per-program **Group labels** toggle folds consecutive executions of the
same source label, or a repeated sequence of up to 32 source labels, into one
summary row. For example, `N103 N103 N103` becomes `N103 ×3`, and
`N102 N103 N104 N102 N103 N104` becomes `N102 → N103 → N104 ×2`.
Each group shows the source label comments beside the N numbers. Long sequences
are shortened visually with an ellipsis; hover shows the complete names, while
the repetition count remains visible.
Clicking the group reveals its original label sections, with their individual
rows, line identifiers, times, and collapse controls. Group Time sums the
actual section estimates; Total is the accumulated label time through the end
of the group. Grouping follows the currently visible labels after the
zero-time filter and never changes calculated totals or execution order.

The report also offers display toggles for trailing-zero suppression (while
retaining G-code decimal points) and hiding zero-time label sections. Both
are configurable through the Chronoblade settings; trailing-zero suppression
defaults off, while hiding zero-time sections defaults on. Group labels defaults
off and is saved per program.

Chronoblade virtualises its report table: it retains the calculated rows as
compact report data but creates DOM rows only for the visible scroll area.
Large programs therefore preserve scrolling, N-label collapse controls,
accumulated totals, and display toggles without creating a browser node for
every motion.

Position cells colour X, Y, Z, and C coordinates to match the editor and Vision;
C uses purple when it appears in the shared motion result.

## Connections

- Consumes `MetaMotionEngine` analysis and human-readable row data.
- Consumes `MetaExecutionTrace` occurrence streams and the shared formatted
  Trace-line mapping when Trace motion is selected.
- Passes the same enriched Trace snapshot to Decomposition for formatted line
  data; this does not execute the program a second time.
- Its timing options always use the active program's `MetaMachineMode` machine
  profile. Legacy machine-type/G-code selection remains supported separately.
- Its modal and timing interpretation uses that program's `MetaGCodeDialect`
  profile. Row `instruction`, `feedModeWord`, and spindle text already carry
  the resolved authored spelling; Chronoblade does not translate controller G
  codes itself.
- Shares motion interpretation with Sense and Vision; it must not implement an
  independent timing or modal parser.

## Boundary

Chronoblade is a report, not a motion engine or simulator. Keep time and RPM
semantics in Meta; keep its own changes to report UI and options. If shared
analysis changes, verify its Sense and Vision consumers too.


`getChronobladeSettingsSnapshot(document)` returns saved report controls and effective options through the existing report resolver for File Settings.
