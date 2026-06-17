// Role: watch KAIJU Sense GOTO fork ambiguity and emit non-blocking alerts when
// a formerly forked target resolves to a single N label. Keep N-label hovers and
// navigation in nLabels.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("../MetaTextRanges");

function registerKaijuSenseFork(context) {
	const snapshots = new Map();
	const output = vscode.window.createOutputChannel("KAIJU Alert");
	context.subscriptions.push(output);

	if (vscode.window.activeTextEditor) {
		captureSnapshot(vscode.window.activeTextEditor.document, snapshots);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				captureSnapshot(editor.document, snapshots);
			}
		}),
		vscode.workspace.onDidOpenTextDocument(document => {
			captureSnapshot(document, snapshots);
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			checkForResolvedForks(event.document, snapshots, output);
		}),
		vscode.workspace.onDidCloseTextDocument(document => {
			snapshots.delete(getDocumentKey(document));
		})
	);
}

function captureSnapshot(document, snapshots) {
	if (document.languageId !== "gcode") {
		return;
	}

	snapshots.set(getDocumentKey(document), getGotoForkSnapshot(document));
}

function checkForResolvedForks(document, snapshots, output) {
	if (document.languageId !== "gcode") {
		return;
	}

	const documentKey = getDocumentKey(document);
	const previous = snapshots.get(documentKey);
	const current = getGotoForkSnapshot(document);

	snapshots.set(documentKey, current);

	if (!previous) {
		return;
	}

	for (const [key, currentReference] of current.references) {
		const previousReference = previous.references.get(key);

		if (!previousReference || previousReference.targetCount <= 1 || currentReference.targetCount !== 1) {
			continue;
		}

		const deletedTarget = findDeletedTarget(previousReference.targets, currentReference.targets);
		const detail = formatForkEliminatedDetail(currentReference, deletedTarget);
		output.appendLine("Kaiju Alert");
		output.appendLine(detail);
		output.appendLine("");

		vscode.window.showWarningMessage("Kaiju Alert: Fork eliminated", "Show Details").then(selection => {
			if (selection === "Show Details") {
				output.show(true);
			}
		});
	}
}

function getGotoForkSnapshot(document) {
	const labels = buildLabelMap(document);
	const references = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		for (const reference of getReferencesAtLine(document, lineNumber)) {
			const targets = labels.get(reference.label) || [];

			references.set(reference.key, {
				...reference,
				targetCount: targets.length,
				targets
			});
		}
	}

	return { references };
}

function buildLabelMap(document) {
	const labels = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);
		const labelInfo = getLineLabelInfo(line, codeLine);

		if (!labelInfo) {
			continue;
		}

		const existing = labels.get(labelInfo.label) || [];
		existing.push({
			lineNumber,
			text: labelInfo.text,
			comment: extractCommentText(line)
		});

		labels.set(labelInfo.label, existing);
	}

	return labels;
}

function getReferencesAtLine(document, lineNumber) {
	const line = document.lineAt(lineNumber).text;
	const codeLine = maskProtectedRanges(line);
	const references = [];
	const gotoRegex = /\bGOTO\s+(N?)(\d+)(?![.\d])/gi;
	let match;

	while ((match = gotoRegex.exec(codeLine)) !== null) {
		const prefix = codeLine.slice(0, match.index);
		const label = normalizeSequenceNumber(match[2]);
		const targetText = `${match[1]}${match[2]}`;
		const start = match.index;
		const originLabel = getLineLabelInfo(line, codeLine);

		references.push({
			key: `${lineNumber}:${start}:${label}`,
			label,
			targetText,
			lineNumber,
			kind: /\bIF\b/i.test(prefix) ? "IF GOTO" : "GOTO",
			originLabelText: originLabel && originLabel.text,
			comment: extractCommentText(line)
		});
	}

	return references;
}

function findDeletedTarget(previousTargets, currentTargets) {
	const currentLineNumbers = new Set(currentTargets.map(target => target.lineNumber));
	return previousTargets.find(target => !currentLineNumbers.has(target.lineNumber)) || previousTargets.find(target => target.lineNumber !== currentTargets[0].lineNumber);
}

function formatForkEliminatedDetail(reference, deletedTarget) {
	const target = reference.targets[0];

	return [
		"Fork eliminated",
		"Origin:",
		formatOriginLine(reference),
		"Deleted Target:",
		formatTargetLine(deletedTarget),
		"Target:",
		formatTargetLine(target)
	].join("\n");
}

function formatOriginLine(reference) {
	const labelText = reference.originLabelText ? ` label ${reference.originLabelText}` : "";
	return `Line ${reference.lineNumber + 1}${labelText} ${reference.kind} ${reference.targetText}${formatComment(reference.comment)}`;
}

function formatTargetLine(target) {
	if (!target) {
		return "Line unknown";
	}

	return `Line ${target.lineNumber + 1}${formatComment(target.comment)}`;
}

function formatComment(comment) {
	return comment ? ` (${comment})` : "";
}

function getLineLabelInfo(line, codeLine) {
	const match = codeLine.match(/^(\s*)[Nn](\d+)(?![.\d])/);

	if (!match) {
		return undefined;
	}

	const start = match[1].length;
	const end = start + match[0].trimStart().length;
	const text = line.slice(start, end);

	return {
		label: normalizeSequenceNumber(match[2]),
		text
	};
}

function extractCommentText(line) {
	return getCommentRanges(line)
		.map(range => cleanCommentText(line.slice(range.start, range.end + 1)))
		.filter(Boolean)
		.join(" ");
}

function cleanCommentText(text) {
	const trimmed = text.trim();

	if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

function normalizeSequenceNumber(text) {
	return String(Number.parseInt(text, 10));
}

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of protectedRanges) {
		for (let index = range.start; index <= range.end; index++) {
			characters[index] = " ";
		}
	}

	return characters.join("");
}

function getDocumentKey(document) {
	return document.uri.toString();
}

module.exports = {
	registerKaijuSenseFork,
	getGotoForkSnapshot
};
