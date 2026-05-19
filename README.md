# KAIJU.NC

KAIJU.NC is a Visual Studio Code extension for working with `.nc` files and other common CNC program formats. It provides syntax highlighting, warnings, automatic formatting, and basic diagnostic tools for Fanuc-style G-code and macro programming.

The extension is designed around practical shop-floor readability, especially for macro-heavy lathe, mill, and mill-turn programs.

## Features

### Syntax Highlighting

KAIJU.NC highlights common CNC program elements, including:

- Program numbers, such as `O1000`
- Block numbers, such as `N100`
- G-codes and M-codes
- Rapid and cutting motion codes
- Axis and address words, including `X`, `Y`, `Z`, `U`, `V`, `W`, `A`, `B`, `C`, `I`, `J`, `K`, `R`, `F`, `S`, `T`, `L`, `P`, and `Q`
- Macro variables, such as `#100`, `#500`, and named-style macro references
- Macro logic keywords, including `IF`, `THEN`, `WHILE`, `DO`, `END`, and `GOTO`
- Math and comparison operators, including `EQ`, `NE`, `GT`, `GE`, `LT`, `LE`, `SIN`, `COS`, `SQRT`, `ABS`, `ROUND`, `FIX`, and `FUP`

### Comment Highlighting

Fanuc-style parenthesis comments are highlighted:

```gcode
(ROUGHING PASS)
```

Special comment styles are also recognized:

```gcode
(- OPERATION 1)
(/ META COMMENT)
(ROUGHING [CHECK OFFSET])
```

### Macro-Aware Editing

KAIJU.NC includes lightweight macro editing helpers:

- Hover lookup for macro variables
- Macro alias support for making common variables easier to read
- Bracket expression highlighting that visually ties expressions back to their address word

Example:

```gcode
#140 = 0.20 (FINISH ALLOWANCE DIA)

G1 X[#140 + 1.] Z[#101 - 0.5] F[#130]
```

### Formatting

The extension includes a document formatter for NC programs. It can normalize spacing, clean up common code layout issues, and optionally normalize tool codes.

Available command:

```text
KAIJU Format
```

### Diagnostics

KAIJU.NC provides lightweight warnings for patterns that can make NC programs harder to read or easier to misinterpret.

One example is missing decimal point detection on motion-related numeric values:

```gcode
G1 X100 Z-20 F5
```

The extension can warn on values like the above when your shop standard expects explicit decimals:

```gcode
G1 X100. Z-20. F5.
```

### Basic Diagnostic Tools

The extension also includes basic utility commands for inspecting and cleaning macro-heavy code:

- `KAIJU Format`
- `KAIJU Alias`
- `KAIJU Orphan Killer`

## Supported File Types

KAIJU.NC registers support for common NC and G-code file extensions:

- `.nc`
- `.cnc`
- `.tap`
- `.gcode`
- `.gco`
- `.gc`
- `.ngc`
- `.ncc`
- `.eia`
- `.iso`
- `.min`
- `.mpf`
- `.spf`
- `.dnc`
- `.sub`

## Settings

### `kaijuNC.format.normalizeToolCodes`

Controls whether tool codes are normalized to four digits.

Default:

```json
true
```

Example:

```gcode
T1
T606
```

Can be formatted as:

```gcode
T0101
T0606
```

## Intended Use

KAIJU.NC is intended for:

- Fanuc-style CNC programs
- Macro-heavy G-code
- Lathe, mill, and mill-turn program editing
- Improving readability of hand-written or heavily edited NC programs

It is not intended to be a CNC simulator, backplotter, collision checker, or machine safety verifier.

## Important Safety Note

This extension provides editor assistance only. It does not simulate toolpaths, verify machine state, check collisions, validate setup safety, or guarantee that a CNC program is safe to run.

Always verify CNC programs using proper simulation, machine checks, dry runs, and your shop's approved procedures before running code on a machine.

## License

MIT
