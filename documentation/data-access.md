# Shared Data Access Contracts

Use this page before adding a parser, evaluator, simulator, or machine-state
lookup. Feature modules own presentation; these Meta APIs own shared facts.

## Source text and macros

| Need | Import | Contract |
| --- | --- | --- |
| Ignore comments and angle-bracket text | `maskProtectedRanges` from `MetaTextRanges` | Returns text of identical length with protected characters replaced by spaces. Source offsets remain valid. |
| Inspect protected spans | `getCommentRanges`, `getAngleBracketRanges`, `isInsideRange` from `MetaTextRanges` | Inclusive `{ start, end }` offsets into the original line. |
| Find assignments | `findMacroAssignments` from `MetaMacroEngine` | Returns normalized macro name plus the unevaluated value expression. |
| Resolve aliases or expressions | `buildMacroAliasMap`, `evaluateNumericExpression`, `resolveMacroAlias`, `setMacroValue` from `MetaMacroEngine` | One numeric/alias interpretation for every consumer. |
| Read header defaults | `buildInitialMacroDefaults` from `MetaMacroEngine` | Returns the shared trailing-`{number}` defaults as a `Map`. |
| Read a macro or address-value token | `readMacroToken`, `readNumericValueToken` from `MetaMacroEngine` | Returns `{ text, start, end }` with exclusive end, or `undefined`; balances nested brackets and recognizes `#[expression]`. |
| Resolve an assignment target | `resolveMacroReference` from `MetaMacroEngine` | Returns the numeric/alias target in the supplied macro state, or `undefined` for an invalid indirect address. |
| Collect evaluated macro references | `getExpressionMacroReferences` from `MetaMacroEngine` | Returns unique direct references and resolved indirect variables, including address inputs, using the supplied values and aliases. |

`evaluateNumericExpression` accepts indirect reads and nested address expressions.
An optional fourth argument, `onMacroRead(macro)`, runs before each value lookup,
including address inputs and dereferenced variables. Trace uses it for its
reported assumed-zero inputs. `setMacroValue` accepts an indirect target and
updates the selected variable; an invalid target performs no write. Trace
assignment metadata preserves the source spelling in `macro` and records the
actual target in `resolvedMacro`, before an assignment can change its own pointer.

Do not copy assignment regular expressions, protected-text masking loops, or a
smaller expression evaluator into a feature or another Meta model.

## Machine and controller meaning

Call `getMachineModeForDocument(document)` from `MetaMachineMode`. Its result is
the complete per-program interpretation context:

| Field | Meaning |
| --- | --- |
| `profile` | Mill/lathe profile and default feed behavior. |
| `machineProfile` | Selected named machine definition, including its G-code profile and behavior settings. |
| `machineSettings` | Active named machine settings, or undefined while preserving legacy settings/mode records. Pass C-axis coordinate/reset behavior; use rapid/tool and `customTimes` timing defaults in reports and `requiresSemicolons` as the formatter default. |
| `motionOptions` | Shared derived machine options: axis rapid rates, turret indexing, C travel/feed rules, physical spindle maximum, CSS units, startup defaults, and effective work offsets. Spread after legacy fallbacks; legacy mode records still receive shared program offsets. |
| `xAxisMode` | Radius or diameter interpretation used by motion geometry. |
| `gCodeDialect` / `gCodeDialectId` | Selected controller keybinding table. |
| `machineModeSource` | `document` for a saved selection, `inferred` for confident automatic detection, or `fallback` for the configured/ambiguous fallback. |

For work-offset editing, call `getDocumentWorkOffsets` and
`saveDocumentWorkOffsets(document, offsets)` from `MetaMachineMode`. Undefined
means inherit the selected machine; saving undefined removes the program
override. `onDidChangeWorkOffsets` refreshes consumers without changing machine
identity. Reads preserve existing saved Vision offsets.

Pass the derived feature options into Motion Engine calls. Do not read another
feature's setting directly to infer machine state.

Controller words are inputs, not stable meanings. Use canonical operations and
the active profile through `MetaGCodeDialect`. `resolveGCodeOperations(words,
options)` interprets authored G/M words; `getGCodeWordForOperation(operation,
options)` supplies the profile spelling for presentation, including M words.
A missing binding is
`undefined`/`null`, not permission to fall back to an ISO word.

Machine Mode owns custom-profile Settings and its editor. Its only Meta-facing
write path is `normalizeCustomGCodeDialectProfiles()` followed by
`setCustomGCodeDialectProfiles()`. All other features keep reading the
selected profile through `getMachineModeForDocument(document)`; they never
read profile JSON or Settings directly.

Work coordinate operations `coordinate.work1` through `coordinate.work6` select
stable G54-G59 work-offset slots. Report `coordinateSystem` values for work frames
identify those slots, even when a profile changes the authored selector word.
Dialect operation definitions carry the target `coordinateSystem`; consumers
must not derive frame identity by subtracting a number from the authored G word.

## Motion and modal data

Use `MetaMotionEngine` for all motion/modal interpretation:

| Consumer need | API |
| --- | --- |
| Cursor hover | `estimateMotionAtLine` and `getMotionCodeForGCode` |
| Cursor modal status | `getModalStateAtLine` |
| Arc diagnostics | `analyzeArcAtLine` or one-pass `analyzeArcsInDocument` |
| Authored address words | `parseWords(codeLine, macroValues?, macroAliases?)` returns `{ letter, raw, value, start, end }` with exclusive end; pass offset-preserving masked text. It skips macro names, standalone bracket expressions, and multi-letter identifiers. Static consumers should limit checks to literal values; macro values require execution context. |
| Cycle-time report | `analyzeChronobladeRange` |
| Toolpath inspection | `analyzeVisionRange` |

Calculated rows carry presentation-safe controller spelling. Use
`row.instruction`, `row.feedModeWord`, formatted spindle data, and
`result.motionDisplayWords`; do not reconstruct `G94/G95`, `G0`, or another
word from canonical state such as `feedMode` or `motionCode`.

## Canned cycles

Catalog metadata comes from `MetaCannedCycles`; features must not execute its behavior scripts directly. Use the existing Motion Engine report APIs. Expanded cycle motion rows include `cycleId` and `cycleInstruction` while retaining source/Trace linkage. Marker-only cycle rows have unknown time; they do not describe all controller passes. Documented-only entries have no runtime binding.

## Execution order

`MetaExecutionTrace` is the only control-flow executor. Use:

- `getExecutionTrace(document)` for the passive version-matched cached result;
- `buildExecutionTrace(document, options)` for an explicit snapshot;
- `includeExecutionEntries` for occurrence order;
- `includePlaybackData` for playback deltas;
- `includeDecompositionData` for resolved control decisions, assignments, and
  termination metadata.

Decomposition may prompt for missing inputs, but it feeds those values back to
`buildExecutionTrace` and formats the returned occurrences. Features must not
implement their own `IF`, `ELSE`, `ENDIF`, `GOTO`, `WHILE`, loop, alarm, or repeated-state walk.
Both passive and explicit builds use `kaijuNC.trace.maxExecutionSteps` by
default. An explicit `maxExecutionSteps` option is reserved for targeted runs
and tests; feature consumers should leave it unset.
When a trace occurrence supplies `effectiveCodeLine`, motion consumers must
interpret that selected executable text while retaining `sourceLine` for source
presentation.

## Tool and display models

- Use `getToolRanges(document)` and `TOOL_COLORS` from `MetaToolModel`; tool
  expressions already use the shared macro engine.
- Use `MetaHumanFormat` only after calculation. Formatting must never feed back
  into geometry, timing, comparisons, or state keys.

## 1.0 stability rule

After 1.0, new tools should render, filter, combine, or interact with these
read models in new ways. Meta may receive correctness fixes, new controller
profiles/bindings, and backward-compatible result fields. A new Meta subsystem
requires a capability that at least two independent consumers genuinely need
and that cannot be expressed through an existing owner.


File Settings consumes owner-provided `getChronobladeSettingsSnapshot`, `getVisionSettingsSnapshot`, `getOrphanSettingsSnapshot`, and `getWarpaintSettingsSnapshot` functions. Saved feature storage remains private to each owner. `getDocumentMachineSettings` exposes saved machine selections and inherited/overridden work offsets without recreating resolution logic.
