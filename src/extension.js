const { registerFormatter } = require("./formatter");
const { registerFormatCommand } = require("./formatCommand");
const { registerMacroHover } = require("./macroHover");
const { registerMacroAlias } = require("./macroAlias");
const { registerOrphanKiller } = require("./orphanKiller");
const { registerDiagnostics } = require("./diagnostics");
const { registerToolDecorations } = require("./toolDecorations");
const { registerKaijuSenseHover } = require("./kaijuSenseHover");
const { registerChronobladeWebview } = require("./chronobladeWebview");
const { registerKaijuVisionWebview } = require("./kaijuVisionWebview");

function activate(context) {
	registerFormatter(context);
	registerFormatCommand(context);
	registerMacroHover(context);
	registerMacroAlias(context);
	registerOrphanKiller(context);
	registerDiagnostics(context);
	registerToolDecorations(context);
	registerKaijuSenseHover(context);
	registerChronobladeWebview(context);
	registerKaijuVisionWebview(context);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
