// Role: own KAIJU Decomposition configuration reads. Keep decomposition
// execution and output rendering in index.js.
const vscode = require("vscode");

const DEFAULT_COMPARISON_TOLERANCE = 1e-7;
const DEFAULT_MAX_EXECUTION_STEPS = 20000;
const DEFAULT_MAX_OUTPUT_LINES = 50000;

function getDecompositionOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.decomposition", document.uri);
	const comparisonTolerance = config.get("comparisonTolerance", DEFAULT_COMPARISON_TOLERANCE);
	const maxExecutionSteps = config.get("maxExecutionSteps", DEFAULT_MAX_EXECUTION_STEPS);
	const maxOutputLines = config.get("maxOutputLines", DEFAULT_MAX_OUTPUT_LINES);

	return {
		comparisonTolerance: Number.isFinite(comparisonTolerance) && comparisonTolerance >= 0
			? comparisonTolerance
			: DEFAULT_COMPARISON_TOLERANCE,
		maxExecutionSteps: clampPositiveInteger(maxExecutionSteps, DEFAULT_MAX_EXECUTION_STEPS),
		maxOutputLines: clampPositiveInteger(maxOutputLines, DEFAULT_MAX_OUTPUT_LINES)
	};
}

function clampPositiveInteger(value, fallback) {
	const number = Number(value);

	return Number.isFinite(number) && number > 0
		? Math.max(1, Math.trunc(number))
		: fallback;
}

module.exports = {
	DEFAULT_COMPARISON_TOLERANCE,
	DEFAULT_MAX_EXECUTION_STEPS,
	DEFAULT_MAX_OUTPUT_LINES,
	getDecompositionOptions
};
