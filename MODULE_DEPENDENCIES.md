# KAIJU.NC Module Dependencies

This chart shows local CommonJS `require("./...")` dependencies in `src/`.
External modules such as `vscode` and Node built-ins such as `path` are omitted.

```mermaid
flowchart TD
	extension[extension.js]

	extension --> formatter[formatter.js]
	extension --> formatCommand[formatCommand.js]
	extension --> macroHover[macroHover.js]
	extension --> macroAlias[macroAlias.js]
	extension --> orphanKiller[orphanKiller.js]
	extension --> diagnostics[diagnostics.js]
	extension --> toolDecorations[toolDecorations.js]
	extension --> kaijuSenseHover[kaijuSenseHover.js]
	extension --> chronobladeWebview[chronobladeWebview.js]
	extension --> kaijuVisionWebview[kaijuVisionWebview.js]
	extension --> decomposition[decomposition.js]

	formatCommand --> formatter
	macroHover --> textRanges[textRanges.js]
	macroHover --> macroExpressions[macroExpressions.js]
	macroAlias --> textRanges
	orphanKiller --> textRanges
	orphanKiller --> macroAlias
	diagnostics --> textRanges
	toolDecorations --> toolModel[toolModel.js]

	kaijuSenseHover --> textRanges
	kaijuSenseHover --> motionEngine[motionEngine.js]
	chronobladeWebview --> motionEngine
	kaijuVisionWebview --> motionEngine

	decomposition --> textRanges
	decomposition --> macroExpressions
	decomposition --> formatter

	macroExpressions --> macroAlias
	motionEngine --> textRanges
	motionEngine --> macroExpressions
	motionEngine --> toolModel
	toolModel --> macroAlias
```

## Layered View

```mermaid
flowchart LR
	entry[Extension entrypoint] --> features[Feature commands and UI]
	features --> engines[Analysis and formatting engines]
	engines --> utilities[Shared utilities]

	entryModules["extension.js"]
	featureModules["formatCommand.js<br/>macroHover.js<br/>macroAlias.js<br/>orphanKiller.js<br/>diagnostics.js<br/>toolDecorations.js<br/>kaijuSenseHover.js<br/>chronobladeWebview.js<br/>kaijuVisionWebview.js<br/>decomposition.js"]
	engineModules["formatter.js<br/>motionEngine.js<br/>macroExpressions.js<br/>toolModel.js"]
	utilityModules["textRanges.js"]

	entry --> entryModules
	features --> featureModules
	engines --> engineModules
	utilities --> utilityModules
```

## Notes

- `extension.js` wires all VS Code registrations together.
- `motionEngine.js` is the shared motion-analysis core for Sense, Vision, and Chronoblade.
- `formatter.js` is shared by Reconstructor and Decomposition output formatting.
- `macroExpressions.js` centralizes macro alias/value resolution for expression-aware features.
- `toolModel.js` owns the tool color palette and tool ranges; `toolDecorations.js` renders gutter markers from it and Vision reuses it for optional tool-colored paths.
- `textRanges.js` is the low-level comment/angle-bracket range helper used across diagnostics, aliasing, hovers, formatting-adjacent logic, and decomposition.
