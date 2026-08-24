// Role: own KAIJU Alert configuration reads. Keep diagnostic construction in
// diagnostics.js.
const vscode = require("vscode");
const {
	getConfiguredValue,
	getMachineModeProfile
} = require("../MetaMachineMode");

function getAlertOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.alerts", document.uri);
	const syntaxConfig = vscode.workspace.getConfiguration("kaijuNC.syntax", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const profile = getMachineModeProfile(chronobladeConfig.get("machineMode", "latheDiameter"));

	return {
		warnNonAscii: config.get("nonAscii.enabled", true),
		warnDuplicateSequenceNumbers: config.get("duplicateSequenceNumbers.enabled", true),
		warnSequenceNumberOrder: config.get("sequenceNumberOrder.enabled", true),
		warnUnmatchedLoops: config.get("unmatchedLoops.enabled", true),
		warnAdjacentOperators: config.get("adjacentOperators.enabled", true),
		warnMixedAliasMode: config.get("mixedAliasMode.enabled", true),
		warnUndefinedAliases: config.get("undefinedAliases.enabled", true),
		warnUnresolvedGotos: syntaxConfig.get("unresolvedGotos.enabled", true),
		warnIllegalArcs: config.get("illegalArcs.enabled", true),
		arcTolerance: clampNumber(config.get("illegalArcs.tolerance", 0.001), 0, 10, 0.001),
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: getConfiguredValue(chronobladeConfig, "xAxisMode", profile.xAxisMode)
	};
}

function clampNumber(value, minimum, maximum, fallback) {
	const number = Number(value);

	return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

module.exports = {
	getAlertOptions
};
