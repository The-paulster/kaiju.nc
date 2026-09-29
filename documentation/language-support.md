# Language Support

**Sources:** `package.json`, `language-configuration.json`, and
`syntaxes/gcode.tmLanguage.json`

## Responsibility

Language support declares G-code documents to VS Code and assigns TextMate
scopes for comments, commands, addresses, macro variables, operators, and
control flow. It is editor presentation and language registration—not a G-code
execution parser.

The grammar highlights `IF`, `THEN`, `ELSE`, and `ENDIF` as control-flow
keywords. It does not decide whether a particular controller can execute them.
G-code scopes accept decimal numeric words such as `G12.1` as well as ordinary
integer codes.

## Connections

- `package.json` contributes the G-code language, grammar, commands, settings,
  keybindings, and menus.
- `language-configuration.json` provides editor language behavior.
- The grammar's scopes are styled by the extension's contributed color defaults
  and may be used by VS Code themes.
- The existing `support.code.h.gcode` scope uses a lighter C purple by default.
  A same-block `G43` or `G44` before H adds `meta.tool-length-offset.gcode`
  context so H uses bold green. This is lexical highlighting; the grammar does
  not track controller modes across lines.

## Boundary

Do not put semantic diagnostics, macro evaluation, motion parsing, or document
rewriting in the grammar. Keep grammar regexes strict: avoid highlighting
address-like text inside ordinary words or protected comment content. Changes
to a scope must preserve the intended scope names used by color customizations.
