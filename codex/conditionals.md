# Conditionals and branches

[Back to KAIJU Codex](README.md)

KAIJU Trace understands structured macro branches and follows the path selected
by their current macro values. Vision, Chronoblade, and Decomposition reuse
that same Trace path, so a non-taken branch is not drawn, timed, or emitted in
the decomposed program.

## Structured branches

A structured block starts with a body-less `IF [...] THEN` and ends with
`ENDIF`. `ELSE` is optional.

```gcode
IF [#100 EQ 1] THEN
    #101=10
    G00 X500.
ELSE
    #101=20
    G00 X400.
ENDIF
```

When `#100` is `1`, KAIJU follows the first body. Otherwise it follows the
`ELSE` body. The `IF`, `ELSE`, and `ENDIF` lines organise the branch; the
selected executable lines supply the resulting macro values and motion.

## Inline branches

An action can follow `THEN`, with an optional alternative after `ELSE`:

```gcode
IF [#100 EQ 1] THEN #101=500
ELSE #101=400

IF [#100 EQ 1] THEN G00 X500. ELSE G00 X400.
```

For an inline branch, Trace retains the authored source line for reference but
passes only the selected action to motion analysis. The second example therefore
contributes either the move to `X500.` or the move to `X400.`, never both.

## More than two choices

An additional condition uses a nested block. KAIJU intentionally recognises
the explicit nested form, not an unverified `ELSEIF` keyword.

```gcode
IF [#100 EQ 1] THEN
    G00 X500.
ELSE
    IF [#100 EQ 2] THEN
        G00 X400.
    ELSE
        G00 X300.
    ENDIF
ENDIF
```

Nested blocks are matched correctly: an inner `ENDIF` closes only its inner
`IF`.

## What KAIJU checks

With the **Unmatched flow markers** alert enabled, KAIJU reports a missing
`ENDIF`, an `ELSE` or `ENDIF` without an earlier matching `IF`, and a second
`ELSE` in the same block.

KAIJU can inspect this syntax in any program; it does not claim that every
controller supports it. The target control's manual remains authoritative for
accepted macro syntax, options, and limits.
