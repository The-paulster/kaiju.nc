# Macro Hunter

[Back to KAIJU Codex](README.md)

KAIJU Macro Hunter shows what your macros contain at a particular point in a
program's execution. A source line inside a loop can run many times; Hunter
lets you inspect the values **after each occurrence** of that line instead of
guessing from its text. It is an Explorer-side view, so the code remains open
while you investigate.

Hunter reads KAIJU Trace's analysis. Its values are calculated from the
program, not read from a live machine, and opening it does not edit the code.

## Quick start

1. Open a file recognized by VS Code as G-code and put the caret on a line you
   want to inspect.
2. Run **KAIJU Macro Hunter** from the Command Palette or editor context menu,
   or click the macro button in the editor title. The **Macro Hunter** view
   opens in Explorer.
3. Move the caret through the source program. While unpinned, Hunter follows
   the active source line and shows its resolved macro state.
4. If the line ran more than once, use **Occurrence** to choose a pass. You can
   also scroll the mouse wheel over its selector to step through passes.

A line that ran once shows one occurrence. If Trace never reached the selected
line, Hunter says so; for example, that line may be in a branch that was not
taken. The view reports when no G-code program is active.

## What an occurrence contains

The table has **Macro**, **Value**, and **Name** columns. It shows the full
resolved macro state after the selected occurrence, not just variables
assigned on that line. An unchanged value can therefore still appear. The
Name column uses the program's header names from [KAIJU Alias](alias.md)
when available; the numeric identity remains visible in Macro.

Rows with the most recently read or assigned macros appear first. Compared
with the **previous occurrence of this same source line**, a higher value is
green and a lower value is red. An unchanged value has no change colour. The
first occurrence has no earlier occurrence on that line to compare with.

For example:

```gcode
#100 = 0 (PASS COUNTER)
#101 = 10. (STEP OVER)
#102 = 0. (CURRENT X)
#103 = 0. (CURRENT Z)
G21 G90 G94
WHILE [#100 LT 3] DO1
    #100 = #100 + 1
    #102 = #101 * #100
    #103 = -#100
    G01 X#102 Z#103 F240.
END1
M30
```

Put the caret on `G01 X#102 Z#103 F240.`. Although there is only one such
line in the source, Trace reaches it three times:

| Occurrence | `#100` Pass counter | `#102` Current X | `#103` Current Z |
| --- | ---: | ---: | ---: |
| 1 / 3 | 1 | 10 | -1 |
| 2 / 3 | 2 | 20 | -2 |
| 3 / 3 | 3 | 30 | -3 |

`#101` Step over remains 10 in all three states. From occurrence 1 to 2,
Current X increases and Current Z decreases, so their value text changes
green and red respectively. The table shows values **after** the `G01` has
executed; putting the caret on an assignment line instead shows the state
after that assignment's occurrence.

## Macro history across occurrences

Selecting a macro in the table opens its history **across every occurrence of
the selected source line**. In the example, `#102` has values 10, 20, and 30
for occurrences 1, 2, and 3. The occurrence selector displays each pass's
complete macro state, while a different table row changes the history shown.

This history is specific to the line under inspection. For a quick value at
one editor position, a Sense hover may be enough; Hunter is useful when you
need to compare the middle passes of a long loop as well as the first and
last ones.

## Source-line pinning

**Pin** fixes Hunter to the current source line. Hunter displays `Pinned to
L...` and retains that line when the caret moves or another editor opens.
Occurrence selection and macro histories remain available. **Unpin** resumes
following the active caret. The pin refers to a source line, not a machine
position or a single loop pass.

If you edit the pinned document, Hunter rebuilds its values from the updated
program. Closing that document clears the pin.

## Trace assumptions and limits

Hunter uses the same bounded execution model as KAIJU Trace. An input macro
with no known initial value may be assumed to be zero, and a problem or
execution limit can leave a path incomplete. The right-side **KAIJU Trace**
status and its tooltip expose assumptions and flow problems that qualify
Hunter's values. [Decomposition](decomposition.md) supports interactive
starting-value input when a macro value is missing.

For a longer hands-on example, open
[Macros, Sense, Macro Hunter, and Alias](../examples/06-macros-sense-hunter-and-alias.nc).
It has twelve occurrences on one motion line; try occurrences 1, 6, and 12,
then pin that line and inspect a macro's full history.
