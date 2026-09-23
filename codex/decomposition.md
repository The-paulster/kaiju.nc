# Decomposition

[Back to KAIJU Codex](README.md)

Decomposition produces a readable execution-oriented G-code view. Run **KAIJU
Decomposition** when macros, branches, loops, or jumps make the authored source
hard to follow.

It can request values for unresolved macro inputs, then shows formatted output
with compact notes for assignments, comparisons, and flow decisions.

Use it to understand one prepared execution path. It does not modify the source
program and does not turn uncertain controller behaviour into a guaranteed
machine simulation.

## KAIJU Decomposition

`KAIJU Decomposition` tears apart macro-heavy NC programs and generates a temporary flattened inspection copy for analysis.

Built to dissect dense production code, it tracks macro assignments, resolves expressions, and strips away resolved macro logic to expose the underlying motion path more clearly.

* Command: `KAIJU Decomposition`
* Shortcut: `Ctrl+Alt+D`

The generated output is automatically formatted with KAIJU Reconstructor and includes `KAIJU flow` comments where jumps, conditionals, and loops affected the decomposed path.

When required values cannot be resolved automatically, KAIJU prompts for manual numeric input and records those assumptions in the generated file.

Decomposed output can also be inspected directly with `KAIJU Vision`, making it easier to visualize complex macro-generated toolpaths.