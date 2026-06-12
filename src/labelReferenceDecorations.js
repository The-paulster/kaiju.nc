const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("./textRanges");

const LABEL_REFERENCE_MARKER = "\u21A9";
const REFERENCE_HIGHLIGHT_BACKGROUND = "rgba(255, 193, 7, 0.22)";
const REFERENCE_HIGHLIGHT_BORDER = "rgba(255, 193, 7, 0.65)";
const HOVER_HIGHLIGHT_CLEAR_DELAY_MS = 1500;

function registerLabelReferenceDecorations(context) {
	const decorationType = vscode.window.createTextEditorDecorationType({
		after: {
			margin: "0 0 0 1ch",
			color: new vscode.ThemeColor("editorWarning.foreground"),
			fontWeight: "600"
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
	});
	const incomingReferenceDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: REFERENCE_HIGHLIGHT_BACKGROUND,
		border: `1px solid ${REFERENCE_HIGHLIGHT_BORDER}`
	});
	const targetLabelDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: REFERENCE_HIGHLIGHT_BACKGROUND,
		border: `1px solid ${REFERENCE_HIGHLIGHT_BORDER}`
	});
	const hoverIncomingReferenceDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: REFERENCE_HIGHLIGHT_BACKGROUND,
		border: `1px solid ${REFERENCE_HIGHLIGHT_BORDER}`
	});
	const hoverTargetLabelDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: REFERENCE_HIGHLIGHT_BACKGROUND,
		border: `1px solid ${REFERENCE_HIGHLIGHT_BORDER}`
	});

	context.subscriptions.push(decorationType);
	context.subscriptions.push(incomingReferenceDecorationType);
	context.subscriptions.push(targetLabelDecorationType);
	context.subscriptions.push(hoverIncomingReferenceDecorationType);
	context.subscriptions.push(hoverTargetLabelDecorationType);
	let pendingHoverClear;
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ language: "gcode" }, {
			provideHover(document, position) {
				if (!areLabelReferenceDecorationsEnabled(document)) {
					clearHoverHighlightDecorations(document, {
						incomingReference: hoverIncomingReferenceDecorationType,
						targetLabel: hoverTargetLabelDecorationType
					});
					return undefined;
				}

				const referenceInfo = getLabelReferenceAtPosition(document, position)
					|| getGotoReferenceAtPosition(document, position);

				if (!referenceInfo) {
					clearHoverHighlightDecorations(document, {
						incomingReference: hoverIncomingReferenceDecorationType,
						targetLabel: hoverTargetLabelDecorationType
					});
					return undefined;
				}

				updateHoverHighlightDecorations(document, position, {
					incomingReference: hoverIncomingReferenceDecorationType,
					targetLabel: hoverTargetLabelDecorationType
				});
				clearTimeout(pendingHoverClear);
				pendingHoverClear = setTimeout(() => {
					clearHoverHighlightDecorations(document, {
						incomingReference: hoverIncomingReferenceDecorationType,
						targetLabel: hoverTargetLabelDecorationType
					});
				}, HOVER_HIGHLIGHT_CLEAR_DELAY_MS);

				return new vscode.Hover(referenceInfo.detail, referenceInfo.range);
			}
		}),
		vscode.languages.registerDefinitionProvider({ language: "gcode" }, {
			provideDefinition(document, position) {
				if (!areLabelReferenceDecorationsEnabled(document)) {
					return undefined;
				}

				const referenceInfo = getGotoReferenceAtPosition(document, position);

				if (!referenceInfo || !referenceInfo.target) {
					return undefined;
				}

				return new vscode.Location(document.uri, makeLabelRange(referenceInfo.target));
			}
		})
	);

	let pendingUpdate;
	const scheduleUpdate = () => {
		clearTimeout(pendingUpdate);
		pendingUpdate = setTimeout(() => {
			updateVisibleLabelReferenceDecorations({
				labelReference: decorationType,
				incomingReference: incomingReferenceDecorationType,
				targetLabel: targetLabelDecorationType
			});
		}, 100);
	};

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(scheduleUpdate),
		vscode.window.onDidChangeVisibleTextEditors(scheduleUpdate),
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (vscode.window.visibleTextEditors.includes(event.textEditor)) {
				clearHoverHighlightDecorations(event.textEditor.document, {
					incomingReference: hoverIncomingReferenceDecorationType,
					targetLabel: hoverTargetLabelDecorationType
				});
				updateLabelReferenceDecorations(event.textEditor, {
					labelReference: decorationType,
					incomingReference: incomingReferenceDecorationType,
					targetLabel: targetLabelDecorationType
				});
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) {
				scheduleUpdate();
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.sense.labelReferences.enabled")) {
				scheduleUpdate();
			}
		}),
		{
			dispose() {
				clearTimeout(pendingUpdate);
				clearTimeout(pendingHoverClear);
			}
		}
	);

	updateVisibleLabelReferenceDecorations({
		labelReference: decorationType,
		incomingReference: incomingReferenceDecorationType,
		targetLabel: targetLabelDecorationType
	});
}

function updateVisibleLabelReferenceDecorations(decorationTypes) {
	for (const editor of vscode.window.visibleTextEditors) {
		updateLabelReferenceDecorations(editor, decorationTypes);
	}
}

function updateLabelReferenceDecorations(editor, decorationTypes) {
	const enabled = editor.document.languageId === "gcode" && areLabelReferenceDecorationsEnabled(editor.document);
	const labelDecorations = enabled ? buildLabelReferenceDecorations(editor.document) : [];
	const highlightDecorations = enabled
		? buildSelectionHighlightDecorations(editor.document, editor.selections || [editor.selection])
		: { incomingReferences: [], targetLabels: [] };

	editor.setDecorations(decorationTypes.labelReference, labelDecorations);
	editor.setDecorations(decorationTypes.incomingReference, highlightDecorations.incomingReferences);
	editor.setDecorations(decorationTypes.targetLabel, highlightDecorations.targetLabels);
}

function areLabelReferenceDecorationsEnabled(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.sense", document.uri);

	return config.get("labelReferences.enabled", true);
}

function buildLabelReferenceDecorations(document) {
	const labels = buildLabelMap(document);
	const references = buildReferenceMap(document);
	const decorations = [];

	for (const [label, labelInfo] of labels) {
		const labelReferences = references.get(label);

		if (!labelReferences || labelReferences.length === 0) {
			continue;
		}

		decorations.push({
			range: makeLabelRange(labelInfo),
			renderOptions: {
				after: {
					contentText: ` ${LABEL_REFERENCE_MARKER} ${formatReferenceCount(labelReferences.length)}`
				}
			}
		});
	}

	return decorations;
}

function getLabelReferenceAtPosition(document, position) {
	const labelInfo = getLabelAtLine(document, position.line);

	if (!labelInfo || position.character < labelInfo.start || position.character > labelInfo.end) {
		return undefined;
	}

	const references = buildReferenceMap(document).get(labelInfo.label);

	if (!references || references.length === 0) {
		return undefined;
	}

	return {
		range: makeLabelRange(labelInfo),
		detail: formatReferenceDetail(references)
	};
}

function getGotoReferenceAtPosition(document, position) {
	const reference = getReferenceAtPosition(document, position);

	if (!reference) {
		return undefined;
	}

	const labels = buildLabelMap(document);
	const target = labels.get(reference.label);

	if (!target) {
		return undefined;
	}

	return {
		range: new vscode.Range(position.line, reference.start, position.line, reference.end),
		target,
		detail: formatGotoReferenceDetail(reference, target)
	};
}

function buildSelectionHighlightDecorations(document, selections, options = {}) {
	const labels = buildLabelMap(document);
	const references = buildReferenceMap(document);
	const incomingReferenceLines = new Map();
	const targetLabelLines = new Map();
	const includeHoverMessages = options.includeHoverMessages !== false;

	for (const lineNumber of getSelectedLineNumbers(document, selections)) {
		const labelInfo = getLabelAtLine(document, lineNumber);

		if (labelInfo) {
			const labelReferences = references.get(labelInfo.label) || [];

			for (const reference of labelReferences) {
				incomingReferenceLines.set(reference.lineNumber, {
					lineNumber: reference.lineNumber,
					message: `References ${labelInfo.text} on line ${lineNumber + 1}.`
				});
			}
		}

		for (const reference of getReferencesAtLine(document, lineNumber)) {
			const target = labels.get(reference.label);

			if (target) {
				targetLabelLines.set(target.lineNumber, {
					lineNumber: target.lineNumber,
					message: `${reference.kind} on line ${lineNumber + 1} targets ${target.text}.`
				});
			}
		}
	}

	return {
		incomingReferences: [...incomingReferenceLines.values()]
			.map(lineInfo => makeLineHighlightDecoration(lineInfo, { includeHoverMessages })),
		targetLabels: [...targetLabelLines.values()]
			.map(lineInfo => makeLineHighlightDecoration(lineInfo, { includeHoverMessages }))
	};
}

function updateHoverHighlightDecorations(document, position, decorationTypes) {
	const editor = getVisibleEditorForDocument(document);

	if (!editor) {
		return;
	}

	const highlightDecorations = buildSelectionHighlightDecorations(document, [{
		start: position,
		end: position
	}], { includeHoverMessages: false });

	editor.setDecorations(decorationTypes.incomingReference, highlightDecorations.incomingReferences);
	editor.setDecorations(decorationTypes.targetLabel, highlightDecorations.targetLabels);
}

function clearHoverHighlightDecorations(document, decorationTypes) {
	const editor = getVisibleEditorForDocument(document);

	if (!editor) {
		return;
	}

	editor.setDecorations(decorationTypes.incomingReference, []);
	editor.setDecorations(decorationTypes.targetLabel, []);
}

function getVisibleEditorForDocument(document) {
	const documentKey = document && document.uri && document.uri.toString
		? document.uri.toString()
		: undefined;

	return vscode.window.visibleTextEditors.find(editor => {
		if (editor.document === document) {
			return true;
		}

		return documentKey && editor.document && editor.document.uri && editor.document.uri.toString() === documentKey;
	});
}

function buildLabelMap(document) {
	const labels = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const labelInfo = getLabelAtLine(document, lineNumber);

		if (!labelInfo) {
			continue;
		}

		const label = labelInfo.label;

		if (labels.has(label)) {
			continue;
		}

		labels.set(label, labelInfo);
	}

	return labels;
}

function getLabelAtLine(document, lineNumber) {
	const line = document.lineAt(lineNumber).text;
	const codeLine = maskProtectedRanges(line);
	const match = codeLine.match(/^(\s*)[Nn](\d+)(?![.\d])/);

	if (!match) {
		return undefined;
	}

	const start = match[1].length;
	const text = line.slice(start, start + match[0].length - match[1].length).toUpperCase();

	return {
		label: normalizeSequenceNumber(match[2]),
		lineNumber,
		start,
		end: start + text.length,
		text
	};
}

function buildReferenceMap(document) {
	const references = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		for (const reference of getReferencesAtLine(document, lineNumber)) {
			addReference(references, reference.label, {
				kind: reference.kind,
				lineNumber,
				text: reference.text
			});
		}
	}

	return references;
}

function getReferencesAtLine(document, lineNumber) {
	const line = document.lineAt(lineNumber).text;
	const codeLine = maskProtectedRanges(line);
	const references = [];
	const gotoRegex = /\bGOTO\s*N?(\d+)(?![.\d])/gi;
	let match;

	while ((match = gotoRegex.exec(codeLine)) !== null) {
		const prefix = codeLine.slice(0, match.index);

		references.push({
			label: normalizeSequenceNumber(match[1]),
			kind: /\bIF\b/i.test(prefix) ? "IF GOTO" : "GOTO",
			text: line
		});
	}

	return references;
}

function getReferenceAtPosition(document, position) {
	const line = document.lineAt(position.line).text;
	const codeLine = maskProtectedRanges(line);
	const gotoRegex = /\bGOTO\s*N?(\d+)(?![.\d])/gi;
	let match;

	while ((match = gotoRegex.exec(codeLine)) !== null) {
		const start = match.index;
		const end = match.index + match[0].length;

		if (position.character < start || position.character > end) {
			continue;
		}

		const prefix = codeLine.slice(0, match.index);

		return {
			label: normalizeSequenceNumber(match[1]),
			kind: /\bIF\b/i.test(prefix) ? "IF GOTO" : "GOTO",
			text: line,
			start,
			end
		};
	}

	return undefined;
}

function addReference(references, label, reference) {
	if (!references.has(label)) {
		references.set(label, []);
	}

	references.get(label).push(reference);
}

function formatReferenceDetail(references) {
	const lines = references.map(reference => `**L${reference.lineNumber + 1}:** \`${reference.text.trimEnd()}\``);

	return new vscode.MarkdownString([
		`**KAIJU Sense - Label References**`,
		"",
		...lines
	].join("\n"));
}

function formatGotoReferenceDetail(reference, target) {
	const markdown = new vscode.MarkdownString([
		`**KAIJU Sense - ${reference.kind}**`,
		"",
		`Targets **L${target.lineNumber + 1}:** \`${target.text}\``,
		"",
		`<small><em>Ctrl+Click to jump to ${target.text}.</em></small>`
	].join("\n"));

	markdown.supportHtml = true;

	return markdown;
}

function formatReferenceCount(count) {
	return `${count} ref${count === 1 ? "" : "s"}`;
}

function makeLabelRange(labelInfo) {
	return new vscode.Range(labelInfo.lineNumber, labelInfo.start, labelInfo.lineNumber, labelInfo.end);
}

function makeLineHighlightDecoration(lineInfo, options = {}) {
	const decoration = {
		range: new vscode.Range(lineInfo.lineNumber, 0, lineInfo.lineNumber, Number.MAX_SAFE_INTEGER)
	};

	if (options.includeHoverMessages !== false) {
		decoration.hoverMessage = lineInfo.message;
	}

	return decoration;
}

function getSelectedLineNumbers(document, selections) {
	const lineNumbers = new Set();

	for (const selection of selections || []) {
		if (!selection) {
			continue;
		}

		const startLine = Math.max(0, Math.min(selection.start.line, selection.end.line));
		const endLine = Math.min(document.lineCount - 1, Math.max(selection.start.line, selection.end.line));

		for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
			lineNumbers.add(lineNumber);
		}
	}

	return lineNumbers;
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

module.exports = {
	registerLabelReferenceDecorations,
	buildLabelReferenceDecorations,
	getLabelReferenceAtPosition,
	buildSelectionHighlightDecorations
};
