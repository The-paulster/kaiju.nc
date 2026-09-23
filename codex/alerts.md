# Alerts

[Back to KAIJU Codex](README.md)

KAIJU Alert marks suspicious G-code in the editor. It can report issues such as
duplicate or decreasing N labels, unresolved GOTOs, unmatched control-flow
markers, non-ASCII text, adjacent operators, undefined aliases, and definite
arc geometry errors.

Read the diagnostic, inspect the surrounding source, and correct or configure
it when it does not match your controller or shop rule. Each alert can be
controlled in KAIJU settings. An alert is a review signal, not proof that the
controller will reject or safely run the program.

## KAIJU Alert

KAIJU.NC includes live diagnostics for common NC patterns that can lead to ambiguous, misleading, or dangerous code.

The inspection system can detect:

* Missing macro-expression brackets
* Misplaced address words inside expressions
* Suspicious motion values without decimal points
* `GOTO` targets without a matching `N` label
* Duplicate `N` sequence numbers
* Out-of-order `N` sequence numbers
* Mixed KAIJU Alias mode, where aliases and their original numbered macros are both used
* Undefined KAIJU Alias names
* Nested or separate parenthesis-comment pairs

Every KAIJU Alert check can be toggled on or off individually in the KAIJU.NC settings.

Example:

```gcode id="hdtlyu"
G1 X[#PART_OD + #FINISH_ALLOWANCE
```

```gcode id="2njr1h"
G01 U4.000 [F#121 * 0.600]
```

Corrected:

```gcode id="8qd9q9"
G01 U4.000 F[#121 * 0.600]
```

Before:

```gcode id="y85r7x"
G1 X100 Z-20 F5
```

After:

```gcode id="61g7g8"
G1 X100. Z-20. F5.
```