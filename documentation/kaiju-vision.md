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
  the authored Source program details; Source program is used for As-written
  motion.
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
Vision saves its main display controls, offsets, and macro-value entries per
source program in workspace state; its macro drawer only lists macros present
in that program. Its optional Live control refreshes the open report after its
source program's passive Trace completes successfully. If the newest Trace is
unsafe or cannot be read, Vision retains the last usable report and shows a
hoverable Live warning explaining that the report is not current.

Vision also uses the source program's saved Machine Mode profile, with the
global Machine Mode setting as the fallback. Changing that profile refreshes an
open Vision report and resets only that program's saved Auto-plane choice.

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
G53 is selected under Show axes by default. Reset to defaults removes the
per-program values and restores those G53 defaults, matching the Macro values
panel's reset behavior.

The selected Ref. row is always X0/Y0/Z0 and its axis fields are disabled.
Selecting another reference rebases every frame around it before recalculating,
so the existing toolpath relationships do not move.

Coordinate-frame offsets affect only rendered placement. Vision's table,
labels, hovers, and playback position continue to show the coordinates authored
in each move's active G53-G59 frame.

At a coordinate-frame switch, Vision renders the move's start using the prior
frame and its destination using the newly active frame. A G53 move therefore
ends at its authored machine-coordinate target rather than inheriting the
previous work offset.

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
spindle changes, green/purple for compensation, and dark blue for flow or other
non-motion execution. The persistent semantic-marker legend includes these
playback-dot colours and meanings; an S word takes precedence over a companion
M word on a combined spindle block. A compact, axis-coloured bottom-of-view
readout shows the active tool position for every axis used anywhere in the
source program; axes remain visible once encountered and use `—` until a
position is resolved.
