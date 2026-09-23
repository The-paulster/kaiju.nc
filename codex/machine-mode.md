# Machine Mode and G-code Profiles

[Back to KAIJU Codex](README.md)

Machine Mode tells KAIJU whether a program is a mill or lathe program and how to interpret lathe X values. The G-code Profile supplies the controller's word bindings. Together they determine the motion and modal meanings shown by Vision, Sense, Chronoblade, and other inspection tools.

## Quick start

1. Open the NC program and check the machine/profile indicator on the right side of the VS Code status bar.
2. If the inferred mode is unsuitable, choose **KAIJU Machine Mode** from the editor context menu and select **Mill**, **Lathe - Radius**, or **Lathe - Diameter**. That choice is saved for the program.
3. Choose **KAIJU G-code Profile** from the same menu to select a built-in or saved custom profile for the program. For another controller, open **KAIJU Manage G-code Profiles**.

The mode and profile are document-specific choices. They affect KAIJU's analysis; selecting them does not rewrite the NC program.

## Machine modes and motion meaning

| Mode | X interpretation | Default feed behavior |
| --- | --- | --- |
| **Mill** | X is a linear axis. | Feed per minute. |
| **Lathe - Radius** | X represents radial distance. | Feed per revolution. |
| **Lathe - Diameter** | X represents diameter; physical radial travel uses half the X change. | Feed per revolution. |

An incorrect mode can change displayed geometry, CSS estimates, and timing. The selected G-code Profile determines which authored codes switch functions within that mode. For example, the built-in **FANUC / ISO** profile uses `G94/G95` for mill feed modes and `G98/G99` for lathe feed per minute and feed per revolution. Mill and lathe bindings are separate even when a code has different meanings in the two contexts.

## Automatic detection and selection precedence

For an unassigned program, the default **Automatic** setting scans executable code outside comments and angle-bracket text. A confident inferred mode appears with **(Auto)** in the status bar.

| Likely mode | Strong evidence |
| --- | --- |
| Lathe | CSS `G96/G97`, `G50 S...`, turning cycles `G71`, `G72`, `G75`, or `G76`, diameter/radius programming `G07/G08`, U/W moves, or a four-digit tool call such as `T0101`. `G08` selects Lathe - Radius. |
| Mill | Tool-length commands `G43/G49`, or a combination of milling canned cycles `G81`–`G89`, `M06`, and Y-axis motion. |

Repeated weak clues do not add up on their own. An ambiguous program retains the Lathe - Diameter fallback. For Machine Mode, the selection order is:

1. A mode saved for the active program.
2. An explicit `kaijuNC.chronoblade.machineMode` setting.
3. Automatic inference for an unassigned program.
4. Lathe - Diameter when inference is inconclusive.

## G-code profiles

**KAIJU G-code Profile** lists the built-in **FANUC / ISO** and **DMG MORI** profiles alongside saved custom profiles. A program's selected profile takes priority over the fallback profile setting. The profile defines which G words activate functions such as feed modes, spindle modes, interpolation, and limits for Mill and Lathe separately.

**KAIJU Manage G-code Profiles** opens the profile editor. **Duplicate** starts from a built-in profile; **New** starts with unbound operations. A blank binding leaves a function unbound. Assigning a G word to one function clears another function's use of that word in the same machine table, avoiding conflicting meanings. Some operations also require a companion address word, such as `G50 S` for an RPM limit.

**Save profiles** stores changed custom profiles for later use. **Use for this program** selects the currently displayed built-in or saved custom profile for the active NC program. Built-in profiles are read-only, so a controller-specific variation starts as a duplicate or new profile.

## Interpretation limits

Automatic detection is a conservative starting point, especially for programs with few distinctive words. A custom binding changes how KAIJU interprets and presents a code; it does not establish that the controller accepts that code or that the finished toolpath is safe. For a visual comparison of mill and lathe behavior, see the [Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc) and [C-axis and polar](../examples/05-c-axis-and-polar.nc) examples.
