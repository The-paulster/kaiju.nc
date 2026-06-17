// Role: own KAIJU Vision configuration reads. Keep report rendering and webview
// behavior in webview.js.
const vscode = require("vscode");
const {
	getConfiguredValue,
	getMachineModeProfile
} = require("../MetaMachineMode");

function getVisionOptions(document, rawOptions = {}) {
	const config = vscode.workspace.getConfiguration("kaijuNC.vision", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const profile = getMachineModeProfile(chronobladeConfig.get("machineMode", "latheDiameter"));

	return {
		plane: ["xy", "xz", "zy"].includes(rawOptions.plane) ? rawOptions.plane : config.get("plane", "xz"),
		useToolColors: rawOptions.useToolColors === true,
		machineMode: profile.id,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: getConfiguredValue(config, "xAxisMode", getConfiguredValue(chronobladeConfig, "xAxisMode", profile.xAxisMode)),
		xzOrientation: config.get("xzOrientation", "zRightXUp"),
		xyOrientation: config.get("xyOrientation", "xRightYUp"),
		zyOrientation: config.get("zyOrientation", "zRightYUp"),
		cssSurfaceSpeedUnit: config.get("cssSurfaceSpeedUnit", chronobladeConfig.get("cssSurfaceSpeedUnit", "mPerMin")),
		samples: clampNumber(config.get("samples", chronobladeConfig.get("samples", 96)), 12, 500),
		compactPanelWidth: clampNumber(config.get("compactPanelWidth", 0.55), 0.25, 0.8),
		rapidRate: clampNumber(config.get("rapidRate", chronobladeConfig.get("rapidRate", 10000)), 0, Number.POSITIVE_INFINITY),
		lineThickness: clampNumber(config.get("lineThickness", 1), 0.1, 5),
		arrowSize: clampNumber(config.get("arrowSize", 1), 0.1, 5),
		endpointSize: clampNumber(config.get("endpointSize", 3), 1, 24),
		startPointSize: clampNumber(config.get("startPointSize", 4), 1, 24),
		labelFontSize: clampNumber(config.get("labelFontSize", 9), 5, 32),
		labelOffset: clampNumber(config.get("labelOffset", 10), 0, 80),
		compassSize: clampNumber(config.get("compassSize", 78), 24, 220),
		compassOffsetX: clampNumber(config.get("compassOffsetX", 14), 0, 240),
		compassOffsetY: clampNumber(config.get("compassOffsetY", 14), 0, 240),
		humanFormat: {
			minimumDecimalPlaces: clampNumber(displayConfig.get("minimumDecimalPlaces", 3), 0, 9),
			maximumDecimalPlaces: clampNumber(displayConfig.get("maximumDecimalPlaces", 3), 0, 9)
		},
		g53Position: {
			x: Number(config.get("g53.x", 0)),
			y: Number(config.get("g53.y", 0)),
			z: Number(config.get("g53.z", 0))
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
	getVisionOptions
};
