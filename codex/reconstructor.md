# Reconstructor

[Back to KAIJU Codex](README.md)

Reconstructor is KAIJU's document formatter. Run **KAIJU Reconstructor** or
use the normal VS Code Format Document action in a G-code file.

It applies the configured decimal, spacing, indentation, semicolon, and tool
code presentation rules. Review the formatted result before sending a program
to a machine, especially when your shop requires a specific controller style.

Formatting changes presentation; it is not an execution validator or a
controller conversion tool.

## KAIJU Reconstructor


`KAIJU Reconstructor` is the NC formatting and cleanup command for KAIJU.NC. It normalizes spacing, repairs common layout issues, formats decimal values, and can optionally normalize tool codes.

Named alias macros such as `#finish_allowance` are preserved during formatting.

* Command: `KAIJU Reconstructor`
* Shortcut: `Ctrl+Alt+R`

Before:
```gcode
g1x1.z-2.5f.2
T9
T606
```
After:
```gcode
G01 X1.000 Z-2.500 F0.200
T09
T0606
```