# KAIJU Vision

**Sources:** `src/kaijuVision/`

## Responsibility

Vision is the interactive motion-inspection report. It owns the command and
webview lifecycle, canvas/SVG/table rendering, inspection controls, work-offset
presentation, marker/label layout, including the contextual or persistent
semantic-marker legend, the compact playback entry control, and Vision-specific
options.

## Connections

- Consumes shared rows, geometry, modal meaning, and tool metadata from
  `MetaMotionEngine`.
- In Trace motion mode, consumes the shared `MetaExecutionTrace` execution
  stream. Its top-level per-program Macro drawer saves missing initial values
  and, when explicitly enabled, substitutes header initialisations before the
  first executable G/M block.
- Passes its enriched `MetaExecutionTrace` snapshot to Decomposition for
  formatted Trace-line node details, without executing the program again.
  Repeated executions show unique generated-document line numbers and fully
  substituted instructions. The Node line control selects that Trace output or
  the authored Source program details, including endpoint and cycle label line
  identifiers; Source program is used for As-written motion.
- Its options use `MetaMachineMode` defaults.
- Its motion rows and legend use profile-resolved `instruction` and
  `motionDisplayWords` data returned by `MetaMotionEngine`.
- It shares interpretation with Chronoblade and Sense, but provides its own
  inspection-first rendering.

## Boundary

Vision is not a second G-code parser or a full simulator. It may choose bounded
rendering samples and visual merging, but it must preserve useful inspection
detail—paths, arrows, labels, and tool/section information. Place reusable
motion/geometry changes in Meta and preserve existing report semantics.

For profiles with lathe polar interpolation bindings, Vision displays the
Cartesian face path produced by `MetaMotionEngine`, including sampled polar
linear and arc moves. Select the X-Y plane to inspect that face geometry; the
lathe default remains the configured Z-X view.

For physical rotary C paths, use lathe mode and ordinary C moves outside
G12.1. Select X-Y for the face view: X40 C0/C90/C180/C270/C360 traces a circle
of radius 20 in Diameter mode, or 40 in Radius mode. Positive C runs from +X
toward +Y; explicit full turns and simultaneous X/Z moves are sampled. C stays
an angle in node details and playback coordinates.
Once resolved, C is included in visible endpoint labels, merged-node summaries,
and hover details, retaining its last value on subsequent linear moves.
C coordinates in hovers and the playback readout use the editor's default
C-axis purple (#C678DD).
The first C move assumes C0 if no previous angle is known. This inspection convention does not infer
controller-specific shortest-path indexing, spindle engagement M codes, or
rotary timing. G12.1 continues to interpret C as a virtual Cartesian coordinate.

Hovering a merged node shows its combined entries. Clicking that node pins an
interactive, scrollable entry list; clicking elsewhere in the Vision viewport
releases it. Ordinary one-entry nodes retain their hover-only detail.
Vision saves its main display controls, offsets, and macro-value entries per
source program in workspace state; its macro drawer only lists macros present
in that program. Its optional Live control refreshes the open report after its
source program's passive Trace completes successfully. If the newest Trace is
unsafe or cannot be read, Vision retains the last usable report and shows a
hoverable Live warning explaining that the report is not current.

Vision also uses the source program's saved Machine Mode profile, with the
global Machine Mode setting as the fallback. Changing that profile refreshes an
open Vision report and resets only that program's saved Auto-plane choice.

When Live successfully refreshes the report, Vision retains the current plane's
pan and zoom viewport. Fit and selecting a different plane deliberately reset
that viewport.

Changing KAIJU Machine Mode resets the active source program's saved Vision
plane to that machine profile's configured Vision default, while retaining its
other Vision settings. With Vision plane set to Auto, the default settings are
X-Y for Mill and Z-X for both lathe profiles; each profile's default can be
changed independently in Settings.

The top-level Offsets and Macro controls open their panels directly; Vision has
no intermediate Data menu. The Offsets panel presents G53-G59 as coordinate
frames whose X/Y/Z offsets are always applied. Committing an axis value or
changing Ref. immediately reanalyzes the toolpaths while retaining the panel
for continued editing. Apply saves the per-program positions, the single Ref.
selection, and the independent Show axes selections. G53 is the default
reference. The View panel's Zero lines control is the master visibility switch:
when it is on, every frame selected under Show axes draws axes through its zero
relative to the selected reference.
The Visibility drawer also contains an optional Grid control and a program-unit
Size field. The grid is off by default, is anchored to the displayed zero
coordinates, and draws behind the toolpath.
G53 is selected under Show axes by default. Reset to defaults removes the
per-program values and restores those G53 defaults, matching the Macro values
panel's reset behavior.

The selected Ref. row is always X0/Y0/Z0 and its axis fields are disabled.
Selecting another reference rebases every frame around it before recalculating,
so the existing toolpath relationships do not move.

Offsets also contains an **Assumed start** selector and X/Y/Z fields. It
defaults to G53 X0/Y0/Z0 and supplies Vision's physical tool position before
the first programmed move. The selected frame applies only to those entered
start coordinates; it does not select a modal work frame for the program.

Coordinate-frame offsets affect only rendered placement. Vision's table,
labels, hovers, and playback position continue to show the coordinates authored
in each move's active G53-G59 frame.

At a coordinate-frame switch, Vision renders the move's start using the prior
frame and its destination using the newly active frame. A G53 move therefore
ends at its authored machine-coordinate target rather than inheriting the
previous work offset.

After a non-modal G53 move, or whenever the active work frame changes, Vision
rebases its stored position into the frame used by the next command. An X-only
move therefore preserves the tool's physical Y/Z position rather than treating
the prior frame's numeric values as coordinates in the new frame.

Vision playback is a frozen Trace-backed inspection session, not a machine
simulation. The compact Play control walks existing execution occurrences and
uses the established Source/Trace line mapping. It presents the selected code,
a five-line execution context with the active line highlighted, and an optional
docked right-side macro list with Macro, Alias, and Value columns. Values are
displayed in a dedicated non-clipping Value column. By default they show three
decimal places, retaining up to six when the executed assignment explicitly
defines greater precision. `kaijuNC.vision.playbackMacroSignificantFiguresOnly`
instead trims insignificant zeroes. The list can sort numerically or by most
recently updated macro, and its close button returns the reserved width to
Vision. Its canvas retains completed moves with a fading
trail that advances only when a motion or cycle occurs. Starting playback locks
the current usable Trace snapshot and
suppresses Live refreshes, opens frozen at its first event, and changes the
compact far-right Play control to a red Stop control. Live is an independent,
horizontal refresh checkbox. The zoom readout sits with the simple G0/G1 legend
above the viewer. Stop exits playback and rebuilds ordinary Vision.
Clicking a playback context line focuses and reveals that authored source line
in the G-code editor, even while Trace output is displayed.
Playback must only consume prepared execution data; it must never evaluate
G-code while stepping or scrubbing. A current-position canvas dot stays at the
last resolved tool position, using orange for rapid, yellow for cutting motion,
lime for tool changes, pink for macro maths, light blue for M commands, red for
spindle changes, green for G41/G42/G43/G44/G46 compensation and purple for
G40/G49 cancellation, and dark blue for flow or other non-motion execution.
The persistent semantic-marker legend includes these
playback-dot colours and meanings; an S word takes precedence over a companion
M word on a combined spindle block. A compact, axis-coloured bottom-of-view
readout shows the active tool position for every axis used anywhere in the
source program; axes remain visible once encountered and use `—` until a
position is resolved.

C appears in that readout only when the source program commands a C word.

## Dual view

Vision can toggle a synchronized second projection inside the same webview. In
Dual View, the individual Plane control is replaced by **Shared axis**. Vision
derives both panes from that one selection: X shows X-Y and X-Z, Y shows Y-X
and Y-Z, and Z shows Z-X and Z-Y. The panes consume the same motion rows,
Trace/playback position, visibility, offsets, labels, endpoints, grid, tool
colours, and other inspection state. Pressing **Single View** returns to the
saved per-program Plane selection.

Zoom is shared at one real-world scale: both panes use the larger projected fit
extent as their common basis, so equal zoom percentages represent equal units
per pixel. Panning is stored as X/Y/Z world-axis view offsets and projected
into each pane, so moving an axis in one pane moves that same axis in every pane
that displays it without incorrectly coupling unrelated axes. Fit View clears
all three shared view offsets and restores 100% zoom. The dual-view toggle and
shared-axis selection are webview presentation state; the single-view Plane
remains the per-program saved Vision plane.

## Rendering and playback performance

Vision coalesces navigation updates into animation frames and retains each
viewport's canvas and overlay container. Per-projection visibility results,
fit bounds and path-bound indexes are reused until the geometry or filters
change. Dual View computes a common units-per-pixel fit for both panes.
The path index preserves draw order and includes segments crossing the viewport.

Playback consumes indexed execution positions and updates macro values
incrementally when stepping forward, retaining checkpoints for backward seeks
and scrubbing. It skips hidden labels and macro-panel HTML work. Non-motion
events reuse the path image while updating the current-position dot and readout.
The playback stepping interval remains 350 ms.

Retained path chunks preserve the sampled geometry, stroke grouping, dashes
and opacity. Their cache has a 16 MiB estimated allocation budget; each viewport
also retains one image at its current canvas resolution. Projection wrappers
share source-row metadata, arrow calculations retain their latest scale, and
tooltip HTML is generated on demand. The existing label-cache setting remains
in effect, including accounting for generated tooltip HTML. Label prewarming
uses separate cancellable jobs for the projections and yields between batches
of targets, merging and indexing. Initial scene preparation and foreground
cache misses can still require synchronous work.
