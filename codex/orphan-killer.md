# Orphan Killer

[Back to KAIJU Codex](README.md)

KAIJU Orphan Killer reports macro variables that are referenced without an
assignment and variables that are assigned without a reference. It is a static
inspection of the active G-code document: the report shows relationships in
the written source, without executing loops or changing the program.

## Quick start

1. Open a file recognized by VS Code as G-code.
2. Run **KAIJU Orphan Killer** from the editor context menu or Command Palette.
   The shortcut is **Ctrl+Alt+O** on Windows/Linux or **Cmd+Alt+O** on macOS.
3. Inspect the **Used but not defined** and **Defined but not used** tables in
   the report beside the source program. **Refresh** rebuilds the report;
   **Live** follows later source edits when enabled.

## Definitions and references

A **definition** is a macro on the left side of an assignment, such as
`#100 = 20.`. A **reference** is another executable occurrence of a macro,
including an address value, expression, condition, or the right side of an
assignment. The left-side target is not itself counted as a reference.

| Source text | `#100` definition? | `#100` reference? |
| --- | --- | --- |
| `#100 = 20.` | Yes | No |
| `G01 X#100 F200.` | No | Yes |
| `#101 = #100 + 5.` | No | Yes |
| `#100 = #100 + 1` | Yes | Yes |

The report groups occurrences by variable. **Used but not defined** means at
least one reference exists but no assignment to that variable appears
anywhere in the document. **Defined but not used** means at least one
assignment exists but no reference appears anywhere in the document. A macro
can be assigned several times; this report does not evaluate whether each
individual assignment contributes to a later result.

Parenthesis comments and angle-bracket text are excluded from both scans.
Thus `(#150 IS AN INPUT)` and `<#150>` do not count as references or
definitions. A comment-only Alias declaration names a macro but does not
assign it a value; an actual `#number = ...` line still supplies the
definition.

## Reading a finding

The report header shows counts for **Undefined uses**, **Unused definitions**,
and **Total findings**. Each of the two tables then lists **Macro**, **Name**,
and **Lines**. The counts are numbers of distinct macros, not numbers of
source occurrences. **Lines** contains the one-based source line numbers
where the variable was referenced or assigned. Multiple occurrences on the
same line appear once in that line list.

For example:

```gcode
#100 = 20. (USED X POSITION)
#101 = 150. (USED FEED)
#190 = 9. (UNUSED SETUP VALUE)
G21 G18 G90
G01 X#100 Z#199 F#101
```

The report identifies `#199` under **Used but not defined** at line 5 and
`#190` under **Defined but not used** at line 3. `#100` and `#101` appear
in both an assignment and a reference, so neither is reported. The report
does not remove the unused definition or supply a value for `#199`.

The bundled [Diagnostics and Orphan Killer](../examples/02-diagnostics-and-orphan-killer.nc)
program contains this kind of deliberate mismatch alongside separate Alert
examples. Its comments explain the intended source edits and report refresh.

## Numeric macros and KAIJU Alias

Orphan Killer resolves a named [KAIJU Alias](alias.md) to its numbered macro
when the program header defines that association. Numeric and named uses
then contribute to the same variable's result:

```gcode
#140 = 0.20 (FINISH ALLOWANCE)
G01 X#finish_allowance F200.
```

Here the assignment to `#140` and the reference to `#finish_allowance`
belong to the same variable; neither is an orphan. A named macro with no
matching Alias definition remains a separate unresolved name and can appear
under **Used but not defined**. [Alerts](alerts.md) also reports undefined
Alias names when that check is enabled.

## Ignored macro ranges

The `kaijuNC.orphanKiller.ignoredMacros` setting is a comma-separated list of
numeric macro numbers and ranges. Its default, `1001-`, excludes `#1001` and
all higher numeric macros. Examples of accepted entries are:

| Setting text | Excluded numeric macros |
| --- | --- |
| `100,123` | `#100` and `#123` |
| `3000-4000` | `#3000` through `#4000`, inclusive |
| `1001-` | `#1001` upward |
| Empty string | None |

An ignored macro contributes to neither report table. A named Alias that
resolves to an ignored numeric macro is excluded with it. An unresolved named
macro has no numeric range to compare and is not excluded by this setting.
The default exclusion is useful when high-numbered controller or system
variables are supplied outside the program, but it can also hide a real
missing definition in that range.

## Refresh and interpretation limits

**Refresh** analyses the source document associated with the open report,
even if focus has moved elsewhere. **Live** is off by default and is saved
per program. When enabled, edits to that program refresh the open report
after a short delay. With Live off, the report remains a snapshot until a
manual refresh or another command invocation.

This is a whole-document relationship check, not execution-order or data-flow
analysis. For example, `G01 X#300` followed later by `#300 = 10` has both a
reference and a definition, so it produces no orphan finding even though
the first use precedes the assignment. Likewise, `#300 = #300 + 1` counts
as both a definition and a reference; this report does not establish the
macro's initial value. [Macro Hunter](macro-hunter.md) and
[Decomposition](decomposition.md) provide execution-based inspection for
those questions.

A reported undefined macro can be an intentional machine input, and an
unused definition can be a deliberate setup value. The report identifies
relationships for review; it does not determine controller behavior or
machine safety.
