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

Do not copy assignment regular expressions, protected-text masking loops, or a
smaller expression evaluator into a feature or another Meta model.

## Machine and controller meaning

Call `getMachineModeForDocument(document)` from `MetaMachineMode`. Its result is
the complete per-program interpretation context:

| Field | Meaning |
| --- | --- |
| `profile` | Mill/lathe profile and default feed behavior. |
| `xAxisMode` | Radius or diameter interpretation used by motion geometry. |
| `gCodeDialect` / `gCodeDialectId` | Selected controller keybinding table. |

Pass the derived feature options into Motion Engine calls. Do not read another
feature's setting directly to infer machine state.

Controller words are inputs, not stable meanings. Use canonical operations and
the active profile through `MetaGCodeDialect`. `resolveGCodeOperations(words,
options)` interprets authored words; `getGCodeWordForOperation(operation,
options)` supplies the profile spelling for presentation. A missing binding is
`undefined`/`null`, not permission to fall back to an ISO word.

Machine Mode owns custom-profile Settings and its editor. Its only Meta-facing
write path is `normalizeCustomGCodeDialectProfiles()` followed by
`setCustomGCodeDialectProfiles()`. All other features keep reading the
selected profile through `getMachineModeForDocument(document)`; they never
read profile JSON or Settings directly.

## Motion and modal data

Use `MetaMotionEngine` for all motion/modal interpretation:

| Consumer need | API |
| --- | --- |
| Cursor hover | `estimateMotionAtLine` and `getMotionCodeForGCode` |
| Cursor modal status | `getModalStateAtLine` |
| Arc diagnostics | `analyzeArcAtLine` or one-pass `analyzeArcsInDocument` |
| Cycle-time report | `analyzeChronobladeRange` |
| Toolpath inspection | `analyzeVisionRange` |

Calculated rows carry presentation-safe controller spelling. Use
`row.instruction`, `row.feedModeWord`, formatted spindle data, and
`result.motionDisplayWords`; do not reconstruct `G94/G95`, `G0`, or another
word from canonical state such as `feedMode` or `motionCode`.

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
implement their own `IF`, `GOTO`, `WHILE`, loop, alarm, or repeated-state walk.

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
