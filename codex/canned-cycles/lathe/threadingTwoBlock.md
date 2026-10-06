# Threading, two-block - FANUC

[Cycle list](../README.md) | [KAIJU Codex](../../README.md)

**Common associated command:** `G76`  
**Machine mode:** Lathe  
**Entry ID:** `cycle.lathe.fanuc.threadingTwoBlock`  
**KAIJU support:** Documented only

## Controller purpose

Cuts a thread in repeated synchronized passes with finishing passes.

The entry targets the FANUC turning cycle family with conventional system-A/B words, listed in the [FANUC 0i Model D operator manual](https://cnchospital.com.tr/wp-content/uploads/2021/12/B-64304EN_03.pdf). It does not represent every FANUC G-code system or a Haas variant.

## Current KAIJU behavior

This is a documented reference entry in the **Lathe cycles** list. Its Codex
page is available, but its binding cell shows **Unavailable**. No pass expansion,
cycle-specific parameter interpretation, finishing-stock calculation, synchronized
thread motion, or cycle-time estimate is provided yet.

The common command is recorded here so its future runtime implementation can
receive the default FANUC / ISO binding. The controller format, parameter units,
and restrictions must be verified against the applicable turning manual before
that implementation becomes bindable. Ordinary source motion in a program containing
this cycle does not establish a complete cycle path or time.

## Variant ownership

A different controller behavior gets a new entry ID and behavior script. Rebinding
this entry changes its trigger word; it does not change its parameter format or
algorithm. New implementations must keep this page and their support label aligned.
