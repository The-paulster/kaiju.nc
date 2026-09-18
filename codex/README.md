<img src="../media/kaiju-nc_banner_400.png" alt="KAIJU.NC banner" width="900">

# KAIJU Codex

Practical guidance for working with G-code in KAIJU.NC.

Open this guide from **KAIJU Codex** in a G-code editor's context menu or from
the Command Palette.

## Tools

- [Vision — inspect toolpaths, coordinates, and playback](vision.md)
- [Chronoblade — estimate cycle time](chronoblade.md)
- [Decomposition — inspect executed program flow](decomposition.md)
- [Sense — understand the code under the cursor](sense.md)
- [Alias — work with named macro variables](alias.md)
- [Machine Mode and G-code Profiles](machine-mode.md)
- [Alerts — understand diagnostics](alerts.md)
- [Syntax and editor colours](syntax.md)
- [Reconstructor — format a program](reconstructor.md)
- [Rangefinder and Warpaint — work with N-label sections](sections.md)

## Examples

Click a program to open it in the editor. Each example includes comments
explaining what to try, which settings to use, and what to look for.

- [Reconstructor](../examples/01-reconstructor.nc) - Try formatting deliberately untidy code.
- [Diagnostics and Orphan Killer](../examples/02-diagnostics-and-orphan-killer.nc) - Find intentional errors and follow the suggested fixes.
- [Syntax gallery](../examples/03-syntax-gallery.nc) - Explore comments, addresses, expressions, and control-flow highlighting.
- [Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc) - Inspect a rounded plate, repeated depth passes, and cycle-time estimates.
- [C axis and polar interpolation](../examples/05-c-axis-and-polar.nc) - Inspect full turns, a spiral, retained angles, and a polar face path.
- [Macros, Sense, Macro Hunter, and Alias](../examples/06-macros-sense-hunter-and-alias.nc) - Try readable macro names, hovers, and loop-occurrence histories.

These are editor and inspection demonstrations, not machine-ready programs.

## Start here

1. Set the program's [Machine Mode and G-code Profile](machine-mode.md).
2. Use [Vision](vision.md) to inspect the path before relying on a
   program at the machine.
3. Use [Chronoblade](chronoblade.md) as an estimate, checking its
   assumptions against your machine and process.

KAIJU assists inspection and preparation. It does not replace controller
documentation, prove machine safety, or simulate every controller behaviour.
