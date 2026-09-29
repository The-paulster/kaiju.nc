# KAIJU Reconstructor

**Sources:** `src/kaijuReconstructor/`

## Responsibility

Reconstructor owns deterministic document formatting. `formatter.js` contains
the formatting rules and VS Code formatting provider; `command.js` owns the
command-palette flow; `options.js` exposes formatting options.
H is included in the default decimal-address list for incremental C moves.
An H after an explicit same-block `G43`/`G44` tool-length command retains its
written offset value, including bracketed expressions. The formatter does not
track modal context across lines.

## Connections

- Decomposition reuses the formatter for its trace output.
- The Extension Host registers the provider and command.

## Boundary

Do not hide formatting rules in the command or options files. Reconstructor
rewrites presentation of source text; it does not own semantic diagnostics,
motion interpretation, macro evaluation, or language grammar highlighting.
