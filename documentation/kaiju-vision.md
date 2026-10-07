# KAIJU Vision

**Sources:** `src/kaijuVision/`

## Responsibility

Vision is the interactive motion-inspection report. It owns the command and
webview lifecycle, canvas/SVG/table rendering, inspection controls, work-offset
presentation, marker/label layout, including the contextual or persistent
semantic-marker legend, the compact playback entry control, and Vision-specific
options.

## Canned cycles

Basic G17/G90 mill drilling generates rapid/feed/retract motion through the shared cycle module and Motion Engine. Generated rows retain cycle identity and source/Trace occurrence links. Other mill entries retain depth markers with explicit expansion warnings; these are schematic. Lathe references are documented-only.

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

Without applied machine settings, the feature retains its own rapid-rate
setting and uses Generic Machine's rate as the fallback. The removed
Chronoblade rapid-rate setting is no longer read.

Applied machine profiles provide shared rapid-rate and C-axis wrapping/reset
settings through `MetaMachineMode`. Vision uses the resulting shared geometry
and position events. After explicit cancellation, turning geometry uses the C0
lathe plane even when the profile retains C. The dotted connector marks that
projection change; re-engagement restores placement at the retained angle.
Its shared motion options also carry C absolute travel rules, rotary feed
interpretation, axis rapid rates, spindle caps, CSS units, and startup modes.
Physical path distance stays physical when the report's controller feed length
uses a different rule. Axis rapid timing does not change the drawn trajectory.

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
toward +Y; explicit full turns and simultaneous X/Z moves are sampled. The full
commanded sweep is drawn, then the retained C position is reduced to 0-360
degrees. A rapid C0 after full H360 turns therefore starts from C0 instead of
showing an artificial multi-turn return. C stays an angle in node details and
playback coordinates.
Once resolved, C is included in visible endpoint labels, merged-node summaries,
and hover details, retaining its last value on subsequent linear moves.
C coordinates in hovers and the playback readout use the editor's default
C-axis purple (#C678DD).
Both built-in lathe profiles interpret `M45` as C-axis engagement and `M46` as
cancellation. After `M46`, Vision projects subsequent turning moves on the C0
lathe plane.
Labels and details retain the profile-controlled C coordinate; playback updates
at the cancellation block without drawing a move. The C readout shows
`(Lathe mode; retained)` when reset is disabled, or `(Lathe mode)` when enabled.
`G13.1` cancels polar interpolation separately.
When C cancellation or re-engagement changes the projected position, Vision joins the positions
before and after the reset with a muted, closely dotted connector in both
Source and Trace views. Its tooltip identifies the projection reset. The
connector is not a motion row and contributes no travel or time; rapid moves
retain their longer dashes.
The first C move assumes C0 if no previous angle is known. This inspection convention does not infer
controller-specific shortest-path indexing, rotary unwind, or spindle engagement
M codes. G1 rotary timing uses the conventional one-linear-unit-per-C-degree
controller-feed model; Vision's distance and path drawing still use physical
swept travel. Rotary G0 and G2/G3 timing remains unknown. G12.1 continues to
interpret C as a virtual Cartesian coordinate.

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
Refreshing machine settings preserves an open report's chosen plane when its
mill/lathe type is unchanged. A type change still selects that type's default.

The top-level Offsets and Macro controls open their panels directly; Vision has
no intermediate Data menu. Work frames are labelled `WCS1 (G54)` through
`WCS6 (G59)` using the active profile bindings, including custom selector words.
An unbound selector is labelled `WCSn (unbound)`. The same labels appear in the
Offsets panel, assumed-start selector, WCS visibility filters, and motion table.
G53 remains the machine frame; internal frame keys and saved offsets stay unchanged.
View > WCS numbers is off by default and saved per program. It shows 1-6 above
nodes independently of Labels, or M for the machine frame. Merged nodes combine
distinct identifiers, such as 1/2. Node tooltips always show the full bound frame
label; a move's start and end nodes use their respective frames. WCS numbers are
hidden during playback with the other static node labels. Their contrast outline
is 35% thicker than ordinary node text for readability, and their font is 5%
larger than ordinary node text.
The Offsets panel presents G53-G59 as coordinate frames whose X/Y/Z/C offsets are always applied (C is in degrees). Machine
profile defaults supply unsaved values. Committing an axis value or
changing Ref. immediately reanalyzes the toolpaths while retaining the panel
for continued editing. Apply saves the per-program positions, the single Ref.
selection, and the independent Show axes selections. Saved offsets are shared
with Chronoblade; preview edits affect Vision until Apply. G53 is the default
reference. The View panel's Zero lines control is the master visibility switch:
when it is on, every frame selected under Show axes draws axes through its zero
relative to the selected reference.
The expanded View panel also contains the optional Grid control and program-unit
Size field, plus Tools and WCS visibility filters. The grid is off by default,
is anchored to the displayed zero coordinates, and draws behind the toolpath.
G53 is selected under Show axes by default. Reset to defaults removes the
per-program values and restores the selected machine profile's offsets and
the G53 reference/visibility defaults.

The selected Ref. row is always X0/Y0/Z0/C0 and its axis fields are disabled.
Selecting another reference rebases every frame around it before recalculating,
so the existing toolpath relationships do not move.
These panel values are presentation coordinates only: preview analysis and
saved offsets retain their G53-relative values. Reopening the panel converts
those values back to the selected reference, including C in degrees.

Offsets also contains an **Assumed start** selector and X/Y/Z fields. It
defaults to G53 X0/Y0/Z0 and supplies Vision's physical tool position before
the first programmed move. The selected frame applies only to those entered
start coordinates; it does not select a modal work frame for the program.

Coordinate-frame offsets affect rendered placement and shared travel/time
calculations when frames change or G53 is used. Vision's table, labels, hovers,
and playback position retain coordinates in each move's active G53-G59 frame.
The shared engine rebases the calculation start into the destination frame,
preserving omitted axes and the physical C angle across frame switches.

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
derives both panes from that one selection. **X horizontal** shows X-Y and X-Z,
while **X vertical** shows Y-X and Z-X; the same horizontal/vertical choices
are available for Y and Z. The panes consume the same motion rows,
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

Labels, tool-change labels, and compass lettering retain their configured CSS
pixel sizes independently of the shared-world fit and zoom level.

## Rendering and playback performance

Vision uses a retained WebGL renderer for motion paths by default. It keeps
line-edge coverage and playback opacity in a consistent premultiplied-alpha
pipeline. Solid edges and the screen-space rapid-dash mask use fragment
derivatives for a one-device-pixel antialiasing transition at every zoom; rapid
dash position is measured from each fragment's screen coordinate rather than an
interpolated path-distance varying. It keeps
projected segment, colour, and playback-occurrence buffers on the GPU, so pan
updates change only the viewport transform while labels are committed when the
drag ends. Rapid-path dash phases are reduced from double-precision path
distances when the zoom scale changes, keeping their screen-space pattern
stable without rebuilding geometry during pan. The grid is a WebGL background
pass: it remains visible while panning and preserves the configured program-unit
interval at every zoom level. The
`kaijuNC.vision.renderer`
setting can select the retained
Canvas compatibility renderer for environments where WebGL is unavailable or
unsuitable. SVG remains responsible for sparse labels, markers, zero lines,
grid, compass, and inspection interaction. Per-projection visibility results,
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


`getVisionSettingsSnapshot(document)` returns saved panel settings, effective options, the saved reference frame, and normalized macro initial values/overrides for File Settings. It does not build an execution trace or open the report.
