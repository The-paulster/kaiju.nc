# Alias

[Back to KAIJU Codex](README.md)

KAIJU Alias lets you switch between numbered macros and readable names while
editing a G-code document. A comment in the program header gives each number
a name; the command then replaces matching references throughout the active
document. A second invocation restores numeric references.

Alias is an editing aid that changes document text. The resulting diff matters
when the program is used elsewhere. Alias names are not a controller
dialect or a substitute for checking what your control accepts.

## Quick start

1. Open an NC file recognized by VS Code as G-code.
2. Give the macros short names in comments **before the first executable G or
   M block**. Keep the numeric macro in each definition.
3. Run **KAIJU Alias** from the editor context menu or Command Palette. The
   shortcut is **Ctrl+Alt+A** on Windows/Linux or **Cmd+Alt+A** on macOS.
4. Read the converted program. Run **KAIJU Alias** again to restore numeric
   references.

The command acts on the active document, not just a selection. If it finds no
numeric macros in the header, or finds macros but no naming comments there,
it reports that instead of making an edit.

## Header name definitions

Alias scans from the top of the file and stops at the first executable G or M
code. A G or M code inside a comment does not end the header. Naming comments
therefore belong above setup blocks such as `G21` or `M06`.

One supported form places the name in a comment on the assignment line:

```gcode
#140 = 0.20 (FINISH ALLOWANCE [mm])
#141 = 0.30 (ROUGHING FEED [mm/rev])
G21
```

Another form uses a comment-only dictionary followed by real assignments:

```gcode
(#140 = FINISH ALLOWANCE [mm])
(#141 = ROUGHING FEED [mm/rev])
#140 = 0.20
#141 = 0.30
G21
```

The comment supplies the **name**; the assignment supplies the **value**. A
comment-only entry does not assign a macro value. For either style, put the
definition above the first executable G/M block. If the same numeric macro is
named more than once, the first name found is used.

Names are generated from the comment text: `FINISH ALLOWANCE` becomes
`#finish_allowance`. Spaces and punctuation become underscores, and letters
become lowercase. Short, distinct names retain readability in motion blocks.

Square brackets or braces can hold units and longer notes. Text starting at
the first `[` or `{` remains in the comment but is excluded from the name:

```gcode
#101 = 5.000 (STEP OVER [mm per pass])
```

This produces `#step_over`, not a name containing `mm_per_pass`.

## Follow one conversion

This header names position, feed, tool, and spindle macros before the first
G-code block:

```gcode
#100 = 0.000 (START X [mm])
#101 = 5.000 (STEP OVER [mm])
#102 = 240.000 (CUTTING FEED [mm/min])
#103 = 1 (TOOL NUMBER)
#104 = 2000 (SPINDLE RPM)

G21 G17 G90
T#103 M06
S#104 M03
G00 X#100 Y0.000
G01 X[#100 + #101] F#102
```

After **KAIJU Alias**, the defining assignments stay numbered so the name map
can still be found. Uses in the program body become readable:

```gcode
#100 = 0.000 (START X [mm])
#101 = 5.000 (STEP OVER [mm])
#102 = 240.000 (CUTTING FEED [mm/min])
#103 = 1 (TOOL NUMBER)
#104 = 2000 (SPINDLE RPM)

G21 G17 G90
T#tool_number M06
S#spindle_rpm M03
G00 X#start_x Y0.000
G01 X[#start_x + #step_over] F#cutting_feed
```

A second command invocation changes those uses back to `#100` through `#104`.
The same toggle works for macro references in loop calculations and other
address words, not only `X` and `F`.

## Editing behavior and diagnostics

- **Mixed forms.** KAIJU Alert can flag a document that uses both `#140` and
  its `#finish_allowance` alias outside the defining line. A second Alias
  invocation restores numeric form.
- **Undefined names.** An alias such as `#finish_allowance` without a matching
  header definition can be flagged. Both spelling and placement above the
  first G/M block affect resolution.
- **Document-wide rewrite.** Alias changes matching text throughout the
  active document, including references in comments outside the defining
  line. The diff shows the full scope of the edit.
- **Mode status.** The right-side Alias indicator reports numeric, alias,
  or mixed mode.

The **KAIJU Alias: Case Sensitive** setting is off by default. With that
default, a differently capitalized name such as `#PART_OD` can still toggle
back to its number. When the setting is enabled, alias references must match
case exactly. It changes matching during the toggle; generated
names still use lowercase.

For a longer hands-on example, open
[Macros, Sense, Macro Hunter, and Alias](../examples/06-macros-sense-hunter-and-alias.nc)
from the Codex examples. It includes both header styles, tool and spindle
references, and a loop whose macro values change on each pass.
