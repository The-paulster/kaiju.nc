# KAIJU Chronoblade

**Sources:** `src/kaijuChronoblade/`

## Responsibility

Chronoblade presents a compact cycle-time report for the active G-code document
or selected range. It owns the command/webview lifecycle, report layout, row
presentation, and Chronoblade-specific options.

Its N-label separator rows can be collapsed in the report to hide the ordinary
rows belonging to that label section; this is presentation-only and does not
alter the cycle-time analysis. Each label displays the accumulated estimated
time through its own section.

The report also offers display toggles for trailing-zero suppression (while
retaining G-code decimal points) and hiding zero-time label sections. Both
are configurable through the Chronoblade settings; trailing-zero suppression
defaults off, while hiding zero-time sections defaults on.

## Connections

- Consumes `MetaMotionEngine` analysis and human-readable row data.
- Its options derive machine defaults from `MetaMachineMode`.
- Shares motion interpretation with Sense and Vision; it must not implement an
  independent timing or modal parser.

## Boundary

Chronoblade is a report, not a motion engine or simulator. Keep time and RPM
semantics in Meta; keep its own changes to report UI and options. If shared
analysis changes, verify its Sense and Vision consumers too.
