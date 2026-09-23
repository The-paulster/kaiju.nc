# Alias

[Back to KAIJU Codex](README.md)

Alias toggles between numeric macro references and readable alias comments in
the active document. Run **KAIJU Alias** from the editor context menu or
Command Palette.

Use aliases to make macro-heavy programs easier to review. Keep in mind that
Alias changes source text, so review the resulting diff and keep names aligned
with your control and shop conventions. The case-sensitivity preference is in
KAIJU Alias settings.

## KAIJU Alias

`KAIJU Alias` makes macro-heavy programs easier to read by temporarily converting numbered macro variables into readable aliases.

* Command: `KAIJU Alias`
* Shortcut: `Ctrl+Alt+A`

The command scans setup comments before the first executable `G` or `M` code.

Standalone alias notes:

```gcode
(#140 = FINISH ALLOWANCE DIA)
(#141 = ROUGHING FEED)
```

Inline assignment comments:

```gcode
#140 = 0.20 (FINISH ALLOWANCE DIA)
#141 = 0.30 (ROUGHING FEED)
```

When activated, KAIJU Alias toggles numeric macros into readable names:

Before
```gcode
G1 X[10.00 + #140] F#141

```
After
```gcode
G1 X[10.00 + #FINISH_ALLOWANCE_DIA] F#ROUGHING_FEED
```

Run the command again to restore the original numeric macros.

Alias names are generated automatically by converting comment text into lowercase underscore-separated names.