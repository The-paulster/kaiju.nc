# Reconstructor

[Back to KAIJU Codex](README.md)

KAIJU Reconstructor formats the active G-code document. It standardizes code spacing, decimal presentation, tool words, comments, and loop indentation according to the selected options. It changes the document text, so the result can be reviewed in the editor before it is saved.

## Quick start

1. Open a file recognized by VS Code as G-code.
2. Run **KAIJU Reconstructor** from the editor context menu or Command Palette. The shortcut is **Ctrl+Alt+R** on Windows/Linux or **Cmd+Alt+R** on macOS.
3. In **KAIJU.NC Format Options**, select one decimal-place choice and optionally **Auto semicolon inserter**, then press Enter. Escape cancels without formatting.
4. Review the changed document, especially address values, tool codes, comments, and indentation.

VS Code's **Format Document** action also uses Reconstructor for G-code files. It applies the configured settings directly; the **KAIJU Reconstructor** command opens the options picker for decimal places and semicolons before formatting the whole document.

## What formatting changes

| Area | Behavior |
| --- | --- |
| Code words and spacing | Written G-code is uppercased and compact address words are separated; G and M codes receive consistent numeric presentation. |
| Decimal values | Configured address letters use the selected number of decimal places. Missing decimal points can be added when that setting is enabled. |
| Macro expressions | Numeric values and operator spacing inside supported expressions are formatted. Named Alias macros such as `#finish_allowance` retain their spelling. |
| Tool words | Numeric tool codes can be normalized without inventing an offset, for example `T9` to `T09` and `T606` to `T0606`. |
| Comments | Existing comment text is preserved during code-word formatting. Nested comment parentheses are converted to square brackets inside the outer comment. |
| Indentation | WHILE/END blocks are indented using the selected leading-whitespace policy and detected indent style. |

For example, with three decimal places and tool-code normalization enabled:

```gcode
g1x1.z-2.5f.2
T9
T606
```

becomes:

```gcode
G01 X1.000 Z-2.500 F0.200
T09
T0606
```

The [Reconstructor example](../examples/01-reconstructor.nc) contains untidy source blocks for a longer before-and-after inspection.

## Options and settings

The command picker changes **decimal places** and **Auto semicolon inserter** for that invocation. The other formatting rules come from the `kaijuNC.format` settings. **Format Document** reads those settings without showing the picker.

| Setting | Effect |
| --- | --- |
| `kaijuNC.format.enabled` | Enables the G-code Format Document provider. |
| `kaijuNC.format.decimalPlaces` | Default number of digits after the decimal point, from 0 to 9. |
| `kaijuNC.format.addMissingDecimal` | Adds decimal points to configured numeric address values when absent. |
| `kaijuNC.format.decimalAddressLetters` | Chooses which address letters receive decimal formatting; the default is `XYZUVWABCIJKRF`. |
| `kaijuNC.format.autoSemicolon` | Sets the command picker's initial semicolon choice and applies to Format Document. |
| `kaijuNC.format.normalizeToolCodes` | Enables numeric `T`-word normalization. |
| `kaijuNC.format.leadingWhitespace` | Chooses whether leading whitespace is preserved, preserves tabs and full soft tabs while removing stray spaces, or is normalized by loop depth. |
| `kaijuNC.format.softTabSize` | Sets how many leading spaces count as an intentional soft tab. |

The default leading-whitespace mode is `preserveTabs`. The other values are `preserve` and `normalize`. Auto semicolons are off by default. A named macro remains named through formatting; [Alias](alias.md) controls conversion between named and numbered macros.

## Interpretation limits

Reconstructor edits presentation, including numeric spelling and spacing. It does not evaluate macro values, validate motion, or translate a program to another controller dialect. Formatting can affect code conventions used by a particular control, so the changed document should be checked against the intended machine's requirements. [Alerts](alerts.md) covers supported static checks, while [Sense](sense.md) presents resolved editor context.
