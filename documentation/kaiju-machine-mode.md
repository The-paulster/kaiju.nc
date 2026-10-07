# KAIJU Machine Mode

**Sources:** `src/kaijuMachineMode/` and shared `src/MetaMachineMode.js`

## Responsibility

The Machine Mode feature owns the editor commands, user notifications, and
right-side machine/profile and Alias status indicators. `MetaMachineMode` owns
the shared per-document state, workspace persistence, Settings fallback,
conservative automatic machine inference, and change event consumed by other
features.

The machine indicator visibly shows `KAIJU: <machine profile> · <G-code profile>`
for the active program. It uses the effective G-code selection, including a
program override. The tooltip retains machine type and automatic-inference
details; clicking the indicator opens Machine Profiles.

It also owns the **KAIJU G-code Profile** webview. The editor is a
controller-profile keybinding table, not a second motion interpreter.

## Machine profiles

**KAIJU Machine Profile** opens a separate webview beside **KAIJU G-code
Profile** in the G-code editor context menu. Each reusable machine profile
contains its machine type, selected G-code profile, G0 rapid rate (program
units/minute), tool-change and extra-station seconds, and C-axis coordinate
and disengagement-reset behavior. Automatic machine type uses the existing
shared conservative detection.

The **Machine** tab contains machine type, G-code profile, C-axis behavior,
and **Requires semicolons**. That checkbox supplies Reconstructor's default
for adding semicolons after code and before comments; the format command can
still explicitly override it. The **Timing** tab contains rapid/tool timings
and an add/remove list of custom M-code durations in seconds.
Beside Requires semicolons, **Requires % delimiters** adds standalone `%` lines
at the start and end when Reconstructor or Format Document runs. It defaults
off for Generic Machine and existing custom profiles. New and Duplicate copy
the setting from their source profile; saving and program selection use the
shared `requiresPercentDelimiters` Boolean field.
The tool timing fields include brief explanations: tool change is the base
time, and extra-station seconds are added for each indexing step beyond an
adjacent move (a three-step move adds two extra-station charges).
Leading-zero spellings such as M05 and M5 identify the same event; duplicate entries are
rejected. Profiles created before these fields existed load with semicolons
off and an empty custom-timing list. The page does not show the source path.

**Generic Machine** is the immutable starting profile. **New** asks for a name
and offers **Copy settings from** any existing profile; **Duplicate** preselects
the current profile as the source. Copies are independent. **Save profiles**
writes custom profiles to `kaijuNC.machineProfiles.customProfiles`.
**Use for this program** saves the machine identity by source-document URI
alongside existing per-program state and applies its G-code profile.
**Set as default** saves `kaijuNC.machineProfiles.defaultProfile` for unassigned
programs. Both actions save pending profile edits first and visibly confirm
success. Changing the default does not replace saved program selections.

Until a machine profile is explicitly applied or a default explicitly chosen,
Generic Machine preserves legacy Settings and saved machine-mode selections.
Applying Generic Machine explicitly uses its displayed settings. Existing
Machine Mode commands remain available; selecting one returns that program to
legacy mode selection. The separate G-code editor can override a program's
G-code choice without changing the reusable machine definition. An override
also retains a machine inherited from the default as the program's saved
machine selection, so changing that default later does not detach it; applying a
machine again restores its G-code choice.

If a referenced G-code profile is removed, the editor retains the machine and
marks that controller as unavailable. Select an existing controller before
saving. Shared dialect lookup retains its existing FANUC / ISO fallback until
the reference is repaired.

The C-coordinate choices are **Wrap angle to 0–360°** and **Continuous angle
(can exceed 360°)**. Continuous angles retain signed multi-turn positions.
Absolute travel separately selects the programmed signed angle (the default),
shortest equivalent route, or positive/negative equivalent route. A shortest
route from C350 to C10 travels +20 degrees; direct travel is -340 degrees.
Equivalent-route choices also apply to multi-turn absolute targets; use H or
G91 C to retain an explicit signed multi-turn sweep. A 180-degree shortest-route
tie chooses positive travel. Polar interpolation bypasses these angular rules.
Numeric travel limits are not currently defined. The optional reset uses the
G-code profile's mode-off binding and resets C to zero. Motion interpretation
stays in `MetaMotionEngine`. Machine profiles supply all Chronoblade rapid/tool timings and custom M-code
durations. The report shows read-only values and an Edit shortcut to the
Timing tab; separate report timing presets and overrides are not used. Rotary G0 timing remains
unknown unless a C-axis rapid rate is configured.

The **Timing** tab also supplies optional X/Y/Z rapid rates (physical axis
units/minute) and a C rapid rate (degrees/minute). Blank linear rates use the
base G0 rate; blank C rates leave rotary rapid time unknown. With configured
linear axis rates or a rotary rapid, elapsed time is the longest moving-axis
travel/rate time. Zero is an unknown rate for a moving axis. With no axis rates,
ordinary linear G0 keeps the legacy distance/base-rate calculation. These are
constant-speed timing estimates; rendering stays on the shared straight/swept
path and does not infer a controller's dogleg rapid trajectory or acceleration.

**Turret station count** and **Turret indexing** select shortest, increasing,
or decreasing station-number routes, including wrap-around. Station count zero
retains the existing absolute station-number-gap model. The circular model
applies when both stations are within 1 through the configured count; otherwise
the previous gap estimate is retained.

**Rotary feed interpretation** defaults to one linear unit per C degree,
combined by vector length with physical X/Y/Z travel. Alternatives are a
configured units-per-degree scale, physical swept distance, or linear-axis
distance only. Linear-only pure C motion has unknown time. Physical G1 rotary
length/time integrates the swept path independently of drawing sample count;
rotary G2/G3 timing remains unknown.

The **Machine** tab includes CSS units (m/min or ft/min), a maximum spindle
RPM (zero means unspecified), and startup feed/plane/distance/spindle modes.
The machine RPM cap combines with a positive programmed spindle limit using
the lower value, for both fixed RPM and CSS timing. It does not invent a G50
command or supply an unspecified spindle speed. Startup feed defaults to the
machine type; other compatibility defaults are XY, Absolute, and Fixed RPM.
Program commands override startup modes through the shared dialect bindings.

## Connections

The **Offsets** tab defines G54-G59 X/Y/Z/C frame origins relative to G53
machine zero. Linear values use machine units and the profile's X programming
convention; C values use degrees. Missing values default to zero. Copies keep
independent offsets. Shared motion consumers use these defaults, with saved
per-program offsets taking precedence. Vision's Apply saves that shared
override; Reset to defaults removes it and returns to the selected machine.
Existing saved Vision offsets remain readable and migrate on the next save.
Changing work frames alone changes coordinates without creating a motion.

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

## Work coordinate bindings

General Mill bindings and Lathe bindings include Work coordinate system 1 through
Work coordinate system 6, pre-bound to G54 through G59 in both built-in profiles
and inherited by existing custom profiles. Copy a built-in profile to edit them.
Explicit null unbinds a selector; assigning its word elsewhere follows the existing
collision rule. Rebinding changes the selector word, while offsets remain stored
under the corresponding G54-G59 work-frame slots. Vision, Chronoblade and Sense
consume the same profile-resolved selection. Frame selection alone creates no motion.

## Canned cycle bindings

Canned cycles have their own section with independent Milling cycles and Lathe cycles tabs, separate from general Mill bindings and Lathe bindings. A Canned cycles Codex link sits directly beneath the cycle tabs; individual entries also have Codex links. The cycle list shows common G commands and implementation status, alongside cycle-cancel and return-plane bindings. FANUC / ISO pre-binds runtime milling entries; copying it preserves these defaults. Existing custom tables inherit new mill slots unless explicitly unbound or claimed by an existing word assignment. Reference-only lathe entries show Unavailable. Actual profile bindings determine interpretation; the common command is informational. See [shared cycle ownership](canned-cycles.md).

## Automatic inference

With `kaijuNC.chronoblade.machineMode` set to its default **Automatic** value,
an unassigned program is inspected outside comments and angle-bracket text.
Strong turning evidence such as CSS (`G96`/`G97`), `G50 S...`, turning cycles,
diameter/radius programming, U/W moves, or four-digit tool calls selects a
lathe profile; `G08` selects Lathe (Radius). Strong milling evidence such as
`G43`/`G49`, combined milling-style cycle/tool-change/Y-axis use selects Mill.
Ambiguous programs retain the prior Lathe (Diameter) fallback. The status item
marks a confident inferred result with **(Auto)** in its tooltip. A saved program selection or
a specific setting always overrides inference.

## Boundary

Presentation and command workflow stay here. Machine geometry defaults,
document-keyed persistence, selected dialect identity, and change notification
stay in Meta. Adding another consumer must not add feature-specific UI back to
`MetaMachineMode`.


When enabled through `kaijuNC.fileSettings.showInContextMenu` (default off), **KAIJU File Settings** appears immediately below Machine Profile and G-code Profile in the same editor context-menu group. Its separate feature presents a read-only snapshot of the program configuration and remains available from the Command Palette; see [File Settings](kaiju-file-settings.md).
