// Role: own KAIJU Chronoblade configuration reads. Keep report rendering and
// webview behavior in webview.js.
const vscode = require("vscode");
const {
	getMachineModeForDocument
} = require("../MetaMachineMode");

function getChronobladeOptions(document, rawOptions = {}) {
	const reportConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const machineMode = getMachineModeForDocument(document);
	const profile = machineMode.profile;
	const machine = machineMode.machineProfile;

	return {
		analysisMode: rawOptions.analysisMode === "asWritten" ? "asWritten" : "trace",
		showTraceLine: rawOptions.showTraceLine === true,
		live: rawOptions.live === true,
		groupLabels: rawOptions.groupLabels === true,
		machineMode: profile.id,
		gCodeDialectId: machineMode.gCodeDialectId,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: machineMode.xAxisMode,
		cAxisCoordinates: machineMode.machineSettings && machineMode.machineSettings.cAxisCoordinates,
		cAxisResetOnDisable: machineMode.machineSettings && machineMode.machineSettings.cAxisResetOnDisable,
		cssSurfaceSpeedUnit: reportConfig.get("cssSurfaceSpeedUnit", "mPerMin"),
		samples: clampNumber(reportConfig.get("samples", 96), 12, 500),
		compactPanelWidth: clampNumber(reportConfig.get("compactPanelWidth", 0.45), 0.2, 0.7),
		machineProfileLabel: machine.label,
		rapidRate: machine.rapidRate,
		toolChangeSeconds: machine.toolChangeSeconds,
		extraStationSeconds: machine.extraStationSeconds,
		customEventTimes: machine.customTimes,
		...machineMode.motionOptions,
		significantFiguresOnly: reportConfig.get("significantFiguresOnly", false) === true,
		hideZeroTimeLabels: reportConfig.get("hideZeroTimeLabels", true) !== false,
		humanFormat: {
			minimumDecimalPlaces: clampNumber(displayConfig.get("minimumDecimalPlaces", 3), 0, 9),
			maximumDecimalPlaces: clampNumber(displayConfig.get("maximumDecimalPlaces", 3), 0, 9)
		}
	};
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	getChronobladeOptions
};
