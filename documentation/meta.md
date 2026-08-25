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
| `MetaMotionEngine.js` | Modal state, motion geometry, one-pass document arc validation, cycle/time and distance summaries, shared report rows including Chronoblade custom timing events, and status-modal read model | Alert, Sense, Vision, Chronoblade |
| `MetaExecutionTrace.js` | Sole control-flow execution pass, debounced cache, occurrence stream, macro history, initial-value overrides, assumed-zero inputs, safety state, and execution-to-formatted-line mapping | Trace, Decomposition, Sense, Vision, Chronoblade, future Alert consumers |
| `MetaMacroEngine.js` | Macro aliases, assignment tokenization, header defaults, expression evaluation, normalization, and value resolution | Alias, Trace, Sense, Decomposition, Orphan Killer, Tool Model, Motion Engine |
| `MetaToolModel.js` | Tool identity/ranges and stable tool colors | Sense, Rangefinder, Warpaint, Motion Engine |
| `MetaTextRanges.js` | Comment and angle-bracket protected ranges plus offset-preserving masking | Features that scan code text; Macro Engine |
| `MetaMachineMode.js` | Per-program mill/lathe profile persistence, Settings fallback, and change notifications | Machine Mode, Alert, Sense, Vision, Chronoblade |
| `MetaGCodeDialect.js` | Versioned canonical G-code operations, validated controller bindings, companion-word requirements, built-in profiles, and the live custom-profile registry | Machine Mode, Motion Engine |
| `MetaHumanFormat.js` | Formatting already-calculated values for UI | Motion Engine and reports |
| `MetaModalDefs.json` | Status-group ordering and non-dialect modal definitions | Motion Engine |

## Boundary

Meta must not own webviews, editor decorations, command-palette flows, or a
feature's settings UI. It can expose data and pure-ish helpers that support
multiple consumers. `MetaHumanFormat` never participates in a calculation;
format after calculating. Motion timing must remain independent of rendering
sampling. Mask comments and angle-bracket text through `MetaTextRanges` before
performing feature-specific scans.

For CSS timing, `MetaMotionEngine` takes an RPM clamp only from `G50 S...`.
It does not infer a spindle limit from a `D` word, whose meaning is
controller- and context-specific.

Controller-dependent meanings such as `G98`, `G99`, and lathe `G50 S...` exist
only in `MetaGCodeDialect`. `MetaModalDefs.json` supplies group ordering and
genuinely non-dialect status codes. Sense may apply a user-provided display
name without changing either source of modal interpretation.

Machine Mode is saved in workspace state by source-document URI when selected
from the KAIJU Machine Mode menu. That per-program profile, including its
radius/diameter X convention, overrides the Settings value for every consumer.
The `kaijuNC.chronoblade.machineMode` setting remains the fallback for programs
that have not yet been assigned a profile.

The same per-program record stores a G-code interpretation profile. The
built-in `FANUC / ISO` profile binds feed/min and feed/rev to `G94` and `G95`.
The built-in `DMG MORI` profile binds those functions to `G98` and `G99` in
turning mode while retaining ISO mill feed modes and mill canned-cycle return
meanings. Auto uses `FANUC / ISO` for Mill and `DMG MORI` for either Lathe mode.

`MetaGCodeDialect` is a deliberately bounded rebinding layer. Authored G words
resolve to stable operations such as `feed.perMinute`, `motion.linear`, or
`spindle.rpmLimit`; `MetaMotionEngine` applies those operations. Bindings may
require a companion word and select its value, as the lathe RPM-limit binding
does with `G50 S...`. Profiles are declarative, validated for conflicts, and
schema-versioned. Each profile owns separate `bindings.mill` and
`bindings.lathe` keybinding tables. Canonical operations are the stable rows;
each cell contains a G-word binding or `null` when that function is unbound in
that mode. Assigning the same G word to another operation uses last-assignment
wins and clears the previous owner's cell. The exported binding/table builders
preserve that rule for a future profile editor. Later motion operations or
optional M-event mappings can therefore be added without changing existing
profile meaning.

Built-in profiles are immutable. `kaijuMachineMode/profileEditor.js` sends its
custom tables through `normalizeCustomGCodeDialectProfiles()` and
`setCustomGCodeDialectProfiles()` before they become available through
`getGCodeDialectProfile()` or `getGCodeDialectProfiles()`. A profile may have
only one binding for a numeric G word within a mill or lathe table, even when a
binding needs a companion word. That conservative rule prevents ambiguous
source blocks such as `G50 S...` from resolving to two operations.

The supported consumer APIs and returned-field meanings are documented in
[`data-access.md`](data-access.md). Feature code should consume those read
models rather than importing private helpers or reconstructing authored words.

If only one feature needs a behavior, keep it in that feature. Promote it to
Meta only when it is genuinely reusable and has no product-specific UI policy.
