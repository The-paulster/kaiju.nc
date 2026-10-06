# Canned cycle Codex

[Back to KAIJU Codex](../README.md)

Each entry identifies a behavior, its common G command, and its current KAIJU support.
The common command is a reference; the selected profile owns the actual binding.
FANUC / ISO pre-binds the runtime milling entries. Lathe entries are documented references
and remain unavailable to bind until their behavior is implemented.

**Depth marker only** means a schematic depth line, without individual passes or cycle time.
Chronoblade counts these operations as unknown time. **Basic G17/G90 drilling** expands
rapid positioning, feed to depth, and retract through shared motion calculations.

## Milling cycles

| Common command | Entry | KAIJU support |
| --- | --- | --- |
| G81 | [Drilling - FANUC](mill/drilling.md) | Basic G17/G90 drilling |
| G82 | [Counterboring / dwell drilling - FANUC](mill/spotDrilling.md) | Depth marker only |
| G83 | [Peck drilling - FANUC](mill/peckDrilling.md) | Depth marker only |
| G73 | [High-speed peck drilling - FANUC](mill/highSpeedPeck.md) | Depth marker only |
| G74 | [Left-hand tapping - FANUC](mill/leftTapping.md) | Depth marker only |
| G84 | [Tapping - FANUC](mill/tapping.md) | Depth marker only |
| G76 | [Fine boring - FANUC](mill/fineBoring.md) | Depth marker only |
| G85 | [Boring, feed out - FANUC](mill/feedBoring.md) | Depth marker only |
| G86 | [Boring, spindle stop - FANUC](mill/stopBoring.md) | Depth marker only |
| G87 | [Back boring - FANUC](mill/backBoring.md) | Depth marker only |
| G88 | [Boring, manual return - FANUC](mill/manualBoring.md) | Depth marker only |
| G89 | [Boring, dwell and feed out - FANUC](mill/dwellBoring.md) | Depth marker only |

## Lathe cycles

| Common command | Entry | KAIJU support |
| --- | --- | --- |
| G70 | [Finishing - FANUC](lathe/finishing.md) | Documented only |
| G71 | [OD/ID roughing, two-block - FANUC](lathe/roughingTwoBlock.md) | Documented only |
| G72 | [Facing roughing, two-block - FANUC](lathe/facingTwoBlock.md) | Documented only |
| G73 | [Pattern roughing, two-block - FANUC](lathe/patternTwoBlock.md) | Documented only |
| G74 | [Face peck drilling / grooving, two-block - FANUC](lathe/faceGroovingTwoBlock.md) | Documented only |
| G75 | [OD/ID peck grooving, two-block - FANUC](lathe/groovingTwoBlock.md) | Documented only |
| G76 | [Threading, two-block - FANUC](lathe/threadingTwoBlock.md) | Documented only |

