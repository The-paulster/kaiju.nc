# KAIJU Quick Toggles

**Source:** `src/kaijuQuickToggles/index.js`

## Responsibility

Quick Toggles supplies high-frequency context-menu commands that flip existing
KAIJU settings and maintain the VS Code context keys that choose the visible
On/Off command. It currently exposes the out-of-order N-alert setting.

## Connections

- Writes a setting owned by Alert.
- Is registered by the Extension Host and represented in `package.json` menus.

## Boundary

Quick Toggles owns neither the setting's behavior nor its validation. Add a
toggle only for an already-owned, useful setting; implement changes to Alert
behavior in its owning module. Warpaint is intentionally absent here while its
authoring workflow is being reconsidered; its decoration behavior remains in
the Warpaint module and is configured through Settings.
