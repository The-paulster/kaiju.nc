# KAIJU Sense

**Sources:** `src/kaijuSense/`

## Responsibility

Sense is the live editor-assistance module. It coordinates motion hovers, macro
hovers, tool-range decorations, N-label/GOTO navigation and highlights,
fork-resolution notices, and the left-side cursor-state status bar. Its
`options.js` centralizes Sense configuration and derived machine defaults.
`kaijuNC.sense.modalNames` lets users replace the verbose status-bar labels for
individual modal codes without changing their modal meaning. The default labels
come from Meta and are selected for the active program's saved mill or lathe
machine mode, or the global fallback when it has not been assigned one.

## Connections

- Motion hover and cursor modal status consume `MetaMotionEngine`.
- Macro hover consumes `MetaMacroEngine` and the passive `MetaExecutionTrace`
  history; tool decorations consume `MetaToolModel`.
- Text scans use `MetaTextRanges`.
- Machine-profile defaults come from `MetaMachineMode`.
- Modal meanings come from the active program's shared `MetaGCodeDialect`
  profile, keeping cursor status and motion hovers aligned with reports.
- Motion hover entry words are resolved through `MetaMotionEngine`; Sense does
  not use a literal `G0`-through-`G3` recognizer.

## Boundary

Sense presents context at the cursor. It does not own shared motion or macro
interpretation, tool-range calculation, Alias editing, or static diagnostics.
Macro hovers present the first Alias-style source when available, otherwise the
first static assignment, and the resolved value at the hovered line. For looped
execution, they instead show occurrence count and a first-five/last-five
trace-value history. Ctrl/Cmd-clicking a macro in the editor navigates to that
same Alias-priority source line.
Custom modal names are a Sense presentation preference: they apply only to the
Sense status bar, while Meta remains the owner of modal detection and defaults.
Keep its subfeatures separate: N-label navigation is `nLabels.js`; ambiguous
fork notifications are `fork.js`; macro hovers are `macro.js`; motion hovers
are `hover.js`; cursor status is `statusBar.js`.
