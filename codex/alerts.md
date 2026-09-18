# Alerts

[Back to KAIJU Codex](README.md)

KAIJU Alert marks suspicious G-code in the editor. It can report issues such as
duplicate or decreasing N labels, unresolved GOTOs, unmatched control-flow
markers, non-ASCII text, adjacent operators, undefined aliases, and definite
arc geometry errors.

Read the diagnostic, inspect the surrounding source, and correct or configure
it when it does not match your controller or shop rule. Each alert can be
controlled in KAIJU settings. An alert is a review signal, not proof that the
controller will reject or safely run the program.
