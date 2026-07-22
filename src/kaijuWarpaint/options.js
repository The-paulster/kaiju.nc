// Role: own KAIJU Warpaint configuration reads. Keep section storage and
// decoration behavior in index.js.
const vscode = require("vscode");

function getWarpaintOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.warpaint", document && document.uri);

	return {
		enabled: config.get("enabled", true),
		backgroundIntensity: clampNumber(config.get("backgroundIntensity", 0.05), 0, 0.5),
		overviewRulerEnabled: config.get("overviewRuler.enabled", true),
		markerCompositorEnabled: config.get("markerCompositor.enabled", true),
		markerMaxSections: clampInteger(config.get("marker.maxSections", 2), 0, 2),
		markerSectionStripeWidth: clampNumber(config.get("marker.sectionStripeWidth", 2), 1, 12),
		markerToolGap: clampNumber(config.get("marker.toolGap", 2), 0, 8),
		markerVerticalOverflow: clampNumber(config.get("marker.verticalOverflow", 1), 0, 4)
	};
}

function clampNumber(value, min, max) {
	const numericValue = Number(value);

	if (!Number.isFinite(numericValue)) {
		return min;
	}

	return Math.max(min, Math.min(max, numericValue));
}

function clampInteger(value, min, max) {
	return Math.round(clampNumber(value, min, max));
}

module.exports = {
	getWarpaintOptions
};
