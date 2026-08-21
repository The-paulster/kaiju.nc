// Role: own KAIJU Trace presentation. Shared trace execution belongs in Meta.
const { registerKaijuTraceStatusBar } = require("./statusBar");

function registerKaijuTrace(context) {
	registerKaijuTraceStatusBar(context);
}

module.exports = {
	registerKaijuTrace
};
