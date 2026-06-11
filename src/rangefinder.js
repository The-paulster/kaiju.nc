const vscode = require("vscode");
const { getToolRanges } = require("./toolModel");
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("./textRanges");

function registerKaijuRangefinder(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.rangefinder", async () => {
			await runKaijuRangefinderCommand();
		})
	);
}

async function runKaijuRangefinderCommand() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before using KAIJU Rangefinder.");
		return;
	}

	const action = await vscode.window.showQuickPick([
		{
			label: "Current Tool Range",
			description: "Select the tool section at the cursor",
			rangefinderAction: "currentTool"
		},
		{
			label: "Tool Range...",
			description: "Pick a tool section to select",
			rangefinderAction: "tool"
		},
		{
			label: "Between N Labels...",
			description: "Pick a start and end N label",
			rangefinderAction: "labels"
		},
		{
			label: "Current N Block",
			description: "Select from the current N label to the next one",
			rangefinderAction: "currentNBlock"
		}
	], {
		placeHolder: "KAIJU Rangefinder"
	});

	if (!action) {
		return;
	}

	if (action.rangefinderAction === "currentTool") {
		selectCurrentToolRange(editor);
	} else if (action.rangefinderAction === "tool") {
		await selectPickedToolRange(editor);
	} else if (action.rangefinderAction === "labels") {
		await selectBetweenLabels(editor);
	} else if (action.rangefinderAction === "currentNBlock") {
		selectCurrentNBlock(editor);
	}
}

function selectCurrentToolRange(editor) {
	const toolRanges = getToolRanges(editor.document);
	const currentRange = findCurrentToolRange(toolRanges, editor.selection.active.line);

	if (!currentRange) {
		vscode.window.showWarningMessage("KAIJU Rangefinder could not find a tool range at the cursor.");
		return;
	}

	applyLineSelection(editor, currentRange.startLine, currentRange.endLine);
	vscode.window.showInformationMessage(formatSelectionMessage(currentRange.tool, currentRange.startLine, currentRange.endLine));
}

async function selectPickedToolRange(editor) {
	const toolRanges = getToolRanges(editor.document);

	if (!toolRanges.length) {
		vscode.window.showWarningMessage("KAIJU Rangefinder could not find any tool ranges in this file.");
		return;
	}

	const item = await vscode.window.showQuickPick(toolRanges.map(range => ({
		label: range.tool,
		description: formatLineSpan(range.startLine, range.endLine),
		detail: getLinePreview(editor.document, range.startLine),
		range
	})), {
		placeHolder: "Select a tool range"
	});

	if (!item) {
		return;
	}

	applyLineSelection(editor, item.range.startLine, item.range.endLine);
	vscode.window.showInformationMessage(formatSelectionMessage(item.range.tool, item.range.startLine, item.range.endLine));
}

async function selectBetweenLabels(editor) {
	const labels = buildLabelItems(editor.document);

	if (labels.length < 2) {
		vscode.window.showWarningMessage("KAIJU Rangefinder needs at least two N labels to select between labels.");
		return;
	}

	const start = await vscode.window.showQuickPick(labels, {
		placeHolder: "Start N label"
	});

	if (!start) {
		return;
	}

	const end = await vscode.window.showQuickPick(labels, {
		placeHolder: "End N label"
	});

	if (!end) {
		return;
	}

	const startLine = Math.min(start.lineNumber, end.lineNumber);
	const endLine = Math.max(start.lineNumber, end.lineNumber);
	applyLineSelection(editor, startLine, endLine);
	vscode.window.showInformationMessage(`KAIJU Rangefinder selected ${formatLineSpan(startLine, endLine)}.`);
}

function selectCurrentNBlock(editor) {
	const block = findCurrentNBlock(editor.document, editor.selection.active.line);

	if (!block) {
		vscode.window.showWarningMessage("KAIJU Rangefinder could not find an N block at the cursor.");
		return;
	}

	applyLineSelection(editor, block.startLine, block.endLine);
	vscode.window.showInformationMessage(formatSelectionMessage(block.label, block.startLine, block.endLine));
}

function findCurrentToolRange(toolRanges, lineNumber) {
	return toolRanges.find(range => lineNumber >= range.startLine && lineNumber <= range.endLine);
}

function findCurrentNBlock(document, lineNumber) {
	const labels = buildLabelItems(document);
	const currentLabelIndex = labels.findIndex((label, index) => {
		const nextLabel = labels[index + 1];
		return lineNumber >= label.lineNumber && (!nextLabel || lineNumber < nextLabel.lineNumber);
	});

	if (currentLabelIndex === -1) {
		return undefined;
	}

	const label = labels[currentLabelIndex];
	const nextLabel = labels[currentLabelIndex + 1];

	return {
		label: label.label,
		startLine: label.lineNumber,
		endLine: nextLabel ? nextLabel.lineNumber - 1 : document.lineCount - 1
	};
}

function buildLabelItems(document) {
	const labels = [];

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);
		const match = codeLine.match(/^\s*N\s*(\d+)(?![.\d])/i);

		if (!match) {
			continue;
		}

		labels.push({
			label: `N${match[1]}`,
			description: `L${lineNumber + 1}`,
			detail: line.trim(),
			lineNumber,
			value: Number.parseInt(match[1], 10)
		});
	}

	return labels;
}

function applyLineSelection(editor, startLine, endLine) {
	const selectionRange = makeSelectionRange(editor.document, startLine, endLine);
	editor.selection = new vscode.Selection(selectionRange.start, selectionRange.end);
	editor.revealRange(selectionRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function makeSelectionRange(document, startLine, endLine) {
	const safeStartLine = clampLine(document, startLine);
	const safeEndLine = clampLine(document, endLine);
	const orderedStartLine = Math.min(safeStartLine, safeEndLine);
	const orderedEndLine = Math.max(safeStartLine, safeEndLine);
	const start = new vscode.Position(orderedStartLine, 0);
	const end = new vscode.Position(orderedEndLine, document.lineAt(orderedEndLine).text.length);

	return new vscode.Range(start, end);
}

function clampLine(document, lineNumber) {
	return Math.max(0, Math.min(document.lineCount - 1, lineNumber));
}

function formatSelectionMessage(name, startLine, endLine) {
	return `KAIJU Rangefinder selected ${name}: ${formatLineSpan(startLine, endLine)}.`;
}

function formatLineSpan(startLine, endLine) {
	return `L${startLine + 1}-L${endLine + 1}`;
}

function getLinePreview(document, lineNumber) {
	const preview = document.lineAt(lineNumber).text.trim();
	return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
}

function maskProtectedRanges(line) {
	const characters = line.split("");
	const ranges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of ranges) {
		for (let index = range.start; index <= range.end; index++) {
			characters[index] = " ";
		}
	}

	return characters.join("");
}

module.exports = {
	registerKaijuRangefinder,
	buildLabelItems,
	findCurrentToolRange,
	findCurrentNBlock,
	makeSelectionRange
};
