# KAIJU File Settings

**Sources:** `src/kaijuFileSettings/`

## Responsibility

Presents an exhaustive, read-only snapshot for one G-code document. Open
**KAIJU File Settings** from the Command Palette. Enable **KAIJU.NC: File
Settings > Show In Context Menu** (`kaijuNC.fileSettings.showInContextMenu`)
to show it immediately below Machine Profile and G-code Profile in the editor
context menu. This window-scoped setting defaults to off and can be changed
in User or Workspace Settings; it does not disable the command.

The panel begins with a brief explanation of the resolved settings, their
sources, the read-only behavior, Refresh and Copy JSON. It shows the source
URI, document version and capture time, with a
searchable Group / Setting / Effective value / Source table. Refresh reads the
same source document even after changing editors. Copy JSON copies the complete
displayed snapshot, including rows hidden by search. Each document has its own
panel; opening it again reveals the existing panel. Search persists on refresh.

Includes the resolved machine definition, startup and timing options, work
offsets, complete selected G-code bindings, saved program selections, feature
options, saved Vision macro inputs, Alias state, Warpaint sections, and every
contributed `kaijuNC.*` configuration key including defaults. Configuration rows
expose all defined VS Code layers, including language overrides. These rows
describe VS Code configuration; the machine and feature rows show normalized
options actually resolved by their owners, which can supersede configuration.

This is a manual snapshot of saved settings and resolved defaults. It does not
show transient camera/playback state, cursor modal state, or execute a trace.
Per-feature source labels identify the owner resolver when a value may combine
configuration, machine settings and defaults; they do not infer precedence from
matching values. Nested objects are expanded into setting paths and arrays
retain their complete JSON values. Unset values remain visible as inherited.

## Connections and boundary

Uses `MetaMachineMode` for resolved and saved shared machine state; consumes
read-only snapshot helpers from Chronoblade, Vision, Orphan Killer and Warpaint.
Uses the existing Alias state helper and feature option readers for Alias,
Sense, Alert, Reconstructor and Decomposition. Enumerates contributed settings
from the manifest and inspects VS Code configuration with the source document
as scope, retaining resource and language override context.

File Settings owns presentation, search and copying only. It never reads another
feature's workspace-storage keys directly, changes settings, edits NC source,
or recreates profile resolution, macro interpretation or motion analysis.
