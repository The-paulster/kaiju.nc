// Role: register all KAIJU Sense editor features. Keep individual feature
// behavior in the sibling Sense modules.
const { registerKaijuSenseMacro } = require("./macro");
const { registerKaijuSenseTool } = require("./tool");
const { registerKaijuSenseNLabels } = require("./nLabels");
const { registerKaijuSenseHover } = require("./hover");
const { registerKaijuSenseStatusBar } = require("./statusBar");
const { registerKaijuSenseFork } = require("./fork");

function registerKaijuSense(context) {
	registerKaijuSenseMacro(context);
	registerKaijuSenseTool(context);
	registerKaijuSenseNLabels(context);
	registerKaijuSenseHover(context);
	registerKaijuSenseStatusBar(context);
	registerKaijuSenseFork(context);
}

module.exports = {
	registerKaijuSense,
	registerKaijuSenseMacro,
	registerKaijuSenseTool,
	registerKaijuSenseNLabels,
	registerKaijuSenseHover,
	registerKaijuSenseStatusBar,
	registerKaijuSenseFork
};
