const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");

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
			if (event.affectsConfiguration("kaijuNC.alerts.nonAscii.enabled")) {
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
	const config = vscode.workspace.getConfiguration("kaijuNC.alerts", document.uri);
	const warnNonAscii = config.get("nonAscii.enabled", true);

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const ignoreRanges = [
			...getCommentRanges(line),
			...getAngleBracketRanges(line),
			...getNamedMacroRanges(line)
		];

		warnings.push(...makeUnclosedDelimiterWarnings(line, lineNumber));
		warnings.push(...makeNestedCommentParenthesisWarnings(line, lineNumber));
		warnings.push(...makeAddressInsideBracketWarnings(line, lineNumber, ignoreRanges));
		if (warnNonAscii) {
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

function makeNestedCommentParenthesisWarnings(line, lineNumber) {
	const warnings = [];
	let insideComment = false;
	let insideAngleBrackets = false;

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
			if (insideComment) {
				warnings.push(makeNestedCommentParenthesisWarning(lineNumber, index));
			}

			insideComment = true;
			continue;
		}

		if (character === ")" && insideComment) {
			insideComment = false;
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

function makeNestedCommentParenthesisWarning(lineNumber, character) {
	const range = new vscode.Range(lineNumber, character, lineNumber, character + 1);

	const warning = new vscode.Diagnostic(
		range,
		"Nested parentheses inside a comment may not be readable by some controls. KAIJU Reconstructor converts the inner layer to square brackets.",
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
