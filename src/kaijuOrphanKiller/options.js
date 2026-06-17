// Role: own KAIJU Orphan Killer configuration reads. Keep macro inspection and
// report rendering in index.js.
const vscode = require("vscode");

const DEFAULT_IGNORED_MACROS = "1001-";

function getOrphanKillerOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.orphanKiller", document.uri);

	return {
		compactPanelWidth: clampNumber(config.get("compactPanelWidth", 0.3), 0.15, 0.5),
		ignoredMacros: config.get("ignoredMacros", DEFAULT_IGNORED_MACROS)
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
	DEFAULT_IGNORED_MACROS,
	getOrphanKillerOptions
};
