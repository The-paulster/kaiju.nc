// Role: own KAIJU Vision configuration reads. Keep report rendering and webview
// behavior in webview.js.
const vscode = require("vscode");
const {
	getConfiguredValue,
	getMachineModeProfile
} = require("../MetaMachineMode");

const VISION_PLANES = new Set(["xy", "yx", "xz", "zx", "yz", "zy"]);
const AUTO_VISION_PLANE = "auto";

function getVisionOptions(document, rawOptions = {}) {
	const config = vscode.workspace.getConfiguration("kaijuNC.vision", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const profile = getMachineModeProfile(chronobladeConfig.get("machineMode", "latheDiameter"));
	const defaultPlane = getDefaultVisionPlane(profile);

	return {
		plane: VISION_PLANES.has(rawOptions.plane)
			? rawOptions.plane
			: normalizeVisionPlane(getConfiguredValue(config, "plane", AUTO_VISION_PLANE), defaultPlane),
		useToolColors: rawOptions.useToolColors === true,
		workOffsets: normalizeVisionWorkOffsets(rawOptions.workOffsets),
		machineMode: profile.id,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: getConfiguredValue(config, "xAxisMode", getConfiguredValue(chronobladeConfig, "xAxisMode", profile.xAxisMode)),
		xzOrientation: config.get("xzOrientation", "zRightXUp"),
		xyOrientation: config.get("xyOrientation", "xRightYUp"),
		zyOrientation: config.get("zyOrientation", "zRightYUp"),
		cssSurfaceSpeedUnit: config.get("cssSurfaceSpeedUnit", chronobladeConfig.get("cssSurfaceSpeedUnit", "mPerMin")),
		samples: clampNumber(config.get("samples", chronobladeConfig.get("samples", 96)), 12, 500),
		compactPanelWidth: clampNumber(config.get("compactPanelWidth", 0.55), 0.25, 0.8),
		zoomStep: clampNumber(config.get("zoomStep", 1.75), 1.01, 5),
		wheelZoomStep: clampNumber(config.get("wheelZoomStep", 1.36), 1.01, 5),
		rapidRate: clampNumber(config.get("rapidRate", chronobladeConfig.get("rapidRate", 10000)), 0, Number.POSITIVE_INFINITY),
		lineThickness: clampNumber(config.get("lineThickness", 1), 0.1, 5),
		arrowSize: clampNumber(config.get("arrowSize", 1), 0.1, 5),
		endpointSize: clampNumber(config.get("endpointSize", 3), 1, 24),
		startPointSize: clampNumber(config.get("startPointSize", 4), 1, 24),
		labelFontSize: clampNumber(config.get("labelFontSize", 11), 5, 32),
		labelOffset: clampNumber(config.get("labelOffset", 5), 0, 80),
		trimLabelTrailingZeros: config.get("trimLabelTrailingZeros", true) !== false,
		pointMergeDistance: clampNumber(config.get("pointMergeDistance", 20), 0, 80),
		endpointLabelAvoidance: config.get("endpointLabelAvoidance", false) === true,
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

const VISION_WORK_OFFSET_CODES = ["G54", "G55", "G56", "G57", "G58", "G59"];

function normalizeVisionWorkOffsets(rawOffsets = {}) {
	const offsets = {};

	for (const code of VISION_WORK_OFFSET_CODES) {
		const raw = rawOffsets && rawOffsets[code] ? rawOffsets[code] : {};
		offsets[code] = {
			enabled: raw.enabled === true,
			x: normalizeOffsetAxis(raw.x),
			y: normalizeOffsetAxis(raw.y),
			z: normalizeOffsetAxis(raw.z),
			note: typeof raw.note === "string" ? raw.note : ""
		};
	}

	return offsets;
}

function normalizeOffsetAxis(value) {
	const number = Number(value);

	return Number.isFinite(number) ? number : 0;
}
function getDefaultVisionPlane(profile) {
	return profile && profile.id === "mill" ? "xy" : "zx";
}

function normalizeVisionPlane(value, fallback = "zx") {
	if (value === AUTO_VISION_PLANE) {
		return fallback;
	}

	return VISION_PLANES.has(value) ? value : fallback;
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	getVisionOptions,
	normalizeVisionWorkOffsets,
	VISION_WORK_OFFSET_CODES
};
