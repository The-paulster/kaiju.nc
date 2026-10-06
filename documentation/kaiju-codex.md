# KAIJU Codex

**Sources:** `src/kaijuCodex/index.js`, packaged Markdown in `codex/`.

Codex opens allowlisted user-reference topics in VS Code Markdown preview. It
owns documentation navigation, not cycle interpretation or binding persistence.
The Machine Profiles and G-code Profiles page explains machine settings,
controller binding tables, defaults and program overrides, shared work offsets,
and machine-owned Chronoblade timings.
Its canned-cycle topics come from the shared MetaCannedCycles catalog. The
cycle index is linked from the Codex home page; each entry is also reachable
from the Machine Mode G-code binding editor. Topic IDs resolve to packaged
paths, without accepting arbitrary webview paths or commands.
