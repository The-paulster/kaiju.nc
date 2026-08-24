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

Timing assumptions are explained on hover: the G0 rate field and G0 summary
describe rapid timing, while tool-swap and extra-station fields state their
respective seconds-based timing contributions.

The three timing fields form a compact vertical stack beside the vertically
stacked display toggles. Each checkbox remains horizontal with its label. Their
visible labels are concise; full behaviour remains in their hover text.
The toggle column reserves enough width for each label and aligns to the top of
the timing controls, preventing fragmented label wrapping.

The summary cards sit to the left of these controls in a two-row, four-column
grid. All cards have the same minimum width and never wrap their values or
labels. Their compact minute notation uses `m`, such as `6 m 48.5 s`. They show
total and cutting time, G0, dwell, tool time, total distance, cutting distance,
and an `Other` time placeholder, which is currently zero.
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
- Its options derive machine defaults from `MetaMachineMode`.
- Shares motion interpretation with Sense and Vision; it must not implement an
  independent timing or modal parser.

## Boundary

Chronoblade is a report, not a motion engine or simulator. Keep time and RPM
semantics in Meta; keep its own changes to report UI and options. If shared
analysis changes, verify its Sense and Vision consumers too.
