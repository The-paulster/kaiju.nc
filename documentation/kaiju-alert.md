# KAIJU Alert

**Sources:** `src/kaijuAlert/`

## Responsibility

KAIJU Alert produces editor diagnostics for suspicious G-code and exposes the
feature's configuration reads. It owns diagnostic construction, severity,
messages, refresh lifecycle, and false-positive avoidance.

## Connections

- Uses `MetaTextRanges` to exclude comments and angle-bracket text before
  scanning.
- Consults Alias state/options where alias-aware diagnostics need that context.
- Consumes `MetaMotionEngine`'s one-pass document arc geometry validation for
  explicit `G2`/`G3` diagnostics, using the active program's machine profile X
  radius/diameter mode.
- Uses the active program's shared G-code dialect through `MetaMotionEngine`;
  Alert does not maintain controller-code mappings.
- Is activated by the Extension Host; Quick Toggles can change one of its
  settings but do not create Alert diagnostics.

## Boundary

Alert flags issues; it does not format, edit, interpret motion, or resolve
macros beyond the narrowly required diagnostic context. Keep diagnostics
optional when they could be controller- or shop-style dependent, and test both
positive cases and near-miss false positives.

The `illegalArcs.enabled` alert reports only definite geometry errors: missing
or conflicting arc definitions, impossible `R` geometry, and centre-offset
radius mismatches. `illegalArcs.tolerance` controls the permitted radius
difference in program units and defaults to `0.001`, preventing routine
rounding noise from becoming an error. It deliberately does not claim a
controller-specific arc format is illegal when the active profile lacks that
controller convention.
