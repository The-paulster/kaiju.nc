# Chronoblade

[Back to KAIJU Codex](README.md)

Chronoblade estimates cycle time for the active G-code document or selection.
Run **KAIJU Chronoblade** from the editor context menu or Command Palette.

## Use it for

- A breakdown of cutting, rapid, dwell, tool-change, and configured M-code time.
- Comparing a selected section with the whole program.
- Reviewing Trace execution where loops and branches affect the estimate.

## Read estimates correctly

Check the G0 rate, tool-swap time, extra-station time, and any selected timing
profile. These are assumptions, not measurements from your machine. Trace mode
counts prepared execution occurrences; As written counts each authored line.

Unresolved values, controller behaviour, acceleration, tool load, and shop
process time can all make actual time differ from the estimate.

## KAIJU Chronoblade

`KAIJU Chronoblade` cuts through wasted motion and expose the inefficiences hiding inside large NC programs.

Chronoblade opens a cycle-time analysis panel where it breaks down machine motion to help identify where cycle time is used.

* Command: `KAIJU Chronoblade`
* Shortcut: `Ctrl+Alt+C`

Chronoblade reports:

* Motion timing
* Tool-change timing
* Start and end positions
* Feed and spindle state
* RPM range during CSS cutting
* Estimated cycle contribution by operation

For CSS cutting, KAIJU.NC samples along the motion path so RPM clamp conditions from `G50` and diameter changes are reflected in the estimated timing output.