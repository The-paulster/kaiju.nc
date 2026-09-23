# Sense

[Back to KAIJU Codex](README.md)

Sense adds live help inside the editor. Hover motion words for geometry and
timing context, hover macros for their source and values, and use N-label or
GOTO navigation to move through a program.

The status bar reflects the cursor's modal context. For occurrence-by-occurrence
macro values and history, see [KAIJU Macro Hunter](macro-hunter.md).

Sense presents shared analysis at the cursor. When a macro cannot be resolved,
treat the displayed limitation as a reason to check the program inputs.

## KAIJU Sense

`KAIJU Sense` is the quick diagnostic system for KAIJU.NC.

Hover over explicit `G0`, `G1`, `G2`, and `G3` moves to inspect motion geometry, cutting data, timing estimates, spindle state, and modal information directly inside the editor.

Kaiju Sense exposes motion behavior, macro logic, and assists identifying weaknesses in your NC code.

Sense can display:

* Start and end coordinates
* Axis deltas
* Path length
* Linear move angle
* Arc direction, radius, sweep, center, and endpoint deltas
* Estimated motion time
* Feed and spindle state
* RPM range during CSS cutting

Sense also includes macro-assist features for advanced NC workflows:

* Hover lookup for macro variables
* Alias-aware macro inspection
* Bracket expression highlighting
* Address-aware macro expression parsing
* Hover details and amber line highlighting for `GOTO` label references
* Ctrl+Click navigation from a `GOTO` reference to its matching `N` label

KAIJU Sense also provides a cursor-state status bar readout showing the active modal codes at the current line, such as motion mode and coolant state. It can display descriptive labels like `G00 (Rapid)` and `M08 (Coolant on)`, or compact codes such as `G00 M08`.

Example:

```gcode id="6dqv4n"
#FINISH_ALLOWANCE_DIA = 0.20

G1 X[#FINISH_ALLOWANCE_DIA + 1.00]
Z[#FINISH_Z - 0.50]
F#ROUGHING_FEED
```
KAIJU Sense walks the active document to resolve modal state, spindle behavior, feed mode, CSS conditions, and previous machine position before generating hover analysis.
