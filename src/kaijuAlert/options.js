// Role: own KAIJU Alert configuration reads. Keep diagnostic construction in
// diagnostics.js.
const vscode = require("vscode");

function getAlertOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.alerts", document.uri);
	const syntaxConfig = vscode.workspace.getConfiguration("kaijuNC.syntax", document.uri);

	return {
		warnNonAscii: config.get("nonAscii.enabled", true),
		warnDuplicateSequenceNumbers: config.get("duplicateSequenceNumbers.enabled", true),
		warnSequenceNumberOrder: config.get("sequenceNumberOrder.enabled", true),
		warnUnmatchedLoops: config.get("unmatchedLoops.enabled", true),
		warnMixedAliasMode: config.get("mixedAliasMode.enabled", true),
		warnUndefinedAliases: config.get("undefinedAliases.enabled", true),
		warnUnresolvedGotos: syntaxConfig.get("unresolvedGotos.enabled", true)
	};
}

module.exports = {
	getAlertOptions
};
