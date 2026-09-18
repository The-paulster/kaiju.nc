# KAIJU.NC examples

Open an NC file in VS Code and run the named KAIJU command from the Command
Palette or editor context menu. The comments in each file provide a guided
tour. These are demonstrations for the extension, not machine-ready programs.

| File | Try this | Expected result |
| --- | --- | --- |
| [01-reconstructor.nc](01-reconstructor.nc) | KAIJU Reconstructor, then Undo to compare | Case, spacing, decimal precision, tool numbers, and loop indentation are normalized according to your options. |
| [02-diagnostics-and-orphan-killer.nc](02-diagnostics-and-orphan-killer.nc) | Lathe Diameter, FANUC / ISO; Problems panel and KAIJU Orphan Killer | Deliberate label, jump, Z-axis arc, and loop errors; unused `#190` and undefined `#199`. Comments give fixes. |
| [03-syntax-gallery.nc](03-syntax-gallery.nc) | Browse the code and comment styles | All current grammar token families, including bracketed addresses and math/control keywords. Independent snippets mix dialects and are not a coherent toolpath. |
| [04-vision-and-chronoblade.nc](04-vision-and-chronoblade.nc) | Mill, FANUC / ISO; KAIJU Vision and KAIJU Chronoblade | Three rounded-rectangle passes and a central circle; compare Trace with As written, tool colours, depth, dwell, and timing assumptions. |
| [05-c-axis-and-polar.nc](05-c-axis-and-polar.nc) | Lathe Diameter, FANUC / ISO; KAIJU Vision in X-Y | Physical C circles and a spiral, followed by a straight-sided polar rectangle. Physical rotary time remains unknown. |
| [06-macros-sense-hunter-and-alias.nc](06-macros-sense-hunter-and-alias.nc) | KAIJU Alias, Sense hovers, and KAIJU Macro Hunter | Two supported header styles, readable alias toggling, definition navigation, and twelve loop occurrences with known macro values to inspect and pin. |

For complete-program reports, clear any editor selection before opening the
tool. Select the machine mode and G-code interpretation profile through KAIJU
Machine Mode; saved per-program choices can override automatic detection.
Use Trace for repeated loop occurrences and Play for execution inspection.
In Dual View, Shared axis X pairs X-Y with X-Z so depth is visible too.

Alert visibility and formatting output depend on your settings. The diagnostics
file intentionally cannot provide a clean Trace until its errors are repaired.
The syntax gallery demonstrates highlighting, not controller support for every
token combination. Existing PNG screenshots are retained as documentation assets.
