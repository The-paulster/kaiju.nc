# KAIJU Chronoblade

**Sources:** `src/kaijuChronoblade/`

## Responsibility

Chronoblade presents a compact cycle-time report for the active G-code document
or selected range. It owns the command/webview lifecycle, report layout, row
presentation, and Chronoblade-specific options.

The report does not repeat a title, range, or source-file metadata inside the
webview; the VS Code tab title supplies the feature name.
Its webview uses a minimal 2px top inset, keeping the report close to the tab
without changing its side or bottom spacing.

Chronoblade uses the active editor selection when it opens; its report does
not include controls to resend the whole program or selection.

Chronoblade offers the same per-program Trace methodology as Vision: Motion
defaults to Trace and can be changed per program to As written, Line selects
Source or Trace identifiers, and Live refreshes the open report after a
successful passive Trace update. Source
rows use non-unique `S###` identifiers; Trace rows use unique execution-order
`T###` identifiers. Trace expands loop/GOTO occurrences using the shared
execution stream, while As written analyses each authored line once. An
unusable Trace falls back to as-written timing and displays a hoverable warning.

Timing assumptions are explained on hover: the G0 rate field and G0 summary
describe rapid timing, while tool-swap and extra-station fields state their
respective seconds-based timing contributions.

Reusable timing profiles are configured through
`kaijuNC.chronoblade.timingProfiles` in Settings. Each profile may supply G0,
tool-swap, and extra-station defaults plus literal M-code durations in
`customTimes`, such as `{ "M05": 3, "M86": 10 }`. Chronoblade's Profile
selector includes an Edit action that opens a bare-bones profile editor. It
selects or creates profiles and manages literal M-code/time pairs while saving
back to the same Settings value. The selector is saved per program; selecting a
profile resets that program's three timing-field overrides. Matched M-codes
produce individual `Other` rows and contribute to the Other summary. Trace
mode charges every executed occurrence, including loop repetitions.

The three timing fields, Motion/Line selectors, and vertically stacked display
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
The timing-input labels use a fixed compact column, keeping each value field
close to its label.

Its N-label separator rows can be collapsed in the report to hide the ordinary
rows belonging to that label section; this is presentation-only and does not
alter the cycle-time analysis. Each label displays the accumulated estimated
time through its own section.

The report also offers display toggles for trailing-zero suppression (while
retaining G-code decimal points) and hiding zero-time label sections. Both
are configurable through the Chronoblade settings; trailing-zero suppression
defaults off, while hiding zero-time sections defaults on.

Chronoblade virtualises its report table: it retains the calculated rows as
compact report data but creates DOM rows only for the visible scroll area.
Large programs therefore preserve scrolling, N-label collapse controls,
accumulated totals, and display toggles without creating a browser node for
every motion.

## Connections

- Consumes `MetaMotionEngine` analysis and human-readable row data.
- Consumes `MetaExecutionTrace` occurrence streams and the shared formatted
  Trace-line mapping when Trace motion is selected.
- Passes the same enriched Trace snapshot to Decomposition for formatted line
  data; this does not execute the program a second time.
- Its options use the active program's `MetaMachineMode` profile, falling back
  to Settings until that program has been assigned a profile.
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
