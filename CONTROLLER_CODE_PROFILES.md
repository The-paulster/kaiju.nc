# CNC Controller Code Profiles

Practical reference for recognizing common ISO/EIA CNC programs and the main controller-specific extensions used by KAIJU.NC.

> This is a recognition guide, not a substitute for the programming manual for the exact machine, control generation, installed options, and machine-builder PLC. The same G or M code can mean different things on different machines.

## Shared ISO / Fanuc-style baseline

These are broadly recognizable across Fanuc-style controls, but details still vary.

| Code or form | Typical meaning |
|---|---|
| `O1234` | Program number |
| `N100` | Sequence/block number |
| `G00`, `G01` | Rapid and linear interpolation |
| `G02`, `G03` | Clockwise and counterclockwise circular interpolation |
| `G17`, `G18`, `G19` | XY, ZX, and YZ plane selection |
| `G20`, `G21` | Inch and metric input |
| `G40`, `G41`, `G42` | Cutter compensation cancel, left, and right |
| `G43`, `G44`, `G49` | Tool-length compensation and cancel |
| `G54`-`G59` | Standard work coordinate systems |
| `G80` | Canned-cycle cancel |
| `G81`-`G89` | Drilling, tapping, and boring cycles; exact meanings vary |
| `G90`, `G91` | Absolute and incremental distance modes |
| `G94`, `G95` | Feed per minute and feed per revolution on many controls |
| `G96`, `G97` | Constant surface speed and fixed spindle RPM on lathes |
| `M00`, `M01` | Program stop and optional stop |
| `M02`, `M30` | Program end; rewind/reset behavior varies |
| `M03`, `M04`, `M05` | Spindle clockwise, counterclockwise, and stop |
| `M06` | Tool change on many machining centers |
| `M08`, `M09` | Coolant on and off on many machines |
| `M98 P1234` | Call external subprogram `O1234` on common Fanuc-style controls |
| `M99` | Return from subprogram; may loop when used in a main program |
| `#100`, `#500` | Macro variables on Macro B-style controls |
| `IF [...] GOTO100` | Conditional branch to `N100` on Macro B-style controls |

## Fanuc

Fanuc is the most useful compatibility baseline, but behavior depends on control series, machine type, G-code system, parameters, and purchased options.

### Main identifying forms

| Code or form | Meaning / recognition note |
|---|---|
| `GOTO100` | Branch to sequence block `N100`; the target omits the letter `N` |
| `IF [expr] GOTO100` | Conditional Macro B branch |
| `WHILE [expr] DO1` ... `END1` | Macro B loop pair |
| `G65 P9000 A...` | Non-modal macro call; `P9000` calls `O9000` |
| `G66 P9000 A...` / `G67` | Modal macro call and cancellation |
| `M98 P1234 L2` | Call `O1234` twice |
| `G54.1 P1` | Extended work offset on supported controls |
| `G68` / `G69` | Coordinate rotation and cancellation on supported controls |
| `G68.2` / `G69` | Tilted working plane and cancellation on supported 5-axis controls |
| `G43.4` / `G49` | Tool-center-point control and cancellation on supported 5-axis controls |

### Fanuc lathe profile references

These commands reference blocks even though the operands use `P` and `Q`, not `N`:

```gcode
G71 P100 Q200 U0.5 W0.2 F0.25
...
N100 G00 X...
...
N200 G01 Z...
```

| Code | Typical use |
|---|---|
| `G70 P100 Q200` | Finish profile between `N100` and `N200` |
| `G71 P100 Q200` | Rough-turning profile range |
| `G72 P100 Q200` | Rough-facing profile range |
| `G73 P100 Q200` | Pattern-repeat profile range |
| `G74`, `G75` | Peck/grooving cycles; definitions vary by lathe generation |
| `G76` | Multiple-pass threading cycle; block format varies |

### Strong Fanuc-family signals

- Macro B syntax using `#`, brackets, `IF`, `GOTO`, `WHILE`, `DO`, and `END`.
- Profile ranges expressed as `P... Q...` and resolved to `N...` blocks.
- External subprogram calls expressed as `M98 P...`.

These signals are also shared by many Fanuc-compatible controls and therefore do not prove that the machine is Fanuc.

## Haas

Haas is strongly Fanuc-like, with several conspicuous Haas extensions.

### Main identifying forms

| Code or form | Meaning / recognition note |
|---|---|
| `M97 P1000` | Call local subprogram beginning at `N1000` in the same program |
| `M97 P1000 L4` | Call that local subprogram four times |
| `M98 P1234` | Call external program `O1234` |
| `G154 P1`-`G154 P99` | Select one of 99 additional work offsets |
| `G103 Pn` | Limit block look-ahead; especially important around macro side effects |
| `G187 P... E...` | Accuracy/smoothing control |
| `G254` / `G255` | Dynamic Work Offset on supported machines |
| `G234` | Tool Center Point Control on supported machines |
| `G110`-`G129` | Legacy aliases for the first twenty `G154` work offsets |
| `G112` / `G113` | Lathe XY-to-XC interpolation and cancellation |
| `G107` | Cylindrical mapping on supported Haas lathes |

### Local subprogram example

```gcode
M97 P1000 L2
M30

N1000 G01 X1. F10.
M99
```

Here `P1000` is a reference to the definition `N1000`. Haas documents `M97` specifically as a local `N`-block call.

### Strong Haas signals

- `M97 P...` resolving to a local `N...` block.
- `G154 P...`, particularly values beyond the first few extended offsets.
- `G103` look-ahead limiting and `G187` accuracy commands.
- Haas-specific high-numbered lathe cycles and settings written from G-code.

## Okuma OSP

Okuma OSP is not simply Fanuc with different formatting. It supports ISO-style motion but has distinct coordinate, variable, branch, and Lathe Auto-Programming syntax.

### Sequence names

Okuma permits numeric and alphanumeric sequence names:

```gcode
N200 G01 X50 Z-20
NLAP1 G81
```

An alphanumeric sequence name begins with a letter after `N`. Sequence names can be used by searching, branching, restart, and LAP functions. Definitions should be unique.

### LAP contour references on lathes

| Code or form | Typical meaning |
|---|---|
| `G85 N200 ...` | Call rough bar-turning LAP contour beginning at sequence `N200` |
| `G86 N200 ...` | Call copy-turning LAP contour |
| `G87 N200` | Call finish-turning LAP contour |
| `G88 N200 ...` | LAP threading-cycle call |
| `G81` | Start longitudinal finish-contour definition in LAP context |
| `G82` | Start transverse finish-contour definition in LAP context |
| `G83` | Start blank-shape definition in applicable LAP modes |
| `G80` | End LAP contour definition in this context |

Example:

```gcode
N100 G85 N200 D0.2 U0.1 W0.05 F0.25
N200 G81
      G01 X40 Z0
      Z-30
      G80
```

The first `N200`, after `G85`, is a reference. The second `N200`, at the beginning of its block, defines the target.

### Other useful OSP signals

| Code or form | Meaning / recognition note |
|---|---|
| `G15 H1` | Select work coordinate system on many OSP machining controls |
| `G56 H...` | Tool-length offset style used on many Okuma machining controls |
| `V1`, `V100` | Common/user variable family on older OSP programs |
| `VC1`, `VC100` | Common variable family seen on newer OSP programs |
| `VZOFX`, `VZOFZ`, etc. | Named system-variable style |
| `IF [expr] Nlabel` | OSP conditional branch form on applicable controls |
| `CALL O...` | OSP subprogram/procedure call style on applicable generations |

### Strong Okuma signals

- `G85`-`G88` followed by an `N...` contour reference on a lathe.
- Alphanumeric sequence names such as `NLAP1`.
- `G15 H...` work-coordinate selection.
- `V...`, `VC...`, and named `VZ...` variables.

Do not interpret every Okuma `G85` as LAP: on an Okuma machining center, `G85` can still be a boring cycle. Machine type matters.

## Mazak

Mazak controls support two substantially different programming worlds:

1. **EIA/ISO G-code**, which is broadly Fanuc-like.
2. **MAZATROL conversational programs**, organized as conversational units rather than ordinary line-by-line G-code.

They should be separate profiles or parsing modes.

### Mazak EIA/ISO signals

| Code or form | Meaning / recognition note |
|---|---|
| `G54`-`G59` | Standard work offsets |
| `G54.1 P...` | Extended work offsets on supported Smooth controls |
| `G54.2 P...` | Dynamic fixture/rotary-related offset function on supported controls |
| `G41.2` | 3D cutter compensation on supported controls |
| `G43.4` | Tool-tip/tool-center control on supported 5-axis configurations |
| `G68.2` | Tilted working-plane command on supported configurations |
| `M98 P...` / `M99` | Common EIA subprogram call and return |
| `#...`, `IF`, `GOTO` | Macro syntax where the macro option is supported |

Mazak EIA programs often look Fanuc-compatible. Machine-specific M-codes, Smooth-control options, and 5-axis behavior are where assumptions become risky.

### MAZATROL signals

- Conversational units such as common unit, material, process, shape, and tool data.
- Programs displayed or exported as structured unit records rather than ordinary `G01` blocks.
- MAZATROL unit names and fields are stronger evidence than the Mazak machine brand alone.

### Strong Mazak signals

- Explicit MAZATROL conversational structure.
- Smooth-control metadata or comments combined with Mazak-specific machine M-codes.
- EIA alone should normally be classified as `Mazak EIA` only when machine metadata or strong dialect evidence exists; otherwise `Fanuc-style` is safer.

## DMG MORI

**DMG MORI is not one CNC dialect.** It is a machine-tool builder offering several underlying controls. A useful profile must identify the native control, not merely the name on the machine enclosure.

Common DMG MORI control families include:

| Machine/control presentation | Underlying programming family |
|---|---|
| CELOS with Siemens | Siemens SINUMERIK |
| CELOS with Fanuc | Fanuc-style |
| CELOS X with Siemens | Siemens SINUMERIK |
| CELOS X with Heidenhain | Heidenhain conversational/ISO |
| MAPPS with Fanuc backend | Fanuc-style plus Mori machine functions |
| MAPPS with Mitsubishi backend | Mitsubishi/Fanuc-like EIA plus Mori machine functions |
| Older Mori Seiki MAPPS | Frequently Mitsubishi-based, but verify the exact control |

### Recognition guidance

| Signal | Likely profile |
|---|---|
| `DEF`, `R1`, `CYCLE...`, `TRAORI`, `GOTOF`, `GOTOB` | Siemens SINUMERIK |
| `BEGIN PGM`, `TOOL CALL`, `L X...`, `CYCL DEF`, `LBL` | Heidenhain |
| `#...`, `G65`, `M98 P...`, `GOTO...` | Fanuc/Mitsubishi-style backend |
| MAPPS/CELOS comments alone | Insufficient; inspect the actual NC syntax |

Machine-builder M-codes for pallet changers, tool magazines, probing, tailstocks, steady rests, subspindles, doors, and automation can be unique even when the underlying G-code is standard Fanuc or Siemens. Those codes should live in a machine model or option layer, not in a universal `DMG MORI` dialect.

## Recommended profile structure for tooling

A practical parser should separate three things:

```text
Machine builder:  DMG MORI / Mazak / Okuma / Haas / other
Native control:   Fanuc / Haas NGC / Okuma OSP / Mazatrol / Siemens / Heidenhain / Mitsubishi
Machine type:     mill / lathe / mill-turn / grinder / multi-channel
```

Then add optional machine capabilities:

- Macro language and branching rules.
- Sequence-reference rules.
- Canned-cycle meanings and formats.
- Work-offset syntax.
- Tool-offset syntax.
- Multi-channel synchronization.
- Five-axis transforms and TCP behavior.
- Machine-builder and automation M-codes.

For automatic detection, prefer strong syntax evidence and expose uncertainty. An explicit per-file selection should always override automatic inference.

## High-value sequence-reference rules

| Profile | Reference | Target definition |
|---|---|---|
| Fanuc Macro B | `GOTO200` | `N200 ...` |
| Fanuc-style lathe | `G71 P100 Q200` | `N100 ...` through `N200 ...` |
| Haas | `M97 P200` | `N200 ... M99` |
| Okuma OSP lathe | `G85 N200` | `N200 G81 ... G80` |
| Okuma OSP lathe | `G85 NLAP1` | `NLAP1 G81 ... G80` |
| Siemens | `GOTOF NAME` / `GOTOB NAME` | `NAME:` or control-supported label form |
| Heidenhain | `CALL LBL 1` | `LBL 1` ... `LBL 0` |

## Sources and further verification

- [Haas: M97 Local Subprogram Call](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM97.html)
- [Haas: G154 Work Coordinates P1-P99](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3Dg154.html)
- [Haas lathe G-code list](https://www.haascnc.com/service/service-content/guide-procedures/lathe---g-codes.html)
- [Okuma OSP-E100L Programming Manual](https://douglasrudd.com/manuals/OKUMA-OSP-E100L-ProgManual.pdf)
- [Mazak: G-code and MAZATROL conversational programming](https://www.mazak.com/us-en/news-media/useful-information/blog/G-Code-and-Conversational---MAZATROL-Does-it-All/)
- [DMG MORI control families](https://en.dmgmori.com/products/controls/mapps-iv)

