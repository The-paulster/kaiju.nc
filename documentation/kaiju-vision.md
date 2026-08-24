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
  stream. Its per-program Macro values drawer saves missing initial values and,
  when explicitly enabled, substitutes header initialisations before the first
  executable G/M block.
- Uses Decomposition's formatted output mapping for Trace-line node details, so
  repeated executions show unique generated-document line numbers and fully
  substituted instructions. The Node line control selects that Trace output or
  the authored Source program details; Source program is used for As-written
  motion.
- Its options use `MetaMachineMode` defaults.
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

Changing KAIJU Machine Mode resets the active source program's saved Vision
plane to X-Y for mill or X-Z for either lathe profile, while retaining its other
Vision settings.

The Data > Offsets panel uses Apply to save its per-program work offsets and
Reset to defaults to remove them, matching the Macro values panel's reset
behavior.

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
