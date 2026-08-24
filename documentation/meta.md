# Meta Shared Capability Module

**Sources:** root-level `src/Meta*.js` and `src/MetaModalDefs.json`

## Responsibility

Meta is the shared, non-product-UI layer. It owns reusable G-code
interpretation, models, configuration profile definitions, protected-text
helpers, and human display formatting. Meta is a module even though it is not
in a folder: its common contract is that feature modules consume its results
rather than replicate its capabilities.

| Component | Owns | Consumers |
| --- | --- | --- |
| `MetaMotionEngine.js` | Modal state, motion geometry, cycle/time analysis, shared report rows, and status-modal read model | Sense, Vision, Chronoblade |
| `MetaExecutionTrace.js` | Debounced execution-trace cache, macro history, initial-value overrides, assumed-zero inputs, and control-flow safety state | Trace, Sense, Vision, future Alert consumers |
| `MetaMacroEngine.js` | Macro aliases, macro-expression evaluation, normalization, and value resolution | Alias, Sense, Decomposition, Orphan Killer, Tool Model, Motion Engine |
| `MetaToolModel.js` | Tool identity/ranges and stable tool colors | Sense, Rangefinder, Warpaint, Motion Engine |
| `MetaTextRanges.js` | Comment and angle-bracket protected ranges | Features that scan code text; Macro Engine |
| `MetaMachineMode.js` | Configured mill/lathe profiles, commands, and right-side machine/alias status | Sense, Vision, Chronoblade options; Extension Host |
| `MetaHumanFormat.js` | Formatting already-calculated values for UI | Motion Engine and reports |
| `MetaModalDefs.json` | Data-driven status-only modal groups with `millLabel` and `latheLabel` defaults | Motion Engine |

## Boundary

Meta must not own webviews, editor decorations, command-palette flows, or a
feature's settings UI. It can expose data and pure-ish helpers that support
multiple consumers. `MetaHumanFormat` never participates in a calculation;
format after calculating. Motion timing must remain independent of rendering
sampling. Mask comments and angle-bracket text through `MetaTextRanges` before
performing feature-specific scans.

The status-modal definitions may restrict a code to `mill` or `lathe` when a
code has controller-family-dependent meaning, such as `G98`, `G99`, or `G50`.
Meta selects the appropriate profile label; Sense may then apply a user-provided
display-name override without changing modal interpretation.

If only one feature needs a behavior, keep it in that feature. Promote it to
Meta only when it is genuinely reusable and has no product-specific UI policy.
