# Regression and example integration tests

`npm test` runs the fast Node regression suite. `npm run test:examples` runs
only the example-program checks. These use the shared Meta interpretation and
feature APIs with a mocked VS Code API; they do not contain another G-code parser.

`test/example-contracts.js` holds reviewed expectations used by both Node and
real Extension Host tests. An inventory check fails if an example is added or
removed without updating those expectations. Expected diagnostics specify the
authored line, exact highlighted token, severity, and message meaning. Extra
diagnostics fail too. Expectations are maintained by review, not regenerated
from today's output or screenshots.

| Example | Required default Alert results | Additional checks |
| --- | --- | --- |
| 01 Reconstructor | Missing decimal on the loop's `z-10` | T9/T606 normalization, documented formatting, alert cleared after formatting |
| 02 Diagnostics | Missing GOTO999 destination, stray END2, duplicate N100, out-of-order N90, impossible R5 arc | Undefined #199 and unused #190; applying all documented fixes clears both reports |
| 03 Syntax gallery | No default alerts with Mill/FANUC | Protected text, execution/finite geometry, expected unused calculation variables; mixed snippets are not controller-validity claims |
| 04 Rounded plate | No default alerts with Mill/FANUC | Three depths, four R5 corners per pass, R8 central circle, tools, cutting distance, one-second dwell |
| 05 C-axis/polar | No default alerts with Lathe Diameter/FANUC | Physical R20 quarter turns, two-turn sweep, linear polar rectangle, retained C90 orientation; unknown rotary timing remains explicit |
| 06 Macros | No default alerts with Mill/FANUC | Twelve X/Z positions and macro values at passes 1, 6, and 12 |
| 07 Showcase | No default alerts with Mill/FANUC | Seven facing lanes, R6/R9/R12 circles, four corner positions and three tools |

All examples also exercise generated Vision and Chronoblade scripts. Node checks
execute Vision's complete emitted Canvas renderer against a small DOM/Canvas
test double, including Dual View and forward/backward playback seeks. These are
behavior checks, not just searches for source strings.

## Real VS Code integration

Run `npm run test:integration`. The launcher uses `@vscode/test-electron` to
download current stable VS Code and launch an isolated Extension Development
Host. It copies the examples into a temporary workspace under `.vscode-test/`
and uses separate user-data and extension directories. Checked-in examples and
the developer's settings are not changed. On Linux, use
`xvfb-run -a npm run test:integration` when no display is available.

The host verifies real extension activation, `.nc` language recognition, command
registration, published Problems diagnostics, and the same reviewed analysis
contracts. It opens and closes Vision, Chronoblade, and Orphan Killer for every
example and checks that inspection leaves the source unchanged.

Playwright attaches to this isolated VS Code's local Chromium debugging port
before report creation. The real webview's motion points, endpoints, tools, and
source/execution links must match the reviewed analysis. Vision checks also
require a real WebGL2 context, painted
pixels, no GL error, a populated motion table, Dual View, and forward/reverse
playback using the actual controls. Software WebGL keeps these checks usable on
CI machines. Screenshots are saved in the printed test workspace's `screenshots/`
directory for visual review; they are not automatically accepted golden images.

`KAIJU_VSCODE_VERSION` selects a particular VS Code version instead of stable.
`KAIJU_VSCODE_EXECUTABLE` selects an existing VS Code executable and avoids the
download. The default stable download must satisfy `engines.vscode` in the
extension manifest. Host artifacts remain under ignored `.vscode-test/`.

GitHub Actions runs the fast suite and real integration suite on Windows and
Linux and retains example screenshots as workflow artifacts for seven days.
Integration testing needs VS Code download access unless an executable
is supplied; Playwright reuses VS Code's Chromium and downloads no browser.

## Verification boundaries

These checks establish the listed expectations and UI interactions. Painted
pixels do not prove every label's layout, every possible program, performance
parity, or controller execution. Chronoblade and Orphan Killer receive real
command/lifecycle checks; their complete browser interactions are not covered.
Machine settings are explicit for each case, and optional Alert checks retain
their defaults. Example 05 uses G94, which is not a FANUC lathe feed-mode binding
(G98 is), so no numeric rotary timing baseline is asserted.
