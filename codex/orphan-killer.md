# Orphan Killer

[Back to KAIJU Codex](README.md)

KAIJU Orphan Killer tears into a program's macro relationships and reports
macros that are **used but not defined** and **defined but not used**. Run it
from the Command Palette or editor context menu while a G-code document is
active.

Use the line numbers to track down a missing definition, a misspelled
reference, or an assignment that no longer contributes to the program. The
report recognizes numeric and named macro aliases. It ignores comments and
angle-bracket text, which are not executable macro references.

Orphan Killer reports findings for you to review; it does not delete or change
macros in the source. Use **Refresh** to update the report manually, or enable
**Live** to refresh it after edits to that program. Live refresh is off by
default and is remembered per program.

By default, numeric macros above `#1000` are ignored. Change
`kaijuNC.orphanKiller.ignoredMacros` in Settings to adjust the range, or clear
it to inspect every numeric macro.

## KAIJU Orphan Killer

`KAIJU Orphan Killer` hunts down and kills orphaned macro variables and unresolved macro usage inside the active NC document.

It helps expose hidden mistakes, dead setup values, and missing variables before they turn into production issues.

* Command: `KAIJU Orphan Killer`
* Shortcut: `Ctrl+Alt+O`

The inspection reports:

* Undefined macro usage
* Unused macro definitions

Example:

```gcode id="50zy1w"
#100 = 1.0
#101 = 2.0

G1 X#100 Z#150
```

KAIJU Orphan Killer would report:

```text id="d4k8cl"
Undefined macro usage:
#150

Unused macro definitions:
#101
```

Macro-like text inside comments and protected angle-bracket ranges is ignored automatically. Configured macro ranges can also be excluded from inspection with `kaijuNC.orphanKiller.ignoredMacros`.

The report's optional per-program **Live** control refreshes the open findings shortly after you edit that program. Leave it off to keep a manual snapshot and use **Refresh** when wanted.