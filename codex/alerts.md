# Alerts

[Back to KAIJU Codex](README.md)

KAIJU Alert marks suspicious G-code directly in the editor. The examples below
show code that triggers each check and a version that avoids that check. The
arc examples assume **Mill** mode and the **FANUC / ISO** profile.

Alerts are review signals. Some conventions depend on the controller or shop,
so individual checks can be adjusted in KAIJU settings. A clear example is not
a guarantee that the program is safe to run.

## Quick start

Open [Diagnostics and Orphan Killer](../examples/02-diagnostics-and-orphan-killer.nc)
as a G-code document. Its deliberately flawed blocks show Alert diagnostics
in the editor; hovering a marked range shows the finding. Each case below
compares a flagged block with a version that avoids that specific check.

## Macro expressions and aliases

### Unclosed macro-expression bracket

> **Bad — flagged**
>
> ```gcode
> #100 = 1.
> #101 = 2.
> G01 X[#100 + #101 F200.
> ```
>
> **Good — bracket closed**
>
> ```gcode
> #100 = 1.
> #101 = 2.
> G01 X[#100 + #101] F200.
> ```

### Address word inside an expression

The `F` address belongs before the brackets, not inside the calculation.

> **Bad — flagged**
>
> ```gcode
> #121 = 200.
> G01 U4.000 [F#121 * 0.600]
> ```
>
> **Good — address outside the expression**
>
> ```gcode
> #121 = 200.
> G01 U4.000 F[#121 * 0.600]
> ```

### Mixed KAIJU Alias mode

Once `#140` is associated with `#finish_allowance`, consistent use of one form
in the program body avoids mixed Alias mode.

> **Bad — numeric and named forms mixed**
>
> ```gcode
> #140 = 0.20 (FINISH ALLOWANCE)
> G01 X#140 F200.
> G01 X#finish_allowance
> ```
>
> **Good — numeric form throughout**
>
> ```gcode
> #140 = 0.20 (FINISH ALLOWANCE)
> G01 X#140 F200.
> G01 X#140
> ```

### Undefined KAIJU Alias name

A named alias requires a definition before the first executable G or M block.
The numeric macro remains available without an alias definition.

> **Bad — no matching definition**
>
> ```gcode
> G01 X#finish_allowance F200.
> ```
>
> **Good — alias defined in the header**
>
> ```gcode
> #140 = 0.20 (FINISH ALLOWANCE)
> G01 X#finish_allowance F200.
> ```

## Labels and control flow

### GOTO without a matching N label

> **Bad — target N200 is missing**
>
> ```gcode
> GOTO200
> N100 G01 X10. F200.
> ```
>
> **Good — target exists**
>
> ```gcode
> GOTO200
> N200 G01 X10. F200.
> ```

### Duplicate N sequence number

> **Bad — N100 appears twice**
>
> ```gcode
> N100 G00 X0.
> N100 G01 X10. F200.
> ```
>
> **Good — distinct labels**
>
> ```gcode
> N100 G00 X0.
> N110 G01 X10. F200.
> ```

### Out-of-order N sequence number

> **Bad — N100 follows N200**
>
> ```gcode
> N200 G00 X0.
> N100 G01 X10. F200.
> ```
>
> **Good — numbers increase**
>
> ```gcode
> N100 G00 X0.
> N200 G01 X10. F200.
> ```

### Unmatched control-flow marker

`WHILE DO1` needs `END1`. Alert also checks unmatched structured
`IF` / `ELSE` / `ENDIF` markers.

> **Bad — loop has no END1**
>
> ```gcode
> #100 = 0
> WHILE [#100 LT 2] DO1
>     #100 = #100 + 1
> ```
>
> **Good — loop is closed**
>
> ```gcode
> #100 = 0
> WHILE [#100 LT 2] DO1
>     #100 = #100 + 1
> END1
> ```

> **Bad — structured IF has no ENDIF**
>
> ```gcode
> #100 = 1
> IF [#100 EQ 1] THEN
>     G01 X10. F200.
> ```
>
> **Good — structured IF is closed**
>
> ```gcode
> #100 = 1
> IF [#100 EQ 1] THEN
>     G01 X10. F200.
> ENDIF
> ```

## Program text and formatting

### Nested or separate parenthesis comments

Alert expects one parenthesis-comment pair per line. Square brackets support
a subcomment inside that pair.

> **Bad — two comment pairs on one line**
>
> ```gcode
> G01 X10. (ROUGH) (PASS)
> ```
>
> **Good — one comment pair**
>
> ```gcode
> G01 X10. (ROUGH PASS)
> ```

> **Bad — nested parentheses**
>
> ```gcode
> G01 X10. (ROUGH (FIRST PASS))
> ```
>
> **Good — square-bracket subcomment**
>
> ```gcode
> G01 X10. (ROUGH [FIRST PASS])
> ```

### Non-ASCII text

The first comment uses an en dash, which some controls may not read.

> **Bad — non-ASCII dash**
>
> ```gcode
> G01 X1. (ROUGHING – PASS)
> ```
>
> **Good — ASCII hyphen**
>
> ```gcode
> G01 X1. (ROUGHING - PASS)
> ```

### Adjacent math operators

> **Bad — `+-` together**
>
> ```gcode
> #100 = 2 + -1
> ```
>
> **Good — single operator**
>
> ```gcode
> #100 = 2 + 1
> ```

### Suspicious motion values without decimal points

Whether a decimal point is required depends on the controller and shop style.

> **Bad — flagged by the decimal-point check**
>
> ```gcode
> G01 X100 Z-20 F5
> ```
>
> **Good — explicit decimal points**
>
> ```gcode
> G01 X100. Z-20. F5.
> ```

## Arc geometry

Arc checks use the active machine mode and G-code profile. These examples use
Mill mode in the `G17` X-Y plane.

### R radius too small for the endpoints

The endpoints are 20 mm apart. `R5.` permits only a 10 mm diameter; `R15.`
permits a 30 mm diameter.

> **Bad — impossible R arc**
>
> ```gcode
> G21 G17 G90
> G00 X0. Y0.
> G02 X20. Y0. R5. F200.
> ```
>
> **Good — radius can reach the endpoint**
>
> ```gcode
> G21 G17 G90
> G00 X0. Y0.
> G02 X20. Y0. R15. F200.
> ```

### Centre offsets do not meet the endpoint

The bad arc starts 5 mm from its specified centre but ends more than 11 mm
from that centre. With `I5. J0.`, both distances are 5 mm.

> **Bad — start and end radii differ**
>
> ```gcode
> G21 G17 G90
> G00 X0. Y0.
> G02 X10. Y0. I0. J5. F200.
> ```
>
> **Good — equal start and end radii**
>
> ```gcode
> G21 G17 G90
> G00 X0. Y0.
> G02 X10. Y0. I5. J0. F200.
> ```
