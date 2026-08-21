# KAIJU Rangefinder

**Sources:** `src/kaijuRangefinder/`

## Responsibility

Rangefinder selects meaningful spans in the active editor: the current or
chosen tool range, a range between N labels, or the current N block. It owns
selection UI and reusable generic N-label item/span helpers.

## Connections

- Uses `MetaToolModel` for tool ranges.
- Uses `MetaTextRanges` while recognizing N labels.
- Warpaint reuses its generic N-label helper for selection-to-section mapping.

## Boundary

Rangefinder selects; it does not color sections, parse tools, or produce
reports. Shared N-label selection semantics belong here rather than in
Warpaint, while Sense owns label navigation and hovers.
