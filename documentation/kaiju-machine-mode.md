# KAIJU Machine Mode

**Sources:** `src/kaijuMachineMode/` and shared `src/MetaMachineMode.js`

## Responsibility

The Machine Mode feature owns the editor commands, user notifications, and
right-side machine/profile and Alias status indicators. `MetaMachineMode` owns
the shared per-document state, workspace persistence, Settings fallback, and
change event consumed by other features.

It also owns the **KAIJU Manage G-code Profiles** webview. The editor is a
controller-profile keybinding table, not a second motion interpreter.

## Connections

- Reads and writes shared state only through `MetaMachineMode`.
- Lists available controller profiles from `MetaGCodeDialect`.
- Reads Alias feature state solely to present the adjacent Alias indicator.
- Chronoblade, Vision, Sense, and Alert independently read
  `getMachineModeForDocument(document)`; they do not scrape the status bar.
- Uses `MetaGCodeDialect` to validate and register custom profiles before any
  feature can select or interpret them.

## Custom G-code profiles

Open a G-code document, then choose **KAIJU G-code Profile > KAIJU Manage
G-code Profiles** in the editor context menu. Built-in profiles are read-only;
use **Duplicate** to start a custom profile from a built-in table, or **New**
to start with unbound operations.

Each profile has independent **Mill bindings** and **Lathe bindings**. A row
names a stable KAIJU function; its binding cell accepts `G98`, or `G50 S` when
the operation requires and reads a companion `S` word. A blank cell means the
function is unbound. Assigning a G word clears the previous function bound to
that word in the same machine table. This prevents a source block from
acquiring two controller meanings.

**Save profiles** writes reusable custom profiles to
`kaijuNC.gCodeDialect.customProfiles`. **Save and use for this program** also
selects the chosen profile for the active document. **Save as fallback** sets
`kaijuNC.gCodeDialect.defaultProfile`, the Settings default for documents
without an assigned profile. It ships as `fanucIso` (FANUC / ISO), and can name
either built-in profile or a custom profile ID.

The saved shape is intentionally declarative:

```json
{
  "id": "my-controller",
  "label": "My Controller",
  "description": "Optional notes",
  "bindings": {
    "mill": { "feed.perMinute": { "code": 94 } },
    "lathe": {
      "feed.perMinute": { "code": 98 },
      "spindle.rpmLimit": {
        "code": 50,
        "requiredWords": ["S"],
        "argumentWord": "S"
      }
    }
  }
}
```

The editor writes the complete normalized table, including `null` for unbound
operations. Users should normally use the editor rather than edit this JSON
directly.

## Boundary

Presentation and command workflow stay here. Machine geometry defaults,
document-keyed persistence, selected dialect identity, and change notification
stay in Meta. Adding another consumer must not add feature-specific UI back to
`MetaMachineMode`.
