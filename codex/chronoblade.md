# Chronoblade

[Back to KAIJU Codex](README.md)

KAIJU Chronoblade estimates where a G-code program spends its cycle time. It
separates cutting, rapid travel, dwell, tool changes, and configured M-code
events, then shows the moves and assumptions behind the totals. The report
identifies sections with high estimated cost, including repeated work from
macro loops.

Chronoblade is an estimate, not a stopwatch or a machine simulation. Its
results depend on the program, the selected machine mode and G-code profile,
and timing values you provide for operations the code cannot measure.

## Quick start

1. Open a file recognized by VS Code as G-code. Choose the correct machine
   mode and G-code profile for that program.
2. Clear the editor selection to analyse the whole document, or select lines
   before opening Chronoblade to analyse that section.
3. Run **KAIJU Chronoblade** from the editor context menu or Command Palette.
   The shortcut is **Ctrl+Alt+C** on Windows/Linux or **Cmd+Alt+C** on macOS.
4. Check the **Motion** selector, timing inputs, summary cards, and report rows.

The report remembers whether it was opened for the whole document or a
selection. To change that scope, select the desired text in the source editor
and run Chronoblade again.

## Trace versus As written

**Motion: Trace** is the default. It uses the prepared execution path, so a
line executed three times in a loop contributes three moves and three timing
entries. Branches and jumps follow the path KAIJU resolved. Trace therefore
includes the repeated work of a program.

**Motion: As written** reads each authored line once. It is useful for
comparing the source with the expanded Trace, but it cannot represent the
total work done by a repeating loop. A saved As written choice stays with that
program until you change it.

For example:

```gcode
#100 = 0
G21 G90 G94
G00 X0. Y0.
WHILE [#100 LT 3] DO1
    #100 = #100 + 1
    G01 X[#100 * 10.] F300.
END1
M30
```

At 300 mm/min, the cutting part of this example compares as follows:

| Motion | Cutting moves analysed | Cut distance | Cutting time |
| --- | --- | ---: | ---: |
| Trace | X10, X20, X30 | 30 mm | 6 s |
| As written | Authored motion line once | 10 mm | 2 s |

The difference is the two additional executions of the loop body. If Trace
cannot be used, Chronoblade displays a warning and falls back to as-written
timing. If Trace had to assume zero for an unresolved macro, it warns about
that assumption, which affects the interpretation of the result.

## Report structure

The summary cards show **Total**, **Cutting**, **G0**, **Dwell**, **Tool**,
**Distance**, **Cut distance**, and **Other**. Total is the sum of timing rows
whose time is known; a row with unknown time cannot be included in it. The
table identifies those incomplete contributions to the Total.

Each report row shows its code, start and end position, distance, feed,
spindle state, RPM used, its own time, and accumulated total. This lets you
trace a large number back to a specific move or event. The **Line** selector
changes how rows are identified: **Source** points to the original program,
while **Trace** gives each executed occurrence a unique execution-order
number. Changing the line display does not change the timing calculation.

`N` labels divide the table into sections. A label's **Time** is the estimate
for its own section; its **Total** is the accumulated estimate through that
section. Clicking a label collapses or expands its rows without changing any
totals. **Hide zero labels** removes zero-time sections from the display, and
**Trim zeros** shortens displayed decimal values while retaining G-code
decimal points.

## Timing assumptions

The three timing fields at the top of the report fill in machine-dependent
time that the program text does not specify:

- **G0 rate** is the rapid-traverse rate in program units per minute. It is
  used to estimate G0 motion time.
- **Tool swap** is the base number of seconds charged when the selected tool
  changes.
- **Extra station** adds seconds for each turret station beyond an adjacent
  tool change. It matters when tool numbers move across multiple stations.

For example, with Tool swap set to 4 seconds and Extra station to 0.5 seconds,
`T01` contributes 4 seconds as the first tool and a later change to `T03`
contributes 4.5 seconds. Those numbers are assumptions you can change to fit
your machine; they are not read from the controller.

The **Profile** selector stores reusable timing assumptions. **Edit** creates
or changes profiles with G0 rate, Tool swap, Extra station, and literal
M-code durations. For example, assigning 3 seconds to `M05` adds an **Other**
event each time an executed `M05` appears. In Trace, a configured M-code
inside a loop is counted for every occurrence. Choosing a profile resets that
program's three timing-field overrides to the profile values; changing a
field afterward creates a per-program override, marked by `Profile*`.

Feed mode and spindle state affect cutting estimates. For turning, Chronoblade
uses the active machine mode and G-code profile to interpret feed per minute,
feed per revolution, fixed RPM, and constant surface speed. Its CSS estimate
accounts for changing diameter and a programmed `G50 S` RPM limit when those
values are available. Rows with unknown time or RPM limit comparison with a
real cycle; acceleration, tool load, and shop process time can also change the
result.

## Live report updates

**Live** refreshes an open report after a successful update to the source
program's execution Trace. If the newest Trace is unusable, Chronoblade shows
a warning rather than treating it as a fresh result. Rerunning Chronoblade
after an edit also regenerates the report.

## Guided example

For a guided report with a depth loop, tool change, arcs, and a dwell, open
[Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc). Set **Mill**
and **FANUC / ISO**, clear the selection, and compare Trace with As written.
