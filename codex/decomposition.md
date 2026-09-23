# Decomposition

[Back to KAIJU Codex](README.md)

KAIJU Decomposition opens a readable execution trace of the active G-code
document. It exposes repeated loop lines, branch-dependent motion, and values
hidden inside macro expressions.
The source program is left alone; the trace opens beside it as a temporary
inspection document.

Decomposition can also expand a compact macro program's supported loops and
expressions into flat G-code. After separate verification for the intended
machine, that output can serve as a program that does not require the
controller to execute those macros.

The trace shows one resolved path through the program. It helps explain what
KAIJU calculated, but it is not verified machine-ready code or a controller
simulation.

## Quick start

1. Open a file recognized by VS Code as G-code.
2. Run **KAIJU Decomposition** from the editor context menu or Command Palette.
   The shortcut is **Ctrl+Alt+D** on Windows/Linux or **Cmd+Alt+D** on macOS.
3. If a needed macro has no known initial value, enter a
   number when prompted. Cancel the prompt to stop creating the trace.
4. Read the temporary document beside the source. Check its **Comment
   defaults**, **Manual inputs**, and **Warnings** at the top before relying on
   the path shown below them.

The command reads the active document as a whole. It does not change the source
or run a machine program.

## Trace output

Decomposition follows executed occurrences rather than printing each source
line only once. It expands loop passes, selects the branch taken, resolves
macro expressions in output words, and formats the result using KAIJU
Reconstructor. Its short comments explain relevant steps:

- `/assignment` shows the value assigned to a macro.
- `/comparison` shows the macro values, numeric test, and result of a loop or
  condition when that comparison is emitted.
- `/flow` marks jumps, loop returns, and program end.

For example, this single source motion line executes three times:

```gcode
(#100 = PASS COUNTER {0})
#101 = 3
G21 G90 G94
WHILE [#100 LT #101] DO1
    #100 = #100 + 1
    G01 X[#100 * 5.] F200.
END1
M30
```

The trace includes the three resolved moves, with assignment and flow notes
between them. With the default formatting, the relevant output is:

```gcode
( Comment defaults: )
( #100 = 0 )

(/assignment L2: #101 = 3)
G21 G90 G94
(/comparison L4: #100=0, #101=3; 0 LT 3; TRUE; DO1)
(/assignment L5: #100 = 1)
G01 X5.000 F200.000
(/flow L7: END1; return to L4)
(/comparison L4: #100=1, #101=3; 1 LT 3; TRUE; DO1)
(/assignment L5: #100 = 2)
G01 X10.000 F200.000
(/flow L7: END1; return to L4)
(/comparison L4: #100=2, #101=3; 2 LT 3; TRUE; DO1)
(/assignment L5: #100 = 3)
G01 X15.000 F200.000
(/flow L7: END1; return to L4)
(/comparison L4: #100=3, #101=3; 3 LT 3; FALSE; DO1)
M30
(/flow L8: Program end, stopped execution)
```

The `L` numbers in notes refer to lines in the original program. The trace
can contain several moves from one source line because each loop occurrence
gets its own place in execution order.

## Flattened output from macro source

Decomposition can be part of the writing workflow, not just a way to inspect
an existing program:

1. Write and edit the compact macro-driven source.
2. Set its initial values, including any `{number}` header defaults, and run
   Decomposition. Resolve any input prompts and read the warnings.
3. Check the expanded G-code against the source and inspect its motion. The
   three-pass example above becomes three explicit `G01 X...` moves instead
   of a `WHILE` loop and macro expression.
4. Copy the verified output into a separate NC program for your controller.
   The generated document is temporary; the original macro source remains
   available for later changes.

The executable motion blocks can be flat even though KAIJU's explanatory
comments still mention macros such as `#100`. Controller compatibility of
those notes, program setup, tool changes, feeds, and the end sequence requires
separate verification. A different initial value can produce a different flat
program.

## Header initial values with `{}`

A numeric value in curly braces at the **end of a macro's header comment**
provides an initial value for Decomposition and the shared Trace. The comment
must precede the first executable G or M block:

```gcode
(#109 = TOOL LIFE COUNTER [parts] {0})
G21
IF [#109 GE 100] GOTO900
G01 X10. F100.
N900 M30
```

Here `#109` starts at `0` for inspection, so Decomposition can evaluate the
condition without asking for that value. The generated document lists it under
**Comment defaults**. The `[parts]` text is an annotation; it does not become
part of the Alias name. The `{0}` is the initial numeric value, not an
assignment line or a G-code expression to send to the controller.

An assignment takes precedence when execution reaches it. For example, if
`#109 = 1` is on the same line as a comment ending in `{0}`, the trace starts
with a comment default of `0`, then immediately assigns `1`; subsequent code
uses `1`. The comment-only form provides a starting value for a macro that
has not yet been assigned in the program.

The value must be a plain finite decimal number such as `{0}`, `{-2}`, or
`{12.5}`. The braces must end the comment, which must be in the initial header.
`{UNKNOWN}` or a comment placed after the first executable G/M block does not
provide an initial value. If the macro is needed and has no other known value,
the interactive Decomposition command prompts for a number instead. Values
entered at prompts appear under **Manual inputs** in the generated document.

Curly braces are useful for an input, counter, or starting condition that is
normally known before the program runs. Its relationship to the actual setup
matters: a different starting value can select another branch or change the
number of loop passes.

## Trace limits and verification

Decomposition can follow loops, `IF` branches, and `GOTO` paths that KAIJU can
resolve. If a path cannot be resolved or exceeds an inspection limit, the
**Warnings** section identifies why the visible output may be incomplete.
The Decomposition settings include the comparison tolerance, maximum execution
steps, and maximum output lines. These limits keep a repeating or unexpectedly
large path from producing an unbounded trace.

The generated document is an inspection trace first. Its use as a separate
program requires comparison with the original source and the machine's
control rules. [Vision](vision.md) can also inspect the decomposed output's
resolved motion.

For a guided loop example, open
[Vision and Chronoblade](../examples/04-vision-and-chronoblade.nc). For a
macro-heavy program with changing values, open
[Macros, Sense, Macro Hunter, and Alias](../examples/06-macros-sense-hunter-and-alias.nc).
