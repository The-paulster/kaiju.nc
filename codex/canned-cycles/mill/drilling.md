# Drilling - FANUC

[Cycle list](../README.md) | [KAIJU Codex](../../README.md)

**Common associated command:** `G81`  
**Machine mode:** Mill  
**Entry ID:** `cycle.mill.fanuc.drilling`  
**KAIJU support:** Basic G17/G90 drilling

## Controller purpose

Feeds to depth, then retracts rapidly.

The FANUC machining-center cycle family is described in the [FANUC 30i/31i/32i Model B machining-center operator manual](https://servicetex.ru/wp-content/uploads/lib/cnc/FANUC/30i%2031i%2032i%20-MB/%D0%A0%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE%20%D0%BF%D0%BE%20%D1%8D%D0%BA%D1%81%D0%BF%D0%BB%D1%83%D0%B0%D1%82%D0%B0%D1%86%D0%B8%D0%B8%20%D0%BD%D0%B0%20%D0%BC%D0%BD%D0%BE%D0%B3%D0%BE%D1%86%D0%B5%D0%BB%D0%B5%D0%B2%D1%8B%D1%85%20%D1%81%D1%82%D0%B0%D0%BD%D0%BA%D0%B0%D1%85.pdf), drilling canned-cycle chapter. This entry identifies the basic family; controller options and parameter-dependent variants need separate implementations.

## Binding and current behavior

This entry appears under **Milling cycles** in G-code Profiles. FANUC / ISO
pre-binds its common command. Copy a profile to change the word or clear it.
The mill binding is independent of the lathe table. Its **Codex** button opens this page.

The implemented format is basic G17/G90 drilling along Z, with known X/Y/Z,
R, depth below R, and a resolvable feed. X/Y place the hole; R is the approach
plane; Z is the bottom. G98 returns to the initial plane (or R if higher);
G99 returns to R. Z/R and the initial plane remain available at subsequent sites.
These command meanings follow the [FANUC 0i Model D operator manual](https://cnchospital.com.tr/wp-content/uploads/2021/12/B-64304EN_03.pdf).

1. Raise to R before lateral travel if currently below R.
2. Rapid to the hole's X/Y position.
3. Rapid to R.
4. Feed to Z.
5. Rapid to the selected return plane.

Moves use MetaMotionEngine's existing rapid/feed, spindle, work-offset, and
geometry calculations. Vision and Chronoblade receive the same generated sequence.
Each move retains its source line and Trace occurrence. Cycle events do not create
new macro/control-flow executions or rewrite the source program.

```gcode
G17 G90 G94
G0 X0 Y0 Z10
G99 G81 X10 Y0 Z-10 R2 F100
X20
G98 X30
G80
```

The first two holes return to Z2; the third returns to Z10. Each hole feeds
12 program units at F100, giving 7.2 seconds of cutting in this example.
Rapid time is added using the machine's configured rapid rates.

G80 or an explicit rapid/linear/arc command cancels the cycle. Rebinding the
cancel/return operations follows the same selected profile as cycle activation.
G91, G18/G19, repetitions via K/L, parallel/rotary axes, unresolved inputs, and
work-frame changes during an active cycle are outside this first expansion.
They produce a marker with an explanation and unknown cycle time.

## Variant ownership

A different controller behavior gets a new entry ID and behavior script. Rebinding
this entry changes its trigger word; it does not change its parameter format or
algorithm. New implementations must keep this page and their support label aligned.
