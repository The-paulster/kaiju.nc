# KAIJU Quick Toggles

**Source:** `src/kaijuQuickToggles/index.js`

## Responsibility

Quick Toggles supplies high-frequency context-menu commands that flip existing
KAIJU settings and maintain the VS Code context keys that choose the visible
On/Off command. It currently exposes Warpaint and out-of-order N-alert
settings.

## Connections

- Writes settings owned by Warpaint and Alert.
- Is registered by the Extension Host and represented in `package.json` menus.

## Boundary

Quick Toggles owns neither the setting's behavior nor its validation. Add a
toggle only for an already-owned, useful setting; implement changes to
Warpaint/Alert behavior in their respective modules.
