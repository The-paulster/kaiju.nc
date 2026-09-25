# KAIJU Machine Mode

**Sources:** `src/kaijuMachineMode/` and shared `src/MetaMachineMode.js`

## Responsibility

The Machine Mode feature owns the editor commands, user notifications, and
right-side machine/profile and Alias status indicators. `MetaMachineMode` owns
the shared per-document state, workspace persistence, Settings fallback,
conservative automatic machine inference, and change event consumed by other
features.

It also owns the **KAIJU G-code Profile** webview. The editor is a
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

Open a G-code document, then choose **KAIJU G-code Profile** in the editor
context menu. The list contains built-in and saved custom profiles. Built-in
profiles are read-only; use **Duplicate** to start a custom profile from a
built-in table, or **New** to start with unbound operations.

Each profile has independent **Mill bindings** and **Lathe bindings**. A row
names a stable KAIJU function; its binding cell accepts `G98`, or `G50 S` when
the operation requires and reads a companion `S` word. A blank cell means the
function is unbound. Assigning a G word clears the previous function bound to
that word in the same machine table. C-axis mode on/off rows instead accept
M words, with `M45`/`M46` bound in both built-in lathe profiles. Mill rows
leave these operations unbound. This prevents a source block from
acquiring two controller meanings.

**Save profiles** writes reusable custom profiles to
`kaijuNC.gCodeDialect.customProfiles`. It is disabled until a profile change is
made and, after a successful write, the editor visibly confirms **Profiles
saved.** **Use for this program** assigns the selected built-in or saved custom
profile to the active program and visibly confirms the selection. The fallback
profile remains a Settings choice.

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

The built-in FANUC / ISO profile uses G94/G95 for mill feed/min and feed/rev,
while its lathe table uses G98/G99. Those words remain independent of the mill
table's G98/G99 canned-cycle return meanings.
The `M45`/`M46` defaults are KAIJU interpretation defaults for the two built-in
lathe profiles, not a claim that all FANUC-controlled machines use those M codes.

## Automatic inference

With `kaijuNC.chronoblade.machineMode` set to its default **Automatic** value,
an unassigned program is inspected outside comments and angle-bracket text.
Strong turning evidence such as CSS (`G96`/`G97`), `G50 S...`, turning cycles,
diameter/radius programming, U/W moves, or four-digit tool calls selects a
lathe profile; `G08` selects Lathe (Radius). Strong milling evidence such as
`G43`/`G49`, combined milling-style cycle/tool-change/Y-axis use selects Mill.
Ambiguous programs retain the prior Lathe (Diameter) fallback. The status item
marks a confident inferred result with **(Auto)**. A saved program selection or
a specific setting always overrides inference.

## Boundary

Presentation and command workflow stay here. Machine geometry defaults,
document-keyed persistence, selected dialect identity, and change notification
stay in Meta. Adding another consumer must not add feature-specific UI back to
`MetaMachineMode`.
