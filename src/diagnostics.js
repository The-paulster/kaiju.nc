const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");

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

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const ignoreRanges = [
			...getCommentRanges(line),
			...getAngleBracketRanges(line)
		];

		warnings.push(...makeUnclosedDelimiterWarnings(line, lineNumber));

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

	warning.source = "Powerful GCode";
	return warning;
}

function makeMissingDecimalWarning(lineNumber, start, end, text) {
	const range = new vscode.Range(lineNumber, start, lineNumber, end);

	const warning = new vscode.Diagnostic(
		range,
		`Numeric value "${text}" is missing a decimal point.`,
		vscode.DiagnosticSeverity.Warning
	);

	warning.source = "Powerful GCode";
	return warning;
}

module.exports = {
	registerDiagnostics
};
