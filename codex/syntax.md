# Syntax and editor colours

[Back to KAIJU Codex](README.md)

KAIJU colours G-code to make a program easier to scan. These colours identify
the kind of text KAIJU recognizes; they are not a controller-compatibility
check. Use [Alerts](alerts.md) for editor diagnostics.

## G-code words

- Rapid `G0` and cutting `G1`, `G2`, and `G3` stand apart from other G-codes.
- M-codes, macro variables such as `#100` or `#part_name`, and maths or logic
  operators each have their own colour.
- Axis words have distinct colours: X/U, Y/V, Z/W, A, B, and C. Arc components
  I, J, and K, along with R, F, L, P, Q, S, T, and H, are coloured separately
  so a block is easier to read at a glance.
- Program and N block numbers have their own presentation too.

## Comments

Ordinary parenthesis comments are coloured as comments. KAIJU also recognizes
these visual comment styles:

```gcode
(A normal comment)
(- A title comment)
(= An equals comment)
(/ A meta comment)
(A comment with [a nested note] or {a brace note})
<A main title comment>
```

The style is for readability; it does not change what a controller accepts.
Comments and angle-bracket text are deliberately kept out of normal G-code
word highlighting so they do not look like executable instructions.

## If a colour is unexpected

First check whether the text is inside a comment, an angle-bracket title, or a
macro expression. Then confirm the word is written as the intended address,
such as `G12.1`, `Q[#101]`, or `X10.0`. A colour change alone does not mean a
program is correct or incorrect.
