# KAIJU Quick Toggles

**Source:** `src/kaijuQuickToggles/index.js`

## Responsibility

Quick Toggles supplies high-frequency context-menu commands that flip existing
KAIJU settings and maintain the VS Code context keys that choose the visible
On/Off command. It exposes the out-of-order N-alert and unbound G-code alert
settings. The latter controls `kaijuNC.alerts.unboundGCodes.enabled` and appears
as **Unbound G-code Alerts: On/Off**, defaulting to Off. Both follow the active document's setting
and preserve its existing workspace-folder, workspace, or global scope.

## Connections

- Writes a setting owned by Alert.
- Is registered by the Extension Host and represented in `package.json` menus.

## Boundary

Quick Toggles owns neither the setting's behavior nor its validation. Add a
toggle only for an already-owned, useful setting; implement changes to Alert
behavior in its owning module. Warpaint is intentionally absent here while its
authoring workflow is being reconsidered; its decoration behavior remains in
the Warpaint module and is configured through Settings.
