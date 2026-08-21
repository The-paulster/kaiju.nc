// Role: centralize KAIJU Sense configuration reads and derived machine-profile
// defaults. Keep UI rendering, hovers, status bars, and modal interpretation out
// of this file.
const vscode = require("vscode");
const {
	getConfiguredValue,
	getMachineModeProfile
} = require("../MetaMachineMode");

function getSenseOptions(document) {
	const senseConfig = vscode.workspace.getConfiguration("kaijuNC.sense", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const profile = getMachineModeProfile(chronobladeConfig.get("machineMode", "latheDiameter"));

	return {
		enabled: senseConfig.get("enabled", chronobladeConfig.get("enabled", true)),
		statusVerbose: senseConfig.get("statusBarVerbose", true),
		statusSyntaxColors: senseConfig.get("statusBarSyntaxColors", false),
		modalNames: getModalNames(senseConfig.get("modalNames", {})),
		syntaxColoredHoverValues: senseConfig.get("syntaxColoredHoverValues", false),
		machineMode: profile.id,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: getConfiguredValue(senseConfig, "xAxisMode", getConfiguredValue(chronobladeConfig, "xAxisMode", profile.xAxisMode)),
		cssSurfaceSpeedUnit: senseConfig.get("cssSurfaceSpeedUnit", chronobladeConfig.get("cssSurfaceSpeedUnit", "mPerMin")),
		samples: clampNumber(senseConfig.get("samples", chronobladeConfig.get("samples", 96)), 12, 500),
		rapidRate: clampNumber(senseConfig.get("rapidRate", chronobladeConfig.get("rapidRate", 10000)), 0, Number.POSITIVE_INFINITY),
		humanFormat: {
			minimumDecimalPlaces: clampNumber(displayConfig.get("minimumDecimalPlaces", 3), 0, 9),
			maximumDecimalPlaces: clampNumber(displayConfig.get("maximumDecimalPlaces", 3), 0, 9)
		}
	};
}

function getModalNames(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}

	const names = {};

	for (const [code, label] of Object.entries(value)) {
		const normalizedCode = normalizeModalCode(code);
		const normalizedLabel = typeof label === "string" ? label.trim() : "";

		if (normalizedCode && normalizedLabel) {
			names[normalizedCode] = normalizedLabel;
		}
	}

	return names;
}

function normalizeModalCode(value) {
	const match = String(value || "").trim().toUpperCase().match(/^([GM])0*(\d+(?:\.\d+)?)(?:\s|$)/);

	return match ? `${match[1]}${Number(match[2])}` : "";
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	getSenseOptions,
	getModalNames,
	normalizeModalCode
};
