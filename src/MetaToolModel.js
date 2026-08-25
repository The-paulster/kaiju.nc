// Role: parse and model tool ranges/colors for Sense, Vision, and Rangefinder features.
// Keep editor decorations in kaijuSense/tool.js.
const { maskProtectedRanges } = require("./MetaTextRanges");
const {
	buildMacroAliasMap,
	evaluateNumericExpression,
	findMacroAssignments,
	setMacroValue
} = require("./MetaMacroEngine");

const TOOL_COLORS = [
	"#8f4f4f",
	"#5f7d59",
	"#4f6f93",
	"#8f704e",
	"#765c8d",
	"#5f8491",
	"#9a8648",
	"#8b625b",
	"#6f678c",
	"#4f8574",
	"#81677d",
	"#69784f",
	"#806448",
	"#557484",
	"#855970",
	"#646b82"
];

function getToolRanges(document) {
	const toolCalls = [];
	const toolColorIndexes = new Map();
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const tool = findToolCall(codeLine, macroValues, macroAliases);

		if (tool) {
			if (!toolColorIndexes.has(tool)) {
				toolColorIndexes.set(tool, toolColorIndexes.size % TOOL_COLORS.length);
			}

			toolCalls.push({
				tool,
				colorIndex: toolColorIndexes.get(tool),
				lineNumber
			});
		}

		trackMacroAssignments(codeLine, macroValues, macroAliases);
	}

	return toolCalls.map((toolCall, index) => {
		const nextToolCall = toolCalls[index + 1];

		return {
			tool: toolCall.tool,
			colorIndex: toolCall.colorIndex,
			startLine: toolCall.lineNumber,
			endLine: nextToolCall ? nextToolCall.lineNumber - 1 : document.lineCount - 1
		};
	});
}

function findToolCall(codeLine, macroValues, macroAliases) {
	const match = codeLine.match(/\bT\s*(\d{1,4}|[-+]?#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)|\[[^\]]+\])/i);

	if (!match) {
		return "";
	}

	const toolCode = resolveToolCode(match[1], macroValues, macroAliases);

	return toolCode ? `T${toolCode}` : "";
}

function resolveToolCode(toolText, macroValues, macroAliases) {
	const trimmedToolText = toolText.trim();

	if (/^\d{1,4}$/.test(trimmedToolText)) {
		return normalizeToolDigits(trimmedToolText);
	}

	const expression = trimmedToolText.startsWith("[") && trimmedToolText.endsWith("]")
		? trimmedToolText.slice(1, -1)
		: trimmedToolText;
	const numericValue = evaluateNumericExpression(expression, macroValues, macroAliases);

	if (!Number.isFinite(numericValue)) {
		return trimmedToolText;
	}

	return normalizeToolDigits(String(Math.trunc(Math.abs(numericValue))));
}

function normalizeToolDigits(digits) {
	if (digits.length <= 4) {
		return digits;
	}

	return digits.slice(-4);
}

function trackMacroAssignments(codeLine, macroValues, macroAliases) {
	for (const assignment of findMacroAssignments(codeLine)) {
		const numericValue = evaluateNumericExpression(assignment.value, macroValues, macroAliases);
		setMacroValue(macroValues, assignment.macro, numericValue, macroAliases);
	}
}

module.exports = {
	TOOL_COLORS,
	getToolRanges
};
