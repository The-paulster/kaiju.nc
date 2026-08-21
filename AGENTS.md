# KAIJU.NC Agent Guide

KAIJU.NC is a VS Code G-code extension made from deliberately separate feature
modules. A feature owns one user-facing capability. It may consume an existing
shared capability, but it must not reimplement that capability inside its own
folder. This keeps behavior consistent between tools and prevents one feature's
fix from silently diverging from another's.

## Start here

Read [the module map](documentation/README.md) before changing code. Then read
the document for every module you will edit and any module whose public helper
you will call. `MODULE_DEPENDENCIES.md` is the generated/maintained local
CommonJS dependency chart; the documents in `documentation/` explain the
intended ownership and boundaries behind that chart.

## Architecture rules

1. Keep feature behavior in its owning `src/kaiju*/` module. `src/extension.js`
   only activates and registers modules.
2. Use the `Meta` module when a capability is shared. In particular, use
   `MetaMotionEngine` for G-code motion/modal interpretation,
   `MetaMacroEngine` for macro parsing/evaluation, `MetaToolModel` for tool
   ranges and colors, and `MetaTextRanges` for protected comments and angle
   brackets.
3. A consumer renders or presents shared results; it does not recreate the
   parser or calculation. For example, Sense, Vision, and Chronoblade must use
   `MetaMotionEngine` rather than each interpreting motion independently.
4. A module's `options.js` reads that module's configuration only. Keep UI,
   parsing, storage, and rendering in their designated owners.
5. Prefer a narrow change in the existing owner. Create a new shared `Meta`
   capability only when two or more independent features truly need the same
   non-UI behavior.
6. Documentation is part of the change. Update it in the same change whenever
   code changes a module's responsibility, dependency direction, public helper
   or consumer contract, setting, command, or user-facing behavior.
   Add a concise `CHANGELOG.md` entry for user-visible changes; internal-only
   changes do not need one.
7. For an architectural change, update the affected page in
   `documentation/` and update `documentation/README.md` when
   the module list, ownership map, or routing guidance changes. Update
   `MODULE_DEPENDENCIES.md` too when the local CommonJS dependency graph
   changes.

## Boundaries that matter most

- Motion math and modal state belong to `MetaMotionEngine`; Sense presents it,
  Vision inspects it, and Chronoblade reports time from it.
- Macro aliases and expression evaluation belong to `MetaMacroEngine`; Alias,
  Sense, Decomposition, Orphan Killer, tool modeling, and motion analysis are
  consumers.
- Tool identity, spans, and palette belong to `MetaToolModel`; decorations and
  reports consume its output.
- G-code text must be masked through `MetaTextRanges` before a feature scans
  protected comments or angle-bracket text.
- Machine-profile defaults and the right-side configuration status belong to
  `MetaMachineMode`; cursor modal status belongs to Sense.

The documentation is an architectural guide, not permission to make broad
refactors. Preserve existing UX and make the smallest change that keeps the
contract true.
