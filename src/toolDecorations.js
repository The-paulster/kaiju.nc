const vscode = require("vscode");

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

function registerToolDecorations(context) {
	const decorationTypes = TOOL_COLORS.map(color => {
		const decorationType = vscode.window.createTextEditorDecorationType({
			gutterIconPath: makeToolMarkerUri(color),
			gutterIconSize: "contain",
			overviewRulerColor: color,
			overviewRulerLane: vscode.OverviewRulerLane.Left
		});

		context.subscriptions.push(decorationType);
		return decorationType;
	});

	let pendingUpdate;

	const scheduleUpdate = () => {
		clearTimeout(pendingUpdate);
		pendingUpdate = setTimeout(() => {
			updateVisibleToolDecorations(decorationTypes);
		}, 100);
	};

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(scheduleUpdate),
		vscode.window.onDidChangeVisibleTextEditors(scheduleUpdate),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) {
				scheduleUpdate();
			}
		}),
		{
			dispose() {
				clearTimeout(pendingUpdate);
			}
		}
	);

	updateVisibleToolDecorations(decorationTypes);
}

function updateVisibleToolDecorations(decorationTypes) {
	for (const editor of vscode.window.visibleTextEditors) {
		updateToolDecorations(editor, decorationTypes);
	}
}

function updateToolDecorations(editor, decorationTypes) {
	const groupedDecorations = decorationTypes.map(() => []);

	if (editor.document.languageId === "gcode") {
		for (const range of getToolRanges(editor.document)) {
			for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
				groupedDecorations[range.colorIndex].push({
					range: new vscode.Range(lineNumber, 0, lineNumber, 0)
				});
			}
		}
	}

	for (let i = 0; i < decorationTypes.length; i++) {
		editor.setDecorations(decorationTypes[i], groupedDecorations[i]);
	}
}

function getToolRanges(document) {
	const toolCalls = [];
	const toolColorIndexes = new Map();
	const macroValues = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const tool = findToolCall(codeLine, macroValues);

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

		trackMacroAssignments(codeLine, macroValues);
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

function findToolCall(codeLine, macroValues) {
	const match = codeLine.match(/\bT\s*(\d{1,4}|[-+]?#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)|\[[^\]]+\])/i);

	if (!match) {
		return "";
	}

	const toolCode = resolveToolCode(match[1], macroValues);

	return toolCode ? `T${toolCode}` : "";
}

function resolveToolCode(toolText, macroValues) {
	const trimmedToolText = toolText.trim();

	if (/^\d{1,4}$/.test(trimmedToolText)) {
		return normalizeToolDigits(trimmedToolText);
	}

	const expression = trimmedToolText.startsWith("[") && trimmedToolText.endsWith("]")
		? trimmedToolText.slice(1, -1)
		: trimmedToolText;
	const numericValue = evaluateNumericExpression(expression, macroValues);

	if (!Number.isFinite(numericValue)) {
		return "";
	}

	return normalizeToolDigits(String(Math.trunc(Math.abs(numericValue))));
}

function normalizeToolDigits(digits) {
	if (digits.length <= 2) {
		const paddedDigits = digits.padStart(2, "0");
		return `${paddedDigits}${paddedDigits}`;
	}

	if (digits.length === 3) {
		return digits.padStart(4, "0");
	}

	return digits.slice(0, 4);
}

function trackMacroAssignments(codeLine, macroValues) {
	for (const assignment of findAssignments(codeLine)) {
		const numericValue = evaluateNumericExpression(assignment.value, macroValues);

		if (Number.isFinite(numericValue)) {
			macroValues.set(assignment.macro, numericValue);
		} else {
			macroValues.delete(assignment.macro);
		}
	}
}

function findAssignments(codeLine) {
	const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g;
	const matches = [...codeLine.matchAll(assignmentRegex)];

	return matches.map((match, index) => {
		const nextMatch = matches[index + 1];
		const valueStart = match.index + match[0].length;
		const semicolonStart = codeLine.indexOf(";", valueStart);
		const valueEnd = Math.min(
			nextMatch ? nextMatch.index : codeLine.length,
			semicolonStart === -1 ? codeLine.length : semicolonStart
		);

		return {
			macro: match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0].toUpperCase(),
			value: codeLine.slice(valueStart, valueEnd).trim()
		};
	});
}

function evaluateNumericExpression(expression, macroValues) {
	const jsExpression = expression
		.replace(/\[/g, "(")
		.replace(/\]/g, ")")
		.replace(/\bMOD\b/gi, "%")
		.replace(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g, macro => {
			const value = macroValues.get(macro.toUpperCase());
			return Number.isFinite(value) ? String(value) : "NaN";
		});

	if (jsExpression.includes("NaN")) {
		return NaN;
	}

	if (!/^[\d+\-*/%().\s]+$/.test(jsExpression)) {
		return NaN;
	}

	if (/^\s*[-+]?\d+(?:\.\d*)?\s*$/.test(jsExpression)) {
		return Number(jsExpression);
	}

	try {
		const value = Function(`"use strict"; return (${jsExpression});`)();
		return Number.isFinite(value) ? value : NaN;
	} catch {
		return NaN;
	}
}

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getWrappedRanges(line, "(", ")"),
		...getWrappedRanges(line, "<", ">")
	];

	for (const range of protectedRanges) {
		for (let i = range.start; i <= range.end; i++) {
			characters[i] = " ";
		}
	}

	return characters.join("");
}

function getWrappedRanges(line, openChar, closeChar) {
	const ranges = [];
	let start = -1;

	for (let i = 0; i < line.length; i++) {
		if (line[i] === openChar && start === -1) {
			start = i;
		} else if (line[i] === closeChar && start !== -1) {
			ranges.push({ start, end: i });
			start = -1;
		}
	}

	return ranges;
}

function makeToolMarkerUri(color) {
	const svg = [
		"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"16\" viewBox=\"0 0 12 16\">",
		`<rect x="4" y="0" width="4" height="16" rx="1" fill="${color}" fill-opacity="0.82"/>`,
		"</svg>"
	].join("");

	return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

module.exports = {
	registerToolDecorations,
	getToolRanges
};
