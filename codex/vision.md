# Vision

[Back to KAIJU Codex](README.md)

Vision is KAIJU's interactive 2D motion-inspection report. Open a G-code file
and run **KAIJU Vision** from the editor context menu or Command Palette.

## Use it for

- Viewing rapid and cutting paths in a selected plane.
- Inspecting endpoints, tool changes, coordinates, and source or Trace lines.
- Playing an already prepared Trace-backed execution sequence.
- Comparing synchronized projections with **Dual View**.

## A practical first check

1. Confirm [Machine Mode](machine-mode.md), then open Vision.
2. Choose the plane that represents the operation. Lathe work commonly uses
   Z-X; face and polar work may need X-Y.
3. Use **Fit View**, inspect markers and labels, then check offsets only when
   you need rendered work-coordinate placement.

Vision is an inspection tool, not a complete machine simulation. In particular,
rotary paths and playback do not establish controller-specific indexing,
interlocks, or safe machine execution.
