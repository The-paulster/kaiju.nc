# Machine Profiles and G-code Profiles

[Back to KAIJU Codex](README.md)

Profiles tell KAIJU how to interpret a program and estimate its motion and time.
A machine profile combines machine settings with a G-code profile. The G-code
profile maps controller words to the functions KAIJU understands. Your program
can use a saved machine and override its G-code selection separately.

## Which profile does what?

| Choice | What it controls | Where to change it |
| --- | --- | --- |
| Machine profile | Machine type, G-code profile, startup modes, C-axis behavior, spindle limits, rapid/tool timings, work offsets, and semicolon / % delimiter formatting defaults. | Right-click **KAIJU Machine Profile**, or click the machine/profile status indicator. |
| Machine mode | Mill, Lathe - Radius, or Lathe - Diameter; supplies the X programming convention. | Machine profile's **Machine** tab. Existing **KAIJU Machine Mode** commands remain available. |
| G-code profile | Which G/M words activate supported functions, with separate Mill and Lathe bindings. | Right-click **KAIJU G-code Profile**. |

The status indicator shows the effective machine and G-code profile names for
the active program, including a program's G-code override. These choices are
shared by Vision, Sense, Chronoblade, and Alert. Selecting a profile does not
rewrite the NC program.

## Set up a machine

1. Open the NC program and choose **KAIJU Machine Profile**.
2. Choose **New** and enter a name. **Copy settings from** can use any existing
   machine; **Duplicate** starts with the currently selected machine as its source.
3. In **Machine**, choose the machine type and G-code profile. Set any startup,
   spindle, C-axis, and formatting defaults needed for this machine.
4. In **Timing**, enter rapid rates, tool-change timings, and custom M-code times.
5. In **Offsets**, enter the machine's G54-G59 origins if needed.
6. Choose **Use for this program** to apply the machine to this NC file, or
   **Set as default** to use it for unassigned programs.

**Generic Machine** is the read-only starting profile. Copies are independent:
editing one does not change the profile it was copied from.

| Action | Result |
| --- | --- |
| **Save profiles** | Stores reusable custom machine definitions. Saving alone does not assign the selected machine to a program. Programs already using an edited profile read its updated settings. |
| **Use for this program** | Saves pending edits and assigns the machine to the program that opened the editor. It also selects that machine's G-code profile, replacing a separate G-code override. |
| **Set as default** | Saves pending edits and selects the default machine for unassigned programs. Existing program selections remain in place. |

Machine definitions live in `kaijuNC.machineProfiles.customProfiles`; the default
is `kaijuNC.machineProfiles.defaultProfile`. Program selections are saved by
source-document URI in VS Code workspace state.

## Machine type and startup modes

| Machine type | X interpretation | Feed default when startup feed is set to machine default |
| --- | --- | --- |
| **Mill** | Linear X axis. | Feed per minute. |
| **Lathe - Radius** | X is radial distance. | Feed per revolution. |
| **Lathe - Diameter** | X is diameter; physical radial travel uses half the X change. | Feed per revolution. |

An incorrect type can change geometry, CSS calculations, and timing. Startup
feed, plane, distance, and spindle settings supply the initial interpreted state;
recognized program commands override them. CSS units select m/min or ft/min.
A positive machine maximum RPM combines with a positive programmed RPM limit
using the lower value. It does not supply a missing spindle speed.

**Automatic** inspects executable code outside comments and angle brackets.
Strong turning evidence includes CSS, `G50 S`, turning cycles, U/W moves, and
four-digit tool calls. `G08` selects Lathe - Radius. Strong milling evidence
includes `G43/G49`, or combined milling cycle, tool-change, and Y-axis use.
Ambiguous programs retain the Lathe - Diameter fallback; a confident inferred
result is identified in the status tooltip.

## Defaults and program overrides

KAIJU resolves selections in this order:

1. A saved program machine takes priority over the default machine.
2. An unassigned program uses the configured default machine.
3. A separate G-code choice saved for the program takes priority over that
   machine's G-code profile.
4. Applying a machine again restores its G-code choice.

Choosing a separate G-code profile for a program that inherited its machine
from the default also saves that machine selection for the program. A later
change to the default therefore does not change that program's machine.

Until a machine is explicitly applied or a default explicitly chosen, Generic
Machine preserves older Settings and saved Machine Mode choices. In that
workflow, a saved mode beats `kaijuNC.chronoblade.machineMode`; Automatic
inference is used when no specific mode is selected. The G-code fallback is
`kaijuNC.gCodeDialect.defaultProfile` (FANUC / ISO by default), with older dialect
settings retained for compatibility. Explicitly applying Generic Machine uses
its displayed settings. Choosing an existing **KAIJU Machine Mode** command
returns that program to the older mode-selection workflow.

## G-code bindings

Open **KAIJU G-code Profile** to inspect built-in **FANUC / ISO**, **DMG MORI**,
and saved custom profiles. Built-ins are read-only. **Duplicate** copies an
existing table; **New** starts with unbound operations.

Each row names a KAIJU function. Enter the controller word that activates it,
for example `G98` for lathe feed per minute, or `G50 S` for a spindle limit that
reads an S value. Blank cells leave a function unbound. Assigning a word to a
new function clears its previous binding in the same table. Mill and Lathe
bindings are independent: FANUC / ISO uses `G94/G95` for mill feed and `G98/G99`
for lathe feed; mill `G98/G99` instead select canned-cycle return behavior.

C-axis mode rows accept M words. Both built-in lathe profiles use `M45/M46`
for engagement/disengagement. Polar interpolation has separate on/off bindings.
These are KAIJU's profile defaults; verify the bindings against your machine.

**Save profiles** stores custom tables in `kaijuNC.gCodeDialect.customProfiles`
and confirms **Profiles saved.** It is disabled when there are no changes.
**Use for this program** assigns the selected profile to the program that opened
the editor. Saving a custom table and assigning it are separate actions.

Canned cycles have independent **Milling cycles** and **Lathe cycles** tabs.
The common command is a reference; the actual binding controls interpretation.
FANUC / ISO pre-binds runtime milling entries. Reference-only lathe entries show
**Unavailable**. See [Canned cycles](canned-cycles/README.md) for support and
individual cycle behavior.

## C-axis behavior

Coordinate wrapping and travel direction are separate settings. Wrapped
coordinates reduce the retained angle after a move; continuous coordinates
retain signed multi-turn values. Absolute C travel can use the programmed
signed change, shortest equivalent route, or positive/negative equivalent route.
For example, C350 to C10 travels -340 degrees with direct travel and +20 degrees
with shortest travel. H and G91 C preserve explicit signed sweeps. Polar
interpolation uses its own coordinate interpretation.

The optional disengagement reset sets interpreted C to zero at the G-code
profile's mode-off word. It changes retained position without adding tool travel.
Rotary feed interpretation chooses how C contributes to feed length: the default
combines one linear unit per C degree with linear travel by vector length;
alternatives use a configured scale, physical swept distance, or linear-only
travel. Pure C moves have unknown time with linear-only feed interpretation.

## Timing and offsets

The active machine profile supplies all Chronoblade timing settings: base rapid
rate, axis rapid rates, tool-change time, extra-station time, and custom M-code
durations. The report shows its base timing values read-only; **Edit** opens
that machine's **Timing** tab. To compare another machine, apply its regular
machine profile. `M05` and `M5` identify the same event. There are no separate
Chronoblade timing presets or report-specific timing overrides.

Optional X/Y/Z rapid rates use physical axis units/minute; C rapid uses
degrees/minute. Blank linear rates use the base rate, while blank C leaves
rotary rapid timing unknown. Configured axis rates use the longest moving-axis
travel/rate time. Estimates do not include acceleration or an inferred dogleg
rapid path. Turret station count and indexing direction determine the indexing
route; extra-station time is charged for steps beyond an adjacent move.

The **Offsets** tab defines G54-G59 X/Y/Z/C origins relative to G53 machine zero.
Linear values use machine units and the profile's X convention; C uses degrees.
Unspecified values are zero. Vision's **Apply** saves shared program offsets
that take priority over machine defaults. **Reset to defaults** clears that
program override. Merely changing a work frame does not create travel.

## Missing bindings and profile problems

**Unbound G-code Alerts** is off by default. Enable it in **KAIJU Quick Toggles**
or `kaijuNC.alerts.unboundGCodes.enabled` to mark literal G words absent from
the active Mill/Lathe table. It skips comments and macro/expression G values.
A warning reports missing KAIJU profile coverage, not controller validity.
See [Alerts](alerts.md).

If geometry or timing is unexpected, first check the status indicator, machine
type, active Mill/Lathe bindings, startup modes, and preceding modal commands.
If a machine references a deleted G-code profile, the machine editor marks it
unavailable; choose an existing profile before saving. Analysis falls back to
FANUC / ISO until the reference is repaired.

Bindings connect supported KAIJU functions to controller words. They do not add
new controller algorithms or establish that a controller accepts a program.

## Work coordinate systems

Mill bindings and Lathe bindings include **Work coordinate system 1** through
**Work coordinate system 6**, with G54-G59 defaults. Copy a profile to change
or clear these bindings. The selector word can change; the associated offset
values still belong to their G54-G59 slots in Machine Profiles and Vision.
