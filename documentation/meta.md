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
| `MetaExecutionTrace.js` | Sole control-flow execution pass, including GOTO, WHILE, inline IF, and nested IF THEN / ELSE / ENDIF branches; debounced cache, occurrence stream, macro history, initial-value overrides, assumed-zero inputs, safety state, and execution-to-formatted-line mapping | Trace, Decomposition, Sense, Vision, Chronoblade, Alert |
| `MetaMacroEngine.js` | Macro aliases, assignment tokenization, header defaults, expression evaluation, normalization, and value resolution | Alias, Trace, Sense, Decomposition, Orphan Killer, Tool Model, Motion Engine |
| `MetaToolModel.js` | Tool identity/ranges and stable tool colors | Sense, Rangefinder, Warpaint, Motion Engine |
| `MetaTextRanges.js` | Comment and angle-bracket protected ranges plus offset-preserving masking | Features that scan code text; Macro Engine |
| `MetaMachineMode.js` | Named machine-profile validation, defaults, per-program machine and mill/lathe persistence, Settings fallback, and change notifications | Machine Mode, Alert, Sense, Vision, Chronoblade, Reconstructor |
| `MetaGCodeDialect.js` | Versioned canonical G-code operations, validated controller bindings, companion-word requirements, built-in profiles, and the live custom-profile registry | Machine Mode, Motion Engine |
| `MetaHumanFormat.js` | Formatting already-calculated values for UI | Motion Engine and reports |
| `MetaModalDefs.json` | Status-group ordering and non-dialect modal definitions | Motion Engine |

## Canned cycle ownership

`MetaCannedCycles/` owns cycle variants, conventional commands, parameter state, and generated moves. `MetaGCodeDialect` owns their actual profile bindings; `MetaMotionEngine` calculates geometry/time from their generated moves. See [Canned cycles](canned-cycles.md).

## Boundary

`MetaMachineMode` validates and persists the optional Boolean
`requiresPercentDelimiters`, defaulting it to false for Generic Machine and
legacy profiles. Reconstructor consumes it as a formatting default; delimiter
insertion itself stays in Reconstructor.

`MetaMotionEngine.parseWords` exposes the existing shared address-word scanner
for static consumers such as Alert's profile-binding check. Callers mask
protected text first and retain its source offsets; macro evaluation requires
the relevant execution context. See the data-access contract for returned fields.

`MetaMachineMode` owns reusable `workOffsets` and shared document overrides.
`normalizeMachineWorkOffsets` validates finite signed X/Y/Z/C values for G53-G59.
`getDocumentWorkOffsets` returns an override or undefined; it reads shared
`kaijuMachineMode.workOffsetsByDocument` first, then legacy Vision storage.
`saveDocumentWorkOffsets(document, offsets)` saves or clears an override,
migrates the legacy entry, and emits `onDidChangeWorkOffsets` for report refresh.
Machine-change events remain separate so offset edits do not reset view planes.
`MetaMotionEngine` rebases position into the destination frame before computing
travel/time, preserves physical axes across frame changes and non-modal G53,
and projects C offsets into rotary rendering. Returned `pathCoordinateSystem`
identifies the calculation path's frame; displayed start/end coordinates may
retain their respective source/destination frames.

`MetaMacroEngine` resolves indirect numeric variables such as `#[#100]`,
computed addresses such as `#[#100+1]`, and nested indirect reads. The same
resolution applies to assignment targets, motion/modal words, tool expressions,
Trace conditions, and Decomposition output. Indirect addresses must evaluate to
non-negative safe integers; invalid or missing addresses remain unresolved.
No controller-specific variable range or fractional-address rounding is inferred.
Trace retains the actual assigned variable in `assignments[].resolvedMacro`,
and includes dereferenced variables in occurrence values, histories, and playback
deltas. Its existing assumed-zero policy also reports missing dereferenced inputs
when evaluating assignments and conditions.

Meta must not own webviews, editor decorations, command-palette flows, or a
feature's settings UI. It can expose data and pure-ish helpers that support
multiple consumers. `MetaHumanFormat` never participates in a calculation;
format after calculating. Motion timing must remain independent of rendering
sampling. Mask comments and angle-bracket text through `MetaTextRanges` before
performing feature-specific scans.

`MetaMotionEngine` keeps the profile-bound `G50 S...` limit as programmed state,
and combines it with a configured physical machine maximum for effective RPM.
The lower positive limit caps CSS and fixed-RPM timing. A machine maximum does
not create an authored G50 status entry or provide a missing spindle speed.
It does not infer a spindle limit from a `D` word, whose meaning is
controller- and context-specific.

Controller-dependent meanings such as `G98`, `G99`, and lathe `G50 S...` exist
only in `MetaGCodeDialect`. `MetaModalDefs.json` supplies group ordering and
genuinely non-dialect status codes. Sense may apply a user-provided display
name without changing either source of modal interpretation.

Lathe polar interpolation is also dialect-owned: built-in lathe profiles map
`G12.1`/`G13.1` to shared polar enable/disable operations. While enabled,
`MetaMotionEngine` maps authored `X/C` (and incremental `U/H`) motion into its
Cartesian point stream, including sampled I/J and R arcs; Vision and
Chronoblade consume that same geometry.
An omitted in-plane I/J/K centre offset is zero, including NLX-style polar
full circles such as `G3 I-6.`.

Both built-in lathe profiles bind `M45`/`M46` to C-axis engagement and
cancellation. These operations are independent of polar interpolation.
`M46` resets the interpreted C value to zero by default (machine profiles can
disable the reset) for subsequent position displays. Vision geometry uses
the C0 lathe plane after explicit cancellation independently of the stored C
value, and restores angular placement on re-engagement. Vision receives position
events for Trace playback at cancellation and re-engagement blocks. Sense shows `M45` while
active and clears that modal entry at `M46`.

Outside polar interpolation, lathe C words are angular degrees and H is an
incremental C move. The shared engine retains C in authored positions and
samples rotary sweeps for Vision, including simultaneous X/Y/Z motion. For
programs without an explicit C-axis mode command, authored C motion retains
the existing rotary inspection behavior. Physical
placement rotates the linear XY position about Z; diameter X is halved first.
C0 points along +X and positive C rotates toward +Y. Each commanded C or H
sweep uses its full signed angle, including multiple turns. After the move, the
tracked physical C angle is reduced to 0-360 degrees for the next block by
default; a machine profile can retain signed multi-turn coordinates instead.
With wrapped coordinates,
an H720 move draws two turns and ends at C0; a following absolute C0 does not
draw an invented two-turn return. This is an inspection convention, not a
rotary unwind rule. Machine profiles can separately select direct, shortest,
positive, or negative equivalent absolute C routes; H and G91 sweeps preserve
their signed travel. Polar interpolation bypasses these angular choices.
For G1 moves outside polar interpolation, the default controller-feed model
treats each degree of C travel as one linear program unit. Mixed X/Y/Z/C feed
length is the vector of linear-axis travel and signed C travel; X keeps the
selected radius/diameter conversion. This feed length drives G94/G98
feed-per-minute and G95/G99 feed-per-revolution time estimates, including
fixed-RPM and CSS cases. Chronoblade reports this controller-feed length for
those moves, while Vision retains physical swept distance and geometry. It is
not a surface-distance estimate. Rotary G0 and G2/G3 timing remains unknown
without controller-specific rates and interpolation rules by default. A
configured C rapid rate enables G0 timing using the longest physical linear or
angular axis travel/rate time. Optional linear axis rates use that same timing
model; without them, nonrotary G0 preserves distance/base-rate time. Rapid
geometry remains unchanged and no acceleration/dogleg path is inferred.
Rotary feed alternatives are scaled angular contribution, physical swept
distance, and linear-only travel. Physical G1 length and time integrate an
analytic rotated-linear path derivative with fixed numerical quadrature,
independent of rendering samples. Linear-only pure rotary time is unknown.
Turret timing uses profile station count and indexing direction for circular
routes, with the existing numeric gap fallback when station count is unknown
or station identities are outside the configured range. Startup modes initialize
motion and status state; authored operations override them. Human position
formatting includes C when available.

Machine Mode is saved in workspace state by source-document URI when selected
from the KAIJU Machine Mode menu. That per-program profile, including its
radius/diameter X convention, overrides the Settings value for every consumer.

The selected or inferred Machine Mode determines the X convention. The legacy
`kaijuNC.chronoblade.xAxisMode` setting cannot make a Mill program use Diameter
X semantics; it is retained only for Settings compatibility.
For unassigned programs, the default `auto` setting performs conservative
comment-masked source inference; confident results are marked as inferred in
the shared read model, while ambiguous code retains the Lathe (Diameter)
fallback. A specific `kaijuNC.chronoblade.machineMode` setting overrides
inference.

The same per-program record stores a G-code interpretation profile. Programs
without one use `kaijuNC.gCodeDialect.defaultProfile`, which defaults to
`FANUC / ISO` and may name either built-in profile or a custom profile. The
built-in `FANUC / ISO` profile binds feed/min and feed/rev to `G94` and `G95`.
The built-in `DMG MORI` profile binds those functions to `G98` and `G99` in
turning mode while retaining ISO mill feed modes and mill canned-cycle return
meanings.

Work-frame selection is dialect-owned through `coordinate.work1` to
`coordinate.work6`, with G54-G59 defaults in both mode tables. Each operation
selects a stable G54-G59 offset slot in MetaMotionEngine. The profile spelling
appears in Sense; rebinding or unbinding never falls back to a literal selector.
The shared offset storage and frame-rebasing calculations remain unchanged.

`MetaGCodeDialect` is a deliberately bounded rebinding layer. Authored G/M words
resolve to stable operations such as `feed.perMinute`, `motion.linear`, or
`spindle.rpmLimit`; `MetaMotionEngine` applies those operations. Bindings may
require a companion word and select its value, as the lathe RPM-limit binding
does with `G50 S...`. Profiles are declarative, validated for conflicts, and
schema-versioned. Each profile owns separate `bindings.mill` and
`bindings.lathe` keybinding tables. Canonical operations are the stable rows;
each cell contains a G/M-word binding or `null` when that function is unbound in
that mode. Assigning the same word to another operation uses last-assignment
wins and clears the previous owner's cell. The exported binding/table builders
preserve that rule for the profile editor. A C-axis operation requires an M word;
the existing G operations require G words.

Built-in profiles are immutable. `kaijuMachineMode/profileEditor.js` sends its
custom tables through `normalizeCustomGCodeDialectProfiles()` and
`setCustomGCodeDialectProfiles()` before they become available through
`getGCodeDialectProfile()` or `getGCodeDialectProfiles()`. A profile may have
only one binding for a numeric G/M word within a mill or lathe table, even when a
binding needs a companion word. That conservative rule prevents ambiguous
source blocks such as `G50 S...` from resolving to two operations.

The supported consumer APIs and returned-field meanings are documented in
[`data-access.md`](data-access.md). Feature code should consume those read
models rather than importing private helpers or reconstructing authored words.

If only one feature needs a behavior, keep it in that feature. Promote it to
Meta only when it is genuinely reusable and has no product-specific UI policy.


`getDocumentMachineSettings(document)` returns a copy of the saved program selection plus the shared work-offset override (undefined means inherit). File Settings combines this with the existing resolved machine context.
