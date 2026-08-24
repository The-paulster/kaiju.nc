# KAIJU Warpaint

**Sources:** `src/kaijuWarpaint/`

## Responsibility

Warpaint lets users define, reorder, color, enable, and optionally background-
tint N-label-based sections for a document. It owns its webview editor,
workspace-state storage, N-range parsing/resolution, and editor decorations.
Warpaint never modifies NC source files.

## Connections

- Uses `MetaToolModel` for existing tool colors/ranges where they inform
  decorations.
- Reuses Rangefinder's generic N-label items for selection-based sections.
- Its `enabled` setting remains available in VS Code Settings. Warpaint is not
  in the editor context menu while its authoring workflow is being reconsidered.

## Boundary

Warpaint is a per-document visual organization layer, not a general editor,
selection tool, or tool parser. It remains the owner of its stored section
model and decoration rendering even while its authoring workflow is paused.
Keep its stored section model in workspace state, preserve section
priority/order, and use Rangefinder for generic N-label selection semantics
rather than cloning them.
