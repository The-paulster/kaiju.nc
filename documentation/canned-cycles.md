# Meta Canned Cycles

**Sources:** `src/MetaCannedCycles/`; user reference pages in `codex/canned-cycles/`.

## Responsibility

The shared cycle module owns the cycle catalog, variant identity, conventional
G commands, support metadata, cycle parameter retention, initial/return planes,
and behavior-generated canonical moves. It has no VS Code dependencies.
MetaMotionEngine remains the common motion/modal integration point and calculates
geometry and time for generated moves. Cycle scripts must not duplicate motion math,
word parsing, macro evaluation, protected-text masking, or control-flow execution.

## Contract

- `getCannedCycles(mode)` lists mill/lathe catalog entries, including documented-only entries.
- `getCannedCycle(id)` retrieves a stable variant ID.
- `getCycleOperationDefinitions()` exposes entries with runtime handlers as dialect operations.
- `getDefaultCycleBindings(mode)` supplies conventional words for runtime entries only.
- Runtime entries implement `createState(entry, match, words, state)` and `updateState(cycle, words, state)`.
- Optional `expand(cycle, words, state)` returns `{ steps, warnings }`. Each step contains a
  canonical `motionCode` and authored-coordinate `end` axis values. No dialect trigger
  is inferred from these generated moves. Warnings prevent expansion and make cycle time unknown.
- Input words are already parsed/resolved by MetaMotionEngine and MetaMacroEngine.
  Trace supplies occurrence order and macro state through the existing report APIs.
- Registry catalog entries do not import MetaGCodeDialect. The dialect imports registry
  metadata/defaults; the motion engine imports behavior, preventing dependency cycles.

The first full expansion is basic mill drilling (G81 convention), G17/G90 along Z,
without repetitions or parallel/rotary axes. Other mill scripts retain the previous
schematic depth-marker behavior, with explicit unknown-time rows in Chronoblade.
Lathe G70-G76 references are documented and unavailable to bind until implemented.

## Bindings and documentation

MetaGCodeDialect resolves controller words to stable cycle IDs. FANUC / ISO
pre-binds the runtime milling entries. DMG MORI keeps the former basic mill-cycle
recognition via the same entries. Existing custom profiles missing new cycle slots
inherit those mill defaults; explicit null remains unbound. Existing word assignments
are applied after defaults, so they retain ownership under the collision rule.
Validation rejects a mill cycle assigned in a lathe table. Profile replacement uses
binding-table identity to invalidate parsed-word resolution caches.

Machine Mode presents a separate cycle section with independent milling/lathe tabs,
a Canned cycles Codex link beneath those tabs, and per-entry Codex links. Entries
show their common word and support level. It renders documented entries as unavailable.
kaijuCodex opens packaged Markdown using allowlisted catalog IDs; it does not execute
cycle scripts or arbitrary file paths supplied by webview messages.

Each new variant gets a distinct stable ID, script, common command, mode, support
label, and Codex page. A controller variant must not silently change an existing
variant's parameter contract. New bindings, behavior, and reference pages ship together.
