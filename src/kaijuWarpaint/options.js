// Role: own KAIJU Warpaint configuration reads. Keep section storage and
// decoration behavior in index.js.
const vscode = require("vscode");

function getWarpaintOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.warpaint", document && document.uri);

	return {
		enabled: config.get("enabled", true),
		leftStripesEnabled: config.get("leftStripes.enabled", false),
		backgroundIntensity: clampNumber(config.get("backgroundIntensity", 0.05), 0, 0.5),
		overviewRulerEnabled: config.get("overviewRuler.enabled", true)
	};
}

function clampNumber(value, min, max) {
	const numericValue = Number(value);

	if (!Number.isFinite(numericValue)) {
		return min;
	}

	return Math.max(min, Math.min(max, numericValue));
}

module.exports = {
	getWarpaintOptions
};
