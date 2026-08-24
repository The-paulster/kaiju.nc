# KAIJU Vision

**Sources:** `src/kaijuVision/`

## Responsibility

Vision is the interactive motion-inspection report. It owns the command and
webview lifecycle, canvas/SVG/table rendering, inspection controls, work-offset
presentation, marker/label layout, including the contextual or persistent
semantic-marker legend, and Vision-specific options.

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
in that program.
