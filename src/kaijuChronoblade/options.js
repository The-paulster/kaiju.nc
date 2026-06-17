// Role: own KAIJU Chronoblade configuration reads. Keep report rendering and
// webview behavior in webview.js.
const vscode = require("vscode");
const {
	getConfiguredValue,
	getMachineModeProfile
} = require("../MetaMachineMode");

function getChronobladeOptions(document, rawOptions = {}) {
	const reportConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const profile = getMachineModeProfile(reportConfig.get("machineMode", "latheDiameter"));

	return {
		machineMode: profile.id,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: getConfiguredValue(reportConfig, "xAxisMode", profile.xAxisMode),
		cssSurfaceSpeedUnit: reportConfig.get("cssSurfaceSpeedUnit", "mPerMin"),
		samples: clampNumber(reportConfig.get("samples", 96), 12, 500),
		compactPanelWidth: clampNumber(reportConfig.get("compactPanelWidth", 0.45), 0.2, 0.7),
		rapidRate: clampNumber(coalesce(rawOptions.rapidRate, reportConfig.get("rapidRate", 10000)), 0, Number.POSITIVE_INFINITY),
		toolChangeSeconds: clampNumber(coalesce(rawOptions.toolChangeSeconds, reportConfig.get("toolChangeSeconds", 4)), 0, Number.POSITIVE_INFINITY),
		extraStationSeconds: clampNumber(coalesce(rawOptions.extraStationSeconds, reportConfig.get("extraStationSeconds", 0.5)), 0, Number.POSITIVE_INFINITY),
		humanFormat: {
			minimumDecimalPlaces: clampNumber(displayConfig.get("minimumDecimalPlaces", 3), 0, 9),
			maximumDecimalPlaces: clampNumber(displayConfig.get("maximumDecimalPlaces", 3), 0, 9)
		}
	};
}

function coalesce(value, fallback) {
	return value === undefined || value === null || value === "" ? fallback : value;
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
