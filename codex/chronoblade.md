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
