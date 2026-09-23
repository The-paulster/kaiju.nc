# Vision

[Back to KAIJU Codex](README.md)

KAIJU Vision turns a G-code program into an interactive 2D motion report. It
shows the path, its direction, tool changes, endpoints, coordinate frames,
and the motion rows behind the drawing. With **Trace** motion data, a line
inside a loop appears for every time it executes. You can inspect those
occurrences in the drawing, table, and playback instead of inferring the
final shape from the source alone.

Vision analyses the program using KAIJU's motion and execution models. It
does not read the machine's actual position or simulate its safety systems.

## Quick start

1. Open a file recognized by VS Code as G-code. Confirm its [Machine Mode and
   G-code Profile](machine-mode.md), especially whether lathe X values mean
   diameter or radius.
2. Run **KAIJU Vision** from the editor context menu or Command Palette.
3. Set **Motion data** to **Trace** for the executed path. Choose **Plane** to
   match the operation: X-Y for a mill face, Z-X for a typical lathe profile,
   or X-Z when that orientation reads more naturally to you.
4. Press **Fit View**. Use **Zoom +**, **Zoom -**, the mouse wheel, and drag to
   investigate a smaller area. Fit View restores the whole visible path.

The summary above the drawing reports move count and total distance. Rapid
and cutting paths have separate styles in the adjacent legend. The table
below gives each row's line, move, WCS, start, end, distance, and notes.
Incomplete path data and Trace warnings qualify the drawing and totals.

The [Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc) example
is a Mill program whose X-Y projection contains a rounded rectangle at three
depths and a circle from a second tool. X-Z and Dual View expose the stacked
depth passes.

## See what a loop actually draws

Consider a short depth loop:

```gcode
#100 = 0 (PASS COUNTER)
#101 = 3 (PASS COUNT)
G21 G17 G90 G94
T01 M06
G00 X0. Y0. Z5.
WHILE [#100 LT #101] DO1
    #100 = #100 + 1
    G01 Z[-#100] F120.
    G01 X40. F300.
    G00 X0.
END1
M30
```

With **Motion data: Trace**, the `G01 Z[-#100]` line contributes three depth
moves, ending at Z-1, Z-2, and Z-3. The X move is likewise executed on each
pass. X-Z displays the different depths; X-Y projects them onto the same
face path. **Motion data: As written** reads each authored line once, so it
cannot show all three loop occurrences. It is useful when you want to inspect
the source as written or compare it with the resolved Trace path.

If Trace cannot produce a usable execution path, Vision warns and shows
as-written motion. An assumed-zero macro can also change the apparent path.
The **Macro** control supplies known starting values for input macros.

## Node details and source references

The **Node line** selector controls the line and code shown in Vision's node
details. **Source program** points back to the authored file. **Trace output**
shows the expanded instruction and its unique line in the generated Trace
output. In the loop above, the same source `G01 Z[-#100]` appears in several
executed occurrences; Trace output gives each occurrence its own resolved
instruction. Node line is available when Motion data is Trace. Changing it
changes the displayed source reference, not the motion geometry.

Hovering an endpoint or event marker reveals its instruction, line, and position.
The table below the viewer is useful when a path overlaps itself; its
**Start**, **End**, **Distance**, and **Notes** columns provide the corresponding
motion details. A node
that collects several nearby endpoints shows a count such as `[3]`; hovering
reveals the combined entries. Clicking a merged node pins a scrollable list.
A second click or a click elsewhere in the viewer closes it. Zooming in may
separate nearby points.

## Tool colours and visibility

The **View** panel controls what appears in the drawing. **Tool colors** is off
by default: rapid paths are orange and cutting paths are yellow, so motion
type is easy to distinguish. When enabled, path strokes and direction arrows
use their assigned tool colours instead. The same tool keeps its colour when
it appears again later in the program. **Endpoints** controls the point
markers separately, and the table's coloured strip identifies the tool on
each row even when **Tool colors** is off.

The [Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc) example's
rounded rectangle uses `T01`, while the central circle uses `T02`. With
**Tool colors** on, the two operations separate by colour. With it off, rapid
and cutting motion styles remain distinct. Neither display choice changes
the toolpath analysis.

The other View controls are:

| Control | What it changes |
| --- | --- |
| **Labels** | Shows or hides line and coordinate text beside points. |
| **Endpoints** | Shows or hides endpoint, tool-change, and other point markers. |
| **Zero lines** | Shows axes for frames checked under **Offsets > Show axes**. It is the master switch for those axes. |
| **Legend** | Keeps the event-marker colour key visible. When off, marker hover shows its relevant key. |
| **Grid** and **Size** | Draws a background grid; Size sets the spacing in program units. |
| **Tools** | Checks individual tools to include in the drawing and motion table. **No tool** covers rows before any tool is active. |
| **WCS** | Checks individual work-coordinate frames to include in the drawing and motion table. **No WCS** covers rows with no identified frame. |

The **Tools** and **WCS** lists are visibility filters. For example, with
`T01` unchecked, only the `T02` operation remains visible. A WCS can be
isolated in the same way. Both filters apply together; a row must pass both
to appear. N-label section rows may remain in the table as headings.
Restoring all checkboxes restores the full view. Filtering changes what is
drawn and listed, not the program's execution or saved offsets. During
playback, ordinary labels and endpoint markers are hidden so the current
position and completed path remain clear.

## Colour legend

The small legend beside the zoom readout identifies the ordinary rapid and
cutting path colours. The **View > Legend** option opens the larger marker
key in the viewer. It covers fixed-meaning event markers and the moving dot
used during playback. These colours describe *what happened at a point*;
**Tool colors** assigns colours to path strokes by tool. Turning Tool colors
on does not change the meanings of the marker or playback-dot colours.

Outside playback, event markers use these colours:

| Colour | Meaning |
| --- | --- |
| Dark red `#7f1d1d` | Program end. |
| Pale yellow `#dcdc6b` | `M00` or `M01` stop. |
| Lime `#88ff00` | Tool change. |
| Red `#ff2b2b` | Spindle speed change. |
| Green `#1f7a3a` | Compensation on, such as `G41` or `G43`. |
| Purple `#8e44ad` | Compensation off, such as `G40` or `G49`. |

During playback, the moving dot marks the **current execution event**. It
stays at the last resolved tool position when the event has no motion:

| Dot colour | Current event |
| --- | --- |
| Orange `#ff8800` | `G00` rapid motion. |
| Yellow `#ffd500` | `G01`, `G02`, or `G03` cutting motion. |
| Lime `#88ff00` | Tool change. |
| Pink `#eb17e4` | Macro assignment or calculation. |
| Light blue `#9cdcfe` | M command. |
| Red `#ff2b2b` | Spindle speed change. |
| Green `#1f7a3a` | Compensation on. |
| Purple `#8e44ad` | Compensation off. |
| Dark blue `#2f6da5` | Flow control or another non-motion event. |

If an `S` word and M command share a block, the playback dot uses red for
the spindle speed change. At a location with several event markers, Vision
may combine their colours into one segmented marker. Hovering identifies
its entries; clicking pins their list. With **Legend** off, hovering a marker
shows just the relevant part of the colour key.

## Dual View projections

**Dual View** shows two synchronized projections of the same motion.
The single **Plane** selector becomes **Shared axis**. For example, **X
horizontal** pairs X-Y with X-Z, so you can inspect a face path and its depth
at once. **X vertical** pairs Y-X with Z-X. Y and Z have the same horizontal
and vertical choices.

Both panes use the same tool and WCS filters, labels, offsets, playback
position, and real-world zoom scale. Dragging a shared world axis in one pane
also moves that axis in the other. **Fit View** resets both panes together.
**Single View** returns to the previously selected Plane.

For [Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc),
**X horizontal** shows the rounded plate in X-Y and its three Z depths in X-Z.

## Trace playback

The small **Play** button opens a frozen Trace-backed inspection session. The
back and forward buttons and scrubber navigate execution events; the code
panel shows the active line among its surrounding lines. Clicking a context
line reveals that source line in the G-code editor. The current
position dot and axis-coloured position readout advance with the event. A
fading trail marks completed moves, and the dot's colour indicates the kind
of event; **View > Legend** displays the colour key.

**Macros** docks the playback macro table. It shows each macro's number,
Alias name when available, and current value. Sorting is available by number
or recent update. This supports comparison of a pass counter with the
position reached on each loop iteration. The
playback table's motion rows can also be clicked to jump to that event.

Playback starts paused at its first event. **Space** starts or pauses automatic
stepping when the code panel has focus; the other controls provide manual
navigation. **Stop** exits playback and restores the ordinary report. Playback
uses the prepared Trace snapshot; edits made while it is open do not rewrite
that session.

## Macro inputs

Vision's top-level **Macro** panel lists variables found in the program.
For a macro without a program initial value, **Apply** uses the entered
value to rebuild the Trace and motion report. This permits inspection of a
particular input case rather than accepting an assumed zero. Values are
stored for this source program; **Reset to defaults** removes them.

**Override program initial values** exposes macros initialized in the
program header. When enabled, an entered value replaces that header
initialization before the first executable G/M block for Vision's analysis.
For example, overriding the header's `#101 = 3` in the loop above with `5`
produces a five-pass path. This changes the analysis input, not the source code.

## Live report updates

**Live** refreshes an open report after the source program's Trace updates.
A successful refresh keeps the current plane's pan and zoom. If the
new Trace is unusable, Vision keeps the last usable report and shows a Live
warning that it is no longer current. Playback holds its own snapshot until
**Stop** exits the session.

## Work-coordinate placement

The **Offsets** panel contains G53-G59 frames. Entered X/Y/Z values place
paths from different work frames relative to one another. **Ref.** selects
the frame used as display zero; its fields remain at zero. Selecting a new
reference rebases the other frames. **Show axes** chooses which frame origins
to draw when **View > Zero lines** is enabled.

**Assumed start** gives Vision a physical starting position before the first
programmed move. Its frame selector tells Vision how to interpret those
entered X/Y/Z coordinates; it does not set the program's modal work frame.
Changing an axis or reference previews the new placement. **Apply** saves
the values for this program, and **Reset to defaults** restores G53 as the
reference and assumed start.

Offsets change the rendered placement of motion. The table, endpoint labels,
hover details, and playback readout continue to show each move's authored
coordinates in its active frame. When a frame changes, the drawn path and
row's WCS column show the placement and active frame respectively.

## Rotary and polar paths

For a physical lathe C-axis move, X-Y shows the face projection. In
**Lathe (Diameter)** mode, `X40 C0` lies 20 mm from the centre; `C90`,
`C180`, `C270`, and `C360` trace a full turn. In **Lathe (Radius)** mode,
`X40` lies 40 mm from the centre. Vision keeps explicitly programmed turns
and can draw simultaneous X/Z/C movement. C remains an angle in node
details and playback coordinates.

With a polar interpolation profile, `G12.1` instead makes X/C a virtual
Cartesian face path until `G13.1` cancels it. X-Y shows that shape.
[C axis and polar interpolation](../examples/05-c-axis-and-polar.nc) compares
physical rotary sweeps, an expanding X/Z/C path, and a polar
rectangle in the same program.

The machine profile determines which codes have these meanings. Vision's
rotary drawing does not establish a controller's indexing direction,
clamping, or spindle state. Verify the finished NC program with your normal
machine and setup checks before running it.
