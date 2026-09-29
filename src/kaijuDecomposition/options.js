// Role: own KAIJU Decomposition configuration reads. Keep decomposition
// execution and output rendering in index.js.
const vscode = require("vscode");

const DEFAULT_COMPARISON_TOLERANCE = 1e-7;

function getDecompositionOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.decomposition", document.uri);
	const comparisonTolerance = config.get("comparisonTolerance", DEFAULT_COMPARISON_TOLERANCE);

	return {
		comparisonTolerance: Number.isFinite(comparisonTolerance) && comparisonTolerance >= 0
			? comparisonTolerance
			: DEFAULT_COMPARISON_TOLERANCE
	};
}

module.exports = {
	DEFAULT_COMPARISON_TOLERANCE,
	getDecompositionOptions
};
