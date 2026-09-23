# Macro Hunter

[Back to KAIJU Codex](README.md)

KAIJU Macro Hunter follows macro values through KAIJU Trace's analysis of a
program. It shows the resolved macro state at the source line under the active
editor caret, along with names from KAIJU Alias when available.

By default, the sidebar follows the caret. Select **Pin** to keep it on the
current source line while you move elsewhere; select **Unpin** to follow the
caret again.

If a source line occurs more than once during program flow, use the occurrence
selector to move between its occurrences and compare the macro state at each
one. Select a macro in the table to see its value history across those
occurrences.

Macro Hunter shows values from KAIJU Trace's program analysis. These are not
readings from a live machine.
