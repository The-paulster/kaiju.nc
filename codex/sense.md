# Sense

[Back to KAIJU Codex](README.md)

Sense presents program context at the editor cursor. It combines motion and macro hovers, `N` label and `GOTO` references, tool-range markers, and a status-bar readout of the active modal state. Motion and macro values come from KAIJU's shared analysis and use the selected machine profile.

## Quick start

1. Open [the macros, Sense, Macro Hunter, and Alias example](../examples/06-macros-sense-hunter-and-alias.nc) in the G-code editor.
2. Hover `#120` on the `G01 X#120 Z#121 F#103` line to see how its value changes across the loop. Ctrl+Click the macro to jump to its named source; use Cmd+Click on macOS.
3. Hover the `G01` word to inspect the motion calculated for that line. Move the cursor through setup, loop, and retract blocks to see the modal readout change in the left status bar.

## Motion hovers

Sense attaches motion hovers to explicit motion `G` words recognized by the active G-code profile, including `G00`, `G01`, `G02`, and `G03`. A line that continues a modal move without repeating its `G` word still contributes to program motion, but has no motion word to hover. The hover is calculated using preceding program state, including position, feed mode, spindle mode, and the selected machine profile.

| Field | Meaning |
| --- | --- |
| Start, End, Delta | Resolved positions before and after the move, and signed changes on each available axis. |
| Path length | Distance used for the move estimate. |
| Angle from X | Direction of a linear move when an angle can be calculated. |
| Arc direction, plane, center, radius, sweep, circle length | Arc geometry when the corresponding values can be resolved. |
| Estimated time | Time calculated for this move, not a measured machine time. |
| Feed, Spindle, RPM used | Available feed and spindle state; a CSS move can show the RPM range used for the estimate. |

If the arc center cannot be found, Sense marks the chord-distance fallback in the hover. Other motion-analysis warnings also appear there. Unresolved expressions or missing position and cutting data can limit which fields are available. The rapid rate, CSS surface-speed unit, and sampling settings affect estimates; the [Chronoblade guide](chronoblade.md) covers program-level timing.

## Macro hovers and source navigation

Hovering a numbered macro such as `#120` or a KAIJU Alias name such as `#current_x` shows the macro's source and its value at the hovered source line. Sense prefers the first Alias-style naming source when one exists; otherwise it uses the first assignment found in the document. The source block is shown in the hover, and Ctrl+Click (Cmd+Click on macOS) navigates to that source.

When passive Trace has executed the hovered line once, Sense shows its resolved value. When a loop executes that source line repeatedly, the hover shows the occurrence count and a compact value history. Long histories include the first five and last five values. These values describe executions of that line, so a macro on a loop body can have several values even though it appears only once in the editor. [Macro Hunter](macro-hunter.md) provides the complete per-occurrence state and the values between those endpoints.

If Trace is still running, Sense can display a statically evaluated value with a `Trace running` note. If the line has no executed value, it reports that condition and uses a static value when one is available. A macro with no recognized definition receives a `No definition found above or in document` hover. These conditions indicate limits of the available analysis; the hover does not prove that a controller will resolve the expression.

## `N` labels and `GOTO` references

Sense places an inline `↩ 2 refs` style marker after an `N` label when two `GOTO` statements target it. Hovering the label lists the referring source lines. Hovering a matching `GOTO` shows its target line, and Ctrl+Click (Cmd+Click on macOS) navigates to the `N` label. Selecting or hovering a reference temporarily highlights the related line in amber; selecting a label highlights its incoming references.

```gcode
#110 = 0
#111 = 2
G21 G90
N100 (PASS START)
IF [#110 GE #111] GOTO 200
#110 = #110 + 1
G01 X[#110 * 5.] F200.
GOTO 100
N200 (RETRACT)
G00 Z5.000
M30
```

Here `N100` has one incoming reference from `GOTO 100`, while `N200` has one from the conditional `GOTO 200`. Sense resolves literal numbered targets; a missing target has no navigation destination. If duplicate `N` labels make a target ambiguous, navigation uses the first matching label. When an edit removes a duplicate target and leaves one destination, Sense can issue a `Fork eliminated` notice with the origin and target lines. [Alert](alerts.md) covers static label diagnostics, including missing and duplicate labels.

## Tool-range markers

Sense uses the shared tool model to mark the lines belonging to each tool range with a consistent colour in the editor gutter and overview ruler. The colours follow tool identity across the program, helping relate distant blocks to the same tool. These markers are controlled by `kaijuNC.syntax.toolDecorations.enabled`; [Syntax](syntax.md) describes the editor's other colour categories.

## Cursor modal status

The **left-side** status-bar readout follows the caret and shows modal codes active at that source line. In verbose mode it includes descriptions, for example `G00 (Rapid)` and `M08 (Coolant on)`; compact mode shows codes only. The readout can include the active profile's additional modal states, such as lathe polar interpolation. The machine-profile indicator on the right side of the status bar shows the selected or inferred machine configuration.

The labels in this readout can be customized without changing G-code interpretation. For example, this Settings JSON changes the displayed name of `G00`:

```json
{
  "kaijuNC.sense.modalNames": {
    "G00": "Positioning"
  }
}
```

## Settings

| Setting | Effect |
| --- | --- |
| `kaijuNC.sense.enabled` | Enables motion hovers and the cursor modal readout. |
| `kaijuNC.sense.labelReferences.enabled` | Enables inline label references, label and `GOTO` hovers, related highlights, and target navigation. |
| `kaijuNC.sense.statusBarVerbose` | Shows descriptive names beside modal codes in the left status bar. |
| `kaijuNC.sense.statusBarSyntaxColors` | Colours the modal codes by category in the left status bar. |
| `kaijuNC.sense.modalNames` | Replaces selected verbose modal labels for display only. |
| `kaijuNC.sense.rapidRate` | Sets the rate assumed for rapid-move time estimates, in program units per minute. |
| `kaijuNC.sense.cssSurfaceSpeedUnit` | Sets the unit used for CSS calculations (`mPerMin` or `sfm`). |
| `kaijuNC.sense.samples` | Sets the sampling count for path and CSS/RPM-limit estimates. |
| `kaijuNC.sense.syntaxColoredHoverValues` | Experimental syntax-coloured motion-hover values; the larger layout is less compact. |

The active Machine Mode and G-code profile determine motion interpretation and X-axis semantics. Sense-specific display settings change the presentation or estimate inputs; they do not replace that profile selection.
