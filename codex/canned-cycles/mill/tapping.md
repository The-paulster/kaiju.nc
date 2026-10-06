# Tapping - FANUC

[Cycle list](../README.md) | [KAIJU Codex](../../README.md)

**Common associated command:** `G84`  
**Machine mode:** Mill  
**Entry ID:** `cycle.mill.fanuc.tapping`  
**KAIJU support:** Depth marker only

## Controller purpose

Cuts a right-hand thread, reverses spindle, feeds out.

The FANUC machining-center cycle family is described in the [FANUC 30i/31i/32i Model B machining-center operator manual](https://servicetex.ru/wp-content/uploads/lib/cnc/FANUC/30i%2031i%2032i%20-MB/%D0%A0%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE%20%D0%BF%D0%BE%20%D1%8D%D0%BA%D1%81%D0%BF%D0%BB%D1%83%D0%B0%D1%82%D0%B0%D1%86%D0%B8%D0%B8%20%D0%BD%D0%B0%20%D0%BC%D0%BD%D0%BE%D0%B3%D0%BE%D1%86%D0%B5%D0%BB%D0%B5%D0%B2%D1%8B%D1%85%20%D1%81%D1%82%D0%B0%D0%BD%D0%BA%D0%B0%D1%85.pdf), drilling canned-cycle chapter. This entry identifies the basic family; controller options and parameter-dependent variants need separate implementations.

## Binding and current behavior

This entry appears under **Milling cycles** in G-code Profiles. FANUC / ISO
pre-binds its common command. Copy a profile to change the word or clear it.
The mill binding is independent of the lathe table. Its **Codex** button opens this page.

The current behavior script retains authored Z depth, R retract plane, Q and P,
and the initial plane. Vision shows a schematic R-to-Z depth marker at each
recognized hole site. It does not generate the controller sequence described above.
Chronoblade emits an unknown-time row instead of estimating the cycle as an ordinary move.

Peck/re-entry clearances, dwell duration, spindle reversal/orientation, tool shift,
and manual return are not simulated by this entry. The marker must not be read
as a complete cutting path. Expanded motion requires a future behavior implementation.

## Variant ownership

A different controller behavior gets a new entry ID and behavior script. Rebinding
this entry changes its trigger word; it does not change its parameter format or
algorithm. New implementations must keep this page and their support label aligned.
