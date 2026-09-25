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
- When active, lathe polar interpolation appears in the cursor modal strip as
  `G12.1 (Polar interpolation on)` until its dialect-owned cancel command.
- Profile-bound `M45` appears as `M45 (C-axis mode on)` until `M46` cancels
  that mode. Polar interpolation and C-axis engagement have separate entries.
- Motion hover entry words are resolved through `MetaMotionEngine`; Sense does
  not use a literal `G0`-through-`G3` recognizer.

## Boundary

Sense presents context at the cursor. It does not own shared motion or macro
interpretation, tool-range calculation, Alias editing, or static diagnostics.
Its **Macro Hunter** Explorer-side view is opened from the editor-title macro
button or the KAIJU Macro Hunter command. When unpinned, it follows the
active editor caret; Pin freezes the selected source line until Unpin is used.
For a repeatedly executed source line, a compact occurrence selector chooses
the complete resolved macro state after each occurrence; selecting a macro
opens its all-occurrence history. The main table orders Macro, Value, and Name
at their natural widths and horizontally scrolls instead of clipping. The
table is not height-capped, so the sidebar continues through its rows rather
than leaving unused panel space. Its horizontal scrollbar stays immediately
beneath the toolbar while the macro rows scroll. The occurrence selector also supports mouse-wheel stepping. It builds this richer snapshot only while the
view is visible, through `MetaExecutionTrace` playback deltas and checkpoints;
ordinary passive Trace stays compact. Macros sort with the most recently read
or assigned value at the selected occurrence first. Compared with the preceding
occurrence, increased values are green and decreased values are red.
Macro hovers present the first Alias-style source when available, otherwise the
first static assignment, and the resolved value at the hovered line. For looped
execution, they instead show occurrence count and a first-five/last-five
trace-value history. Ctrl/Cmd-clicking a macro in the editor navigates to that
same Alias-priority source line.
Custom modal names are a Sense presentation preference: they apply only to the
Sense status bar, while Meta remains the owner of modal detection and defaults.
Keep its subfeatures separate: N-label navigation is `nLabels.js`; ambiguous
fork notifications are `fork.js`; macro hovers are `macro.js`; macro history is
`macroHistory.js`; motion hovers are `hover.js`; cursor status is `statusBar.js`.
