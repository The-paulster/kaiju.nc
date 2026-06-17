// Role: extension activation wiring only. Register feature modules here, but keep
// feature behavior inside the owning KAIJU module files.
const { registerFormatter } = require("./kaijuReconstructor/formatter");
const { registerFormatCommand } = require("./kaijuReconstructor/command");
const { registerKaijuSense } = require("./kaijuSense");
const { registerKaijuAlias } = require("./kaijuAlias");
const { registerOrphanKiller } = require("./kaijuOrphanKiller");
const { registerDiagnostics } = require("./kaijuAlert/diagnostics");
const { registerChronobladeWebview } = require("./kaijuChronoblade/webview");
const { registerKaijuVisionWebview } = require("./kaijuVision/webview");
const { registerKaijuDecomposition } = require("./kaijuDecomposition");
const { registerMachineModeCommands } = require("./MetaMachineMode");
const { registerKaijuRangefinder } = require("./kaijuRangefinder");

function activate(context) {
	registerFormatter(context);
	registerFormatCommand(context);
	registerKaijuSense(context);
	registerKaijuAlias(context);
	registerOrphanKiller(context);
	registerDiagnostics(context);
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
