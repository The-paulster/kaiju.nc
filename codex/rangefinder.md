# Rangefinder

[Back to KAIJU Codex](README.md)

KAIJU Rangefinder selects a useful span of the open G-code program without
changing its text. Tool sections and numbered blocks can then be inspected,
copied, or supplied to another selection-aware tool. The result is a normal
VS Code editor selection that remains adjustable.

## Quick start

1. Open a file recognized by VS Code as G-code. Put the caret in the section
   you want if you plan to use a **Current** action.
2. Run **KAIJU Rangefinder** from the editor context menu or Command Palette.
   The shortcut is **Ctrl+Alt+F** on Windows/Linux or **Cmd+Alt+F** on macOS.
3. Choose one of its four actions from the menu. Rangefinder selects the
   corresponding complete lines and brings them into view.

## Selection actions

| Action | What it selects |
| --- | --- |
| **Current Tool Range** | The tool section containing the caret, from its tool call through the line before the next tool call, or to the end of the file. |
| **Tool Range...** | A tool section you choose from the program's list of detected tool calls. The picker shows the tool, line span, and a preview of its first line. |
| **Between N Labels...** | Every line from one selected `N` label through another, including both label lines. Separate menus select the two labels. |
| **Current N Block** | The block containing the caret, starting at the nearest preceding `N` label and ending on the line before the next `N` label, or at the end of the file. |

For example:

```gcode
O1200 (MOUNTING PLATE)
N10 (SETUP)
G21 G90 G17
N100 T01 M06 (FACE MILL)
G00 X0. Y0. Z5.
G01 Z-0.5 F200.
N200 (SECOND FACE PASS)
G01 X80. F500.
N300 T02 M06 (DRILL)
G00 X20. Y20. Z5.
N400 M30
```

With the caret on `G01 Z-0.5 F200.`:

- **Current Tool Range** selects `N100 T01 M06` through `G01 X80. F500.`.
- **Current N Block** selects `N100 T01 M06` through `G01 Z-0.5 F200.`.
- **Tool Range...** lets you choose either the `T01` or `T02` section, regardless
  of where the caret is.
- **Between N Labels...**, choosing `N100` and `N300`, selects both label lines
  and all lines between them. Choosing them in reverse produces the same span.

## Selection boundaries

A tool section begins on a detected `T` call. Its last line is immediately
before the next detected `T` call; the final tool section extends to the end
of the file. Lines before the first tool call are outside every tool section,
so **Current Tool Range** has no range to select there. If there are no tool
calls, **Tool Range...** has no entries.

An `N` block begins at an `N` label at the start of a code line. It ends
immediately before the next such label; the last block extends to the end of
the file. **Current N Block** has no block before the first label. **Between N
Labels...** needs at least two labels in the file. `N` text inside a comment
is ignored when building the label list.

Rangefinder works with **source lines**. If a macro loop executes one line
multiple times, the selection still contains that written line once.
[Macro Hunter](macro-hunter.md) and [Decomposition](decomposition.md) show
its separate executions.
