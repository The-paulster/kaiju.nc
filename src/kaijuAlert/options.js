// Role: own KAIJU Alert configuration reads. Keep diagnostic construction in
// diagnostics.js.
const vscode = require("vscode");
const {
	getMachineModeForDocument
} = require("../MetaMachineMode");

function getAlertOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.alerts", document.uri);
	const syntaxConfig = vscode.workspace.getConfiguration("kaijuNC.syntax", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const machineMode = getMachineModeForDocument(document);
	const profile = machineMode.profile;

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
		warnUnboundGCodes: config.get("unboundGCodes.enabled", false),
		arcTolerance: clampNumber(config.get("illegalArcs.tolerance", 0.001), 0, 10, 0.001),
		machineMode: profile.id,
		cAxisCoordinates: machineMode.machineSettings && machineMode.machineSettings.cAxisCoordinates,
		cAxisResetOnDisable: machineMode.machineSettings && machineMode.machineSettings.cAxisResetOnDisable,
		gCodeDialectId: machineMode.gCodeDialectId,
		gCodeDialect: machineMode.gCodeDialect,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: machineMode.xAxisMode,
		...machineMode.motionOptions
	};
}

function clampNumber(value, minimum, maximum, fallback) {
	const number = Number(value);

	return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

module.exports = {
	getAlertOptions
};
