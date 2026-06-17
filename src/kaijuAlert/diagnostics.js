// Role: own KAIJU Alert diagnostics. Keep protected-text parsing in
// MetaTextRanges.js and nonblocking Sense fork notices in kaijuSense/fork.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("../MetaTextRanges");
const { getAlertOptions } = require("./options");

const DIAGNOSTIC_SOURCE = "Kaiju Alert";

function registerDiagnostics(context) {
	const diagnostics = vscode.languages.createDiagnosticCollection("gcode");
	context.subscriptions.push(diagnostics);

	if (vscode.window.activeTextEditor) {
		updateDiagnostics(vscode.window.activeTextEditor.document, diagnostics);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateDiagnostics(editor.document, diagnostics);
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			updateDiagnostics(event.document, diagnostics);
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.alerts") || event.affectsConfiguration("kaijuNC.syntax.unresolvedGotos.enabled")) {
				for (const editor of vscode.window.visibleTextEditors) {
					updateDiagnostics(editor.document, diagnostics);
				}
			}
		}),
		vscode.workspace.onDidCloseTextDocument(document => {
			diagnostics.delete(document.uri);
		})
	);
}

function updateDiagnostics(document, diagnostics) {
	if (document.languageId !== "gcode") {
		diagnostics.delete(document.uri);
		return;
	}

	const warnings = [];
	const options = getAlertOptions(document);
	const seenSequenceNumbers = new Map();
	const sequenceNumberOrder = { previous: null };

	if (options.warnUnresolvedGotos) {
		warnings.push(...makeUnresolvedGotoTargetWarnings(document));
	}

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const ignoreRanges = [
			...getCommentRanges(line),
			...getAngleBracketRanges(line),
			...getNamedMacroRanges(line)
		];

		warnings.push(...makeUnclosedDelimiterWarnings(line, lineNumber));
		warnings.push(...makeMultipleCommentParenthesisWarnings(line, lineNumber));
		warnings.push(...makeAddressInsideBracketWarnings(line, lineNumber, ignoreRanges));
		if (options.warnDuplicateSequenceNumbers) {
			warnings.push(...makeDuplicateSequenceNumberWarnings(line, lineNumber, ignoreRanges, seenSequenceNumbers));
		}
		if (options.warnSequenceNumberOrder) {
			warnings.push(...makeOutOfOrderSequenceNumberWarnings(line, lineNumber, ignoreRanges, sequenceNumberOrder));
		}
		if (options.warnNonAscii) {
			warnings.push(...makeNonAsciiWarnings(line, lineNumber));
		}

		const directAddressRegex = /\b([XYZUVWABCIJKRFxyzuvwabcijkrf])([-+]?\d+)(?![.\d])/g;

		let match;
		while ((match = directAddressRegex.exec(line)) !== null) {
			const start = match.index;
			const end = start + match[0].length;

			if (isInsideRange(start, ignoreRanges)) {
				continue;
			}

			warnings.push(
				makeMissingDecimalWarning(
					lineNumber,
					start,
					end,
					match[0]
				)
			);
		}

		const bracketAddressRegex = /\b([XYZUVWABCIJKRFxyzuvwabcijkrf])\[[^\]]*\]/g;

		while ((match = bracketAddressRegex.exec(line)) !== null) {
			const addressStart = match.index;

			if (isInsideRange(addressStart, ignoreRanges)) {
				continue;
			}

			const fullText = match[0];
			const bracketStartInMatch = fullText.indexOf("[");
			const expression = fullText.slice(bracketStartInMatch + 1, -1);
			const expressionStartInLine = addressStart + bracketStartInMatch + 1;
			const integerLiteralRegex = /(^|[^#A-Za-z0-9_.])([-+]?\d+)(?![.\d])/g;

			let innerMatch;
			while ((innerMatch = integerLiteralRegex.exec(expression)) !== null) {
				const prefixLength = innerMatch[1].length;
				const numberText = innerMatch[2];
				const numberStart = expressionStartInLine + innerMatch.index + prefixLength;
				const numberEnd = numberStart + numberText.length;

				warnings.push(
					makeMissingDecimalWarning(
						lineNumber,
						numberStart,
						numberEnd,
						numberText
					)
				);
			}
		}
	}

	diagnostics.set(document.uri, warnings);
}

function getNamedMacroRanges(line) {
	const ranges = [];
	const macroRegex = /#[A-Za-z_][A-Za-z0-9_]*/g;
	let match;

	while ((match = macroRegex.exec(line)) !== null) {
		ranges.push({
			start: match.index,
			end: match.index + match[0].length - 1
		});
	}

	return ranges;
}

function makeUnresolvedGotoTargetWarnings(document) {
	const warnings = [];
	const labels = getSequenceLabels(document);

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);
		const gotoRegex = /\bGOTO\s+(N?)(\d+)(?![.\d])/gi;
		let match;

		while ((match = gotoRegex.exec(codeLine)) !== null) {
			const normalizedTarget = normalizeSequenceNumber(match[2]);

			if (labels.has(normalizedTarget)) {
				continue;
			}

			const targetText = `${match[1]}${match[2]}`;
			const targetStart = match.index + match[0].length - targetText.length;

			warnings.push(
				makeUnresolvedGotoTargetWarning(
					lineNumber,
					targetStart,
					targetStart + targetText.length,
					targetText.toUpperCase()
				)
			);
		}
	}

	return warnings;
}

function getSequenceLabels(document) {
	const labels = new Set();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const match = codeLine.match(/^\s*[Nn](\d+)(?![.\d])/);

		if (match) {
			labels.add(normalizeSequenceNumber(match[1]));
		}
	}

	return labels;
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

function makeDuplicateSequenceNumberWarnings(line, lineNumber, ignoreRanges, seenSequenceNumbers) {
	const warnings = [];
	const sequenceNumberRegex = /\b[Nn](\d+)(?![.\d])/g;
	let match;

	while ((match = sequenceNumberRegex.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		if (isInsideRange(start, ignoreRanges)) {
			continue;
		}

		const normalizedSequenceNumber = String(Number.parseInt(match[1], 10));
		const previous = seenSequenceNumbers.get(normalizedSequenceNumber);

		if (previous) {
			warnings.push(
				makeDuplicateSequenceNumberWarning(
					lineNumber,
					start,
					end,
					match[0].toUpperCase(),
					previous.lineNumber
				)
			);
			continue;
		}

		seenSequenceNumbers.set(normalizedSequenceNumber, { lineNumber });
	}

	return warnings;
}

function makeOutOfOrderSequenceNumberWarnings(line, lineNumber, ignoreRanges, sequenceNumberOrder) {
	const warnings = [];
	const sequenceNumberRegex = /\b[Nn](\d+)(?![.\d])/g;
	let match;

	while ((match = sequenceNumberRegex.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		if (isInsideRange(start, ignoreRanges)) {
			continue;
		}

		const value = Number.parseInt(match[1], 10);
		const text = match[0].toUpperCase();
		const previous = sequenceNumberOrder.previous;

		if (previous && value < previous.value) {
			warnings.push(
				makeOutOfOrderSequenceNumberWarning(
					lineNumber,
					start,
					end,
					text,
					previous.text,
					previous.lineNumber
				)
			);
		}

		sequenceNumberOrder.previous = { value, text, lineNumber };
	}

	return warnings;
}

function makeNonAsciiWarnings(line, lineNumber) {
	const warnings = [];

	for (let index = 0; index < line.length;) {
		const codePoint = line.codePointAt(index);
		const character = String.fromCodePoint(codePoint);
		const characterLength = character.length;

		if (codePoint > 0x7F) {
			warnings.push(makeNonAsciiWarning(lineNumber, index, index + characterLength, character, codePoint));
		}

		index += characterLength;
	}

	return warnings;
}

function makeMultipleCommentParenthesisWarnings(line, lineNumber) {
	const warnings = [];
	let insideComment = false;
	let insideAngleBrackets = false;
	let hasClosedComment = false;

	for (let index = 0; index < line.length; index++) {
		const character = line[index];

		if (character === "<" && !insideComment) {
			insideAngleBrackets = true;
			continue;
		}

		if (character === ">" && insideAngleBrackets) {
			insideAngleBrackets = false;
			continue;
		}

		if (insideAngleBrackets) {
			continue;
		}

		if (character === "(") {
			if (insideComment || hasClosedComment) {
				warnings.push(makeMultipleCommentParenthesisWarning(lineNumber, index));
			}

			insideComment = true;
			continue;
		}

		if (character === ")" && insideComment) {
			insideComment = false;
			hasClosedComment = true;
		}
	}

	return warnings;
}

function makeAddressInsideBracketWarnings(line, lineNumber, ignoreRanges) {
	const warnings = [];
	const bracketRanges = getBracketExpressionRanges(line, ignoreRanges);
	const addressInsideBracketRegex = /(^|[^#A-Za-z0-9_])([GMXYZUVWABCIJKRFLPQTSHgmxyzuvwabcijkrflpqtsh])(?=\s*(?:[-+]?(?:#|\d|\.|\[)))/g;

	for (const range of bracketRanges) {
		const expression = line.slice(range.start + 1, range.end);
		let match;

		while ((match = addressInsideBracketRegex.exec(expression)) !== null) {
			const prefixLength = match[1].length;
			const start = range.start + 1 + match.index + prefixLength;
			const end = start + match[2].length;

			warnings.push(makeAddressInsideBracketWarning(lineNumber, start, end, match[2]));
		}
	}

	return warnings;
}

function getBracketExpressionRanges(line, ignoreRanges) {
	const ranges = [];
	const stack = [];

	for (let index = 0; index < line.length; index++) {
		if (isInsideRange(index, ignoreRanges)) {
			continue;
		}

		if (line[index] === "[") {
			stack.push(index);
			continue;
		}

		if (line[index] === "]" && stack.length) {
			const start = stack.pop();
			ranges.push({ start, end: index });
		}
	}

	return ranges;
}

function makeUnclosedDelimiterWarnings(line, lineNumber) {
	const warnings = [];
	let commentStart = -1;
	let bracketStart = -1;
	let insideAngleBrackets = false;

	for (let index = 0; index < line.length; index++) {
		const character = line[index];

		if (character === "<" && commentStart === -1) {
			insideAngleBrackets = true;
			continue;
		}

		if (character === ">" && insideAngleBrackets) {
			insideAngleBrackets = false;
			continue;
		}

		if (insideAngleBrackets) {
			continue;
		}

		if (character === "(" && commentStart === -1) {
			commentStart = index;
			continue;
		}

		if (character === ")" && commentStart !== -1) {
			commentStart = -1;
			continue;
		}

		if (commentStart !== -1) {
			continue;
		}

		if (character === "[" && bracketStart === -1) {
			bracketStart = index;
			continue;
		}

		if (character === "]" && bracketStart !== -1) {
			bracketStart = -1;
		}
	}

	if (commentStart !== -1) {
		warnings.push(
			makeDelimiterWarning(
				lineNumber,
				commentStart,
				"Opening parenthesis is not closed on this line."
			)
		);
	}

	if (bracketStart !== -1) {
		warnings.push(
			makeDelimiterWarning(
				lineNumber,
				bracketStart,
				"Opening bracket is not closed on this line."
			)
		);
	}

	return warnings;
}

function makeDelimiterWarning(lineNumber, character, message) {
	const range = new vscode.Range(lineNumber, character, lineNumber, character + 1);

	const warning = new vscode.Diagnostic(
		range,
		message,
		vscode.DiagnosticSeverity.Warning
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeMultipleCommentParenthesisWarning(lineNumber, character) {
	const range = new vscode.Range(lineNumber, character, lineNumber, character + 1);

	const warning = new vscode.Diagnostic(
		range,
		"Two sets of comment brackets on one line may not be readable by some controls. KAIJU Reconstructor converts nested parentheses to square brackets.",
		vscode.DiagnosticSeverity.Warning
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeAddressInsideBracketWarning(lineNumber, start, end, address) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);

	const warning = new vscode.Diagnostic(
		range,
		`Address word "${address.toUpperCase()}" is inside a bracket expression. Put the address before the bracket, such as ${address.toUpperCase()}[...].`,
		vscode.DiagnosticSeverity.Error
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeDuplicateSequenceNumberWarning(lineNumber, start, end, sequenceNumber, firstLineNumber) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);

	const warning = new vscode.Diagnostic(
		range,
		`Duplicate sequence number "${sequenceNumber}". First used on line ${firstLineNumber + 1}.`,
		vscode.DiagnosticSeverity.Error
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeOutOfOrderSequenceNumberWarning(lineNumber, start, end, sequenceNumber, previousSequenceNumber, previousLineNumber) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);

	const warning = new vscode.Diagnostic(
		range,
		`Sequence number "${sequenceNumber}" is out of order. Previous sequence number is "${previousSequenceNumber}" on line ${previousLineNumber + 1}.`,
		vscode.DiagnosticSeverity.Error
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeUnresolvedGotoTargetWarning(lineNumber, start, end, target) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);

	const warning = new vscode.Diagnostic(
		range,
		`GOTO target "${target}" has no matching N label.`,
		vscode.DiagnosticSeverity.Error
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeNonAsciiWarning(lineNumber, start, end, character, codePoint) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);
	const codePointText = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

	const warning = new vscode.Diagnostic(
		range,
		`Non-ASCII character "${character}" (${codePointText}) may not be readable by some lathe controls.`,
		vscode.DiagnosticSeverity.Warning
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

function makeMissingDecimalWarning(lineNumber, start, end, text) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);

	const warning = new vscode.Diagnostic(
		range,
		`Numeric value "${text}" is missing a decimal point.`,
		vscode.DiagnosticSeverity.Warning
	);

	warning.source = DIAGNOSTIC_SOURCE;
	return warning;
}

module.exports = {
	registerDiagnostics,
	updateDiagnostics
};
