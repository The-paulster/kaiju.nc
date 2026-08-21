# KAIJU Reconstructor

**Sources:** `src/kaijuReconstructor/`

## Responsibility

Reconstructor owns deterministic document formatting. `formatter.js` contains
the formatting rules and VS Code formatting provider; `command.js` owns the
command-palette flow; `options.js` exposes formatting options.

## Connections

- Decomposition reuses the formatter for its trace output.
- The Extension Host registers the provider and command.

## Boundary

Do not hide formatting rules in the command or options files. Reconstructor
rewrites presentation of source text; it does not own semantic diagnostics,
motion interpretation, macro evaluation, or language grammar highlighting.
