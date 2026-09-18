# Machine Mode and G-code Profiles

[Back to KAIJU Codex](README.md)

KAIJU normally starts in **Automatic** Machine Mode for an unassigned program.
It scans executable code once (not comments or angle-bracket text) and marks a
confident result in the status bar with **(Auto)**. Choose Mill, Lathe (Radius),
or Lathe (Diameter) from the editor context menu whenever you know the machine;
KAIJU saves that selection for that program.

## What Automatic mode looks for

| Likely machine | Evidence |
| --- | --- |
| Lathe | CSS `G96`/`G97`, `G50 S...`, turning cycles `G71`, `G72`, `G75`, or `G76`, diameter/radius programming `G07`/`G08`, U/W incremental moves, or a four-digit tool call such as `T0101`. `G08` specifically selects Lathe (Radius). |
| Mill | Tool-length commands `G43`/`G49`, or a combination of milling canned cycles `G81`-`G89`, `M06`, and Y-axis motion. |

The detector is intentionally conservative: repeated weak clues do not add up
on their own. If the program is ambiguous, KAIJU keeps the Lathe (Diameter)
fallback instead of guessing. Automatic mode is a convenience, not a controller
identification system.

## Which choice wins

1. A Machine Mode saved for the active program.
2. An explicit `kaijuNC.chronoblade.machineMode` Setting.
3. Automatic inference for an unassigned program.
4. Lathe (Diameter) when automatic inference is inconclusive.

Choose a G-code profile the same way. FANUC / ISO and DMG MORI are included;
**KAIJU Manage G-code Profiles** lets you create a custom declarative binding
table for another controller.

Machine Mode and the selected profile affect how KAIJU presents and interprets
relevant motion semantics. They do not replace the controller manual or verify
that a program is safe for a particular machine.
