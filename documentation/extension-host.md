# Extension Host

**Source:** `src/extension.js`

## Responsibility

The extension host is the composition root. On activation it registers each
feature module and the machine-mode commands. It owns no feature behavior,
parsing, report UI, or configuration policy.

## Connections

- **Registers:** Reconstructor, Sense, Alias, Orphan Killer, Alert,
  Chronoblade, Vision, Decomposition, MetaMachineMode, Rangefinder, Warpaint,
  and Quick Toggles.
- **Does not depend on:** feature implementation details beyond their exported
  registration functions.

## Boundary

Add a registration here only after the feature module is independently
responsible for its behavior. Do not solve a feature issue by placing logic in
`extension.js`.
