# Syntax and editor colours

[Back to KAIJU Codex](README.md)

KAIJU assigns syntax scopes to G-code words, macro expressions, control flow,
and comments. The scopes make authored blocks easier to scan; their colours
come from the extension's defaults and can be changed by a VS Code theme or
user colour customizations. Highlighting identifies text patterns. It does
not evaluate a program, establish controller support, or indicate that a
toolpath is valid. [Alerts](alerts.md) handles editor diagnostics.

## Program words and control flow

| Token family | Examples | Default colour |
| --- | --- | --- |
| Program and block numbers | `O9003`, `N100` | Gold `#FFD866` for `O`; grey `#C4C4C4` for `N` |
| Rapid motion | `G0`, `G00` | Orange `#FF8800` |
| Cutting motion | `G1`, `G2`, `G3` and zero-padded forms | Yellow `#FFD500` |
| Other G-codes | `G17`, `G90`, `G12.1` | Green `#29C718` |
| M-codes | `M03`, `M30` | Light blue `#9CDCFE` |
| Macro variables | `#100`, `#part_name` | White `#FFFFFF` |
| Control flow | `IF`, `THEN`, `ELSE`, `ENDIF`, `WHILE`, `DO1`, `END1`, `GOTO600` | Pink `#EB17E4` |
| Math words and functions | `EQ`, `LT`, `AND`, `MOD`, `SIN`, `SQRT`, `ABS` | Pink `#EB17E4` |
| Math symbols | `+`, `-`, `*`, `/`, `=` | Grey `#ABB2BF` |

The rapid and cutting scopes cover only the written `G0` through `G3`
words. A following axis-only block may inherit a motion mode during execution,
but the grammar does not calculate modal state to recolour that block. Decimal
codes such as `G12.1` remain G-code tokens; their meaning depends on the
selected [Machine Mode and G-code Profile](machine-mode.md).

Both numeric and named macro spellings are highlighted. A coloured
`#part_name` does not establish that [Alias](alias.md) defines it, and a
coloured `GOTO600` does not establish that `N600` exists. Those are separate
semantic checks.

## Address colours

The address families have separate defaults so position, arc, feed, and tool
words remain distinguishable in a dense block. These colours apply to the
written token; the controller profile determines its actual meaning.

| Address | Default colour | Address | Default colour |
| --- | --- | --- | --- |
| `X` | `#D65D5D` | `U` | `#FF8A8A` |
| `Y` | `#6A9955` | `V` | `#9CDC7C` |
| `Z` | `#4A90E2` | `W` | `#8CC8FF` |
| `A` | `#8E6BB8` | `B` | `#A878D6` |
| `C` | `#C678DD` | `I` | `#B94F5A` |
| `J` | `#5F8F4E` | `K` | `#4B82C2` |
| `R` | `#D19A66` | `F` | `#FFD84D` |
| `S` | `#FF0037` | `T` | bold `#88FF00` |
| `H` | bold `#A6E66A` | `L` | `#B5CEA8` |
| `P` | `#D7BA7D` | `Q` | `#CE9178` |

Signed and decimal values are recognised for the axis, arc, feed, radius,
and spindle families. Examples include `X+10.`, `Y-.5`, `I-5.`, and
`F200.`. Many addresses also accept a macro reference or a bracketed
expression, such as `X#100`, `Z[-#101]`, `F[#102 * 2]`, and
`Q[#101 + [#100 MOD 3]]`. The address retains its own scope around the
expression while math words and nested brackets receive their own
highlighting. A `Q[...]` expression is supported by the same bracket
highlighting model as the other address expressions.

## Comment scopes

| Written form | Treatment | Default colour |
| --- | --- | --- |
| `(ROUGHING PASS)` | Ordinary parenthesis comment | `#67825E` |
| `(- SECTION)` | Title comment | bold `#F2AD0C` |
| `(/ META)` | Meta comment | `#95B8BF` |
| `(= VALUE)` | Equals comment | `#C4F20C` |
| `<MAIN TITLE>` | Angle-bracket title | bold `#D0FF00` |
| `[SUBCOMMENT]` inside an ordinary comment | Nested bracket text | `#94709C` |
| `{VALUE}` inside an ordinary comment | Nested brace text | `#81AEC4` |

Comment and angle-bracket title ranges take precedence over ordinary G-code
word highlighting. Thus `G01 X10.` inside `(EXAMPLE: G01 X10.)` is presented
as comment text rather than executable motion. Square brackets and braces
inside an ordinary parenthesis comment have comment scopes; square brackets
in executable code instead delimit macro expressions. These visual styles
do not change what a controller accepts.

## Syntax versus validation

The grammar recognises token shapes, including `G12.1`, `Q[#101]`, and
compact control-flow forms such as `GOTO600`. It does not check whether an
expression resolves, an arc reaches its endpoint, a branch has a valid
destination, or a particular machine supports a code. [Alerts](alerts.md)
reports supported static checks, while [Sense](sense.md) and
[Decomposition](decomposition.md) expose resolved program context.

The [Syntax gallery](../examples/03-syntax-gallery.nc) collects the token
families on one page. Its snippets mix mill, lathe, and macro notation as
an editor reference; they do not form one machine program.
