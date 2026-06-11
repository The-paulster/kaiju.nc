const { registerFormatter } = require("./formatter");
const { registerFormatCommand } = require("./formatCommand");
const { registerMacroHover } = require("./macroHover");
const { registerMacroAlias } = require("./macroAlias");
const { registerOrphanKiller } = require("./orphanKiller");
const { registerDiagnostics } = require("./diagnostics");
const { registerToolDecorations } = require("./toolDecorations");
const { registerLabelReferenceDecorations } = require("./labelReferenceDecorations");
const { registerKaijuSenseHover } = require("./kaijuSenseHover");
const { registerChronobladeWebview } = require("./chronobladeWebview");
const { registerKaijuVisionWebview } = require("./kaijuVisionWebview");
const { registerKaijuDecomposition } = require("./decomposition");
const { registerMachineModeCommands } = require("./machineMode");
const { registerKaijuRangefinder } = require("./rangefinder");

function activate(context) {
	registerFormatter(context);
	registerFormatCommand(context);
	registerMacroHover(context);
	registerMacroAlias(context);
	registerOrphanKiller(context);
	registerDiagnostics(context);
	registerToolDecorations(context);
	registerLabelReferenceDecorations(context);
	registerKaijuSenseHover(context);
	registerChronobladeWebview(context);
	registerKaijuVisionWebview(context);
	registerKaijuDecomposition(context);
	registerMachineModeCommands(context);
	registerKaijuRangefinder(context);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
