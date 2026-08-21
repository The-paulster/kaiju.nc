# KAIJU Alias

**Sources:** `src/kaijuAlias/`

## Responsibility

KAIJU Alias owns the user command that toggles macro-alias comments and the
document-level alias mode state used by the right-side status indicator. Its
`options.js` owns Alias configuration reads.
Square-bracket annotations and curly-brace annotations are excluded from the
generated alias phrase/name while remaining in the source comment.

## Connections

- Uses `MetaMacroEngine` to parse aliases and evaluate shared macro forms.
- Uses `MetaTextRanges` to avoid protected text while editing/scanning.
- `MetaMachineMode` presents Alias mode status; Alert may consult Alias state.

## Boundary

Alias owns source editing and its mode semantics, not generic macro parsing or
hover/report presentation. Other features that need aliases must use the Macro
Engine rather than reproduce Alias command behavior.
