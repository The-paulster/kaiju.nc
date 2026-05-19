const vscode = require("vscode");

function registerFormatter(context) {
	const disposable = vscode.languages.registerDocumentFormattingEditProvider(
		{ language: "gcode" },
		{
			provideDocumentFormattingEdits(document) {
				const options = getFormattingOptions(document);

				if (!options.enabled) {
					return [];
				}

				const originalText = document.getText();
				const formattedText = formatDocumentText(originalText, options);

				if (formattedText === originalText) {
					return [];
				}

				const fullRange = new vscode.Range(
					document.positionAt(0),
					document.positionAt(originalText.length)
				);

				return [
					vscode.TextEdit.replace(fullRange, formattedText)
				];
			}
		}
	);

	context.subscriptions.push(disposable);
}

function getFormattingOptions(document, overrides = {}) {
	const config = vscode.workspace.getConfiguration("kaijuNC.format", document.uri);

	return {
		enabled: config.get("enabled", true),
		decimalPlaces: clampNumber(config.get("decimalPlaces", 3), 0, 9),
		addMissingDecimal: config.get("addMissingDecimal", true),
		decimalAddressLetters: config.get("decimalAddressLetters", "XYZUVWABCIJKRF"),
		autoSemicolon: config.get("autoSemicolon", false),
		normalizeToolCodes: config.get("normalizeToolCodes", true),
		...overrides
	};
}

function formatDocumentText(text, options) {
	let formattedText = text;

	// Built-in KAIJU.NC Formatting Standard.
	formattedText = applyFormattingStandard(formattedText, options);

	// Built-in CNC decimal formatting.
	formattedText = formatDecimalPlaces(
		formattedText,
		options.decimalPlaces,
		options.addMissingDecimal,
		options.decimalAddressLetters
	);

	formattedText = formatMacroMathNumbers(
		formattedText,
		options.decimalPlaces,
		options.addMissingDecimal
	);

	if (options.autoSemicolon) {
		formattedText = addSemicolonsBeforeComments(formattedText);
	}

	formattedText = indentLoopBlocks(formattedText);

	return formattedText;
}

function applyFormattingStandard(text, options) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";

	return text
		.split(/\r?\n/)
		.map(line => formatStandardLine(line, options))
		.join(newline);
}

function formatStandardLine(line, options) {
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];
	const segments = splitLineByProtectedRanges(line, protectedRanges);
	let result = "";

	for (const segment of segments) {
		if (!segment.protected) {
			result += formatCodeSegment(segment.text, options);
			continue;
		}

		if (segment.text.startsWith("(")) {
			const trimmedResult = result.trimEnd();

			if (trimmedResult) {
				result = trimmedResult + " ";
			}
		}

		result += segment.text;
	}

	return result.trimEnd();
}

function formatCodeSegment(text, options) {
	let result = text.toUpperCase();

	result = normalizeControlWordSpacing(result);
	result = addSpacesBetweenAddressWords(result);
	result = normalizeGAndMCodes(result);

	if (options.normalizeToolCodes) {
		result = normalizeToolCodes(result);
	}

	result = spaceMacroOperators(result);
	result = result.replace(/[ \t]+/g, " ");
	result = normalizeControlWordSpacing(result);
	result = normalizeOptionalBlockSkipSpacing(result);

	return result.trim();
}

function normalizeControlWordSpacing(text) {
	let result = text;

	result = result.replace(/\bWHIL\s+E(?=\s*\[)/g, "WHILE");
	result = result.replace(/\bI\s+F(?=\s*\[)/g, "IF");
	result = result.replace(/\bFU\s+P(?=\s*\[)/g, "FUP");
	result = result.replace(/\bWHILE\s+(?=\[)/g, "WHILE");
	result = result.replace(/\bIF\s+(?=\[)/g, "IF");
	result = result.replace(/\bFUP\s+(?=\[)/g, "FUP");
	result = result.replace(/\bDO\s+(\d+)(?:\.0+)?\b/g, "DO$1");
	result = result.replace(/\bEND\s+(\d+)(?:\.0+)?\b/g, "END$1");
	result = result.replace(/\bGOTO\s+([-+]?\d+)\.0+\b/g, "GOTO $1");

	return result;
}

function normalizeOptionalBlockSkipSpacing(text) {
	return text.replace(/^\/\s+/, "/");
}

function normalizeGAndMCodes(text) {
	return text.replace(/\b([GM])(\d)(?!\d)/g, (fullMatch, letter, digit) => {
		return `${letter}0${digit}`;
	});
}

function normalizeToolCodes(text) {
	return text.replace(/\bT(\d{1,4})(?!\d)/g, (fullMatch, digits) => {
		if (digits.length <= 2) {
			const paddedDigits = digits.padStart(2, "0");
			return `T${paddedDigits}${paddedDigits}`;
		}

		if (digits.length === 3) {
			return `T${digits.padStart(4, "0")}`;
		}

		return fullMatch;
	});
}

function addSpacesBetweenAddressWords(text) {
	let result = "";

	for (let i = 0; i < text.length; i++) {
		if (shouldInsertSpaceBeforeAddressWord(text, i, result)) {
			result += " ";
		}

		result += text[i];
	}

	return result;
}

function shouldInsertSpaceBeforeAddressWord(text, index, outputText) {
	if (!isAddressLetter(text[index])) {
		return false;
	}

	if (!startsAddressValue(text, index + 1)) {
		return false;
	}

	if (!outputText || /\s$/.test(outputText) || outputText.endsWith("/")) {
		return false;
	}

	return !/[A-Z]$/.test(outputText);
}

function isAddressLetter(character) {
	return /^[GMXYZUVWABCIJKRFLPQTS]$/.test(character);
}

function startsAddressValue(text, index) {
	const character = text[index];

	if (!character) {
		return false;
	}

	if (character === "#" || character === "[") {
		return true;
	}

	if (character === "+" || character === "-") {
		return /^[\d.]$/.test(text[index + 1] || "");
	}

	return /^[\d.]$/.test(character);
}

function spaceMacroOperators(text) {
	let result = text;

	result = result.replace(/([#\]\d.])([*/])(?=[#\d.\[])/g, "$1 $2 ");
	result = result.replace(/([#\]\d.])([+-])(?=[#\d.\[])/g, "$1 $2 ");
	result = result.replace(/[ \t]*=[ \t]*/g, " = ");

	return result;
}

function formatMacroMathNumbers(text, decimalPlaces, addMissingDecimal) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";

	return text
		.split(/\r?\n/)
		.map(line => formatMacroMathNumbersInLine(line, decimalPlaces, addMissingDecimal))
		.join(newline);
}

function formatMacroMathNumbersInLine(line, decimalPlaces, addMissingDecimal) {
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];
	const segments = splitLineByProtectedRanges(line, protectedRanges);

	return segments
		.map(segment => {
			if (segment.protected || !segment.text.includes("#")) {
				return segment.text;
			}

			const protectedGotoTargets = protectGotoTargets(segment.text);
			const formattedText = formatNumbersInsideExpression(
				protectedGotoTargets.text,
				decimalPlaces,
				addMissingDecimal
			);

			return restoreGotoTargets(formattedText, protectedGotoTargets.targets);
		})
		.join("");
}

function protectGotoTargets(text) {
	const targets = [];
	const protectedText = text.replace(/\bGOTO\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+))/gi, (fullMatch, target) => {
		const token = `__KAIJU_GOTO_TARGET_${targets.length}__`;
		targets.push(normalizeGotoTarget(target));
		return fullMatch.replace(target, token);
	});

	return {
		text: protectedText,
		targets
	};
}

function restoreGotoTargets(text, targets) {
	return targets.reduce((result, target, index) => {
		return result.replace(`__KAIJU_GOTO_TARGET_${index}__`, target);
	}, text);
}

function normalizeGotoTarget(target) {
	const number = Number(target);

	if (Number.isInteger(number)) {
		return String(number);
	}

	return target;
}

function formatDecimalPlaces(text, decimalPlaces, addMissingDecimal, addressLetters) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";

	return text
		.split(/\r?\n/)
		.map(line => formatLineDecimals(line, decimalPlaces, addMissingDecimal, addressLetters))
		.join(newline);
}

function formatLineDecimals(line, decimalPlaces, addMissingDecimal, addressLetters) {
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	const addressClass = escapeForCharClass(addressLetters);

	// Case 1:
	// Direct address values:
	// X0.06  -> X0.060
	// X1     -> X1.000
	// Z-2    -> Z-2.000
	//
	// Does not touch:
	// G1, M3, N100, O1000, #100
	const directAddressRegex = new RegExp(
		`\\b([${addressClass}])([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))(?![.\\dA-Za-z_])`,
		"gi"
	);

	line = line.replace(directAddressRegex, (fullMatch, address, numberText, offset) => {
		if (isInsideRange(offset, protectedRanges)) {
			return fullMatch;
		}

		return address + formatNumberLiteral(numberText, decimalPlaces, addMissingDecimal);
	});

	// Case 2:
	// Address bracket expressions:
	// X[#100 + 0.06] -> X[#100 + 0.060]
	// X[#100 + 1]    -> X[#100 + 1.000]
	//
	// Does not touch macro variable IDs:
	// #100 stays #100
	const bracketAddressRegex = new RegExp(
		`\\b([${addressClass}])\\[([^\\]]*)\\]`,
		"gi"
	);

	line = line.replace(bracketAddressRegex, (fullMatch, address, expression, offset) => {
		if (isInsideRange(offset, protectedRanges)) {
			return fullMatch;
		}

		const formattedExpression = formatNumbersInsideExpression(
			expression,
			decimalPlaces,
			addMissingDecimal
		);

		return `${address}[${formattedExpression}]`;
	});

	return line;
}

function formatNumbersInsideExpression(expression, decimalPlaces, addMissingDecimal) {
	const numberRegex = /(^|[^#A-Za-z0-9_.])([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?![.\dA-Za-z_])/g;

	return expression.replace(numberRegex, (fullMatch, prefix, numberText) => {
		return prefix + formatNumberLiteral(numberText, decimalPlaces, addMissingDecimal);
	});
}

function formatNumberLiteral(numberText, decimalPlaces, addMissingDecimal) {
	const hasDecimal = numberText.includes(".");

	if (!hasDecimal && !addMissingDecimal) {
		return numberText;
	}

	const normalizedNumberText = normalizeLeadingDecimal(numberText);
	const value = Number(normalizedNumberText);

	if (!Number.isFinite(value)) {
		return numberText;
	}

	const sign = getNumberSign(normalizedNumberText, value);
	const unsignedNumberText = normalizedNumberText.replace(/^[-+]/, "");
	const [integerPart, decimalPart = ""] = unsignedNumberText.split(".");

	if (!hasDecimal) {
		return `${sign}${integerPart}.${"0".repeat(decimalPlaces)}`;
	}

	const paddedDecimalPart = decimalPart.padEnd(decimalPlaces, "0");

	return `${sign}${integerPart}.${paddedDecimalPart}`;
}

function normalizeLeadingDecimal(numberText) {
	return numberText.replace(/^([-+]?)\./, "$10.");
}

function getNumberSign(numberText, value) {
	if (numberText.startsWith("-") || Object.is(value, -0)) {
		return "-";
	}

	if (numberText.startsWith("+")) {
		return "+";
	}

	return "";
}

function addSemicolonsBeforeComments(text) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";

	return text
		.split(/\r?\n/)
		.map(addSemicolonToLine)
		.join(newline);
}

function addSemicolonToLine(line) {
	if (!line.trim()) {
		return ";";
	}

	const commentStart = line.indexOf("(");
	const splitAt = commentStart === -1 ? line.length : commentStart;
	const codePart = line.slice(0, splitAt);
	const commentPart = line.slice(splitAt);
	const codeEnd = codePart.trimEnd();

	if (!codeEnd && commentPart) {
		return ";" + commentPart;
	}

	if (codePart.trim() === ";" && commentPart) {
		return ";" + commentPart;
	}

	if (codeEnd.endsWith(";")) {
		return line;
	}

	return codeEnd + ";" + codePart.slice(codeEnd.length) + commentPart;
}

function indentLoopBlocks(text) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const indentUnit = detectIndentUnit(text);
	let depth = 0;

	return text
		.split(/\r?\n/)
		.map(line => {
			const trimmedLine = line.trim();

			if (!trimmedLine) {
				return "";
			}

			const codeLine = stripLineComments(trimmedLine);

			if (startsWithLoopEnd(codeLine)) {
				depth = Math.max(0, depth - 1);
			}

			const indentedLine = indentUnit.repeat(depth) + trimmedLine;

			if (startsLoopBlock(codeLine)) {
				depth++;
			}

			return indentedLine;
		})
		.join(newline);
}

function detectIndentUnit(text) {
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^([ \t]+)/);

		if (!match) {
			continue;
		}

		return match[1].includes("\t") ? "\t" : " ".repeat(Math.min(match[1].length, 4));
	}

	return "\t";
}

function stripLineComments(line) {
	let result = "";
	let insideComment = false;
	let insideAngleBrackets = false;

	for (let i = 0; i < line.length; i++) {
		const character = line[i];

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

		if (character === "(" && !insideComment) {
			insideComment = true;
			continue;
		}

		if (character === ")" && insideComment) {
			insideComment = false;
			continue;
		}

		if (!insideComment) {
			result += character;
		}
	}

	return result.trim();
}

function startsLoopBlock(codeLine) {
	return /\bWHILE\s*\[[^\]]*\]\s*DO\d+\b/i.test(codeLine);
}

function startsWithLoopEnd(codeLine) {
	return /^\/?\s*END\d+\b/i.test(codeLine);
}

function splitLineByProtectedRanges(line, ranges) {
	if (!ranges.length) {
		return [{ text: line, protected: false }];
	}

	const sortedRanges = mergeProtectedRanges(ranges);
	const segments = [];
	let cursor = 0;

	for (const range of sortedRanges) {
		if (range.start > cursor) {
			segments.push({
				text: line.slice(cursor, range.start),
				protected: false
			});
		}

		segments.push({
			text: line.slice(range.start, range.end + 1),
			protected: true
		});

		cursor = range.end + 1;
	}

	if (cursor < line.length) {
		segments.push({
			text: line.slice(cursor),
			protected: false
		});
	}

	return segments;
}

function mergeProtectedRanges(ranges) {
	const sortedRanges = [...ranges]
		.sort((a, b) => a.start - b.start || b.end - a.end);
	const mergedRanges = [];

	for (const range of sortedRanges) {
		const previousRange = mergedRanges[mergedRanges.length - 1];

		if (previousRange && range.start <= previousRange.end + 1) {
			previousRange.end = Math.max(previousRange.end, range.end);
			continue;
		}

		mergedRanges.push({
			start: range.start,
			end: range.end
		});
	}

	return mergedRanges;
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

function escapeForCharClass(text) {
	return String(text).replace(/[-\\\]^]/g, "\\$&");
}

function getCommentRanges(line) {
	const ranges = [];
	let start = -1;

	for (let i = 0; i < line.length; i++) {
		if (line[i] === "(" && start === -1) {
			start = i;
		} else if (line[i] === ")" && start !== -1) {
			ranges.push({ start, end: i });
			start = -1;
		}
	}

	return ranges;
}

function getAngleBracketRanges(line) {
	const ranges = [];
	let start = -1;

	for (let i = 0; i < line.length; i++) {
		if (line[i] === "<" && start === -1) {
			start = i;
		} else if (line[i] === ">" && start !== -1) {
			ranges.push({ start, end: i });
			start = -1;
		}
	}

	return ranges;
}

function isInsideRange(index, ranges) {
	return ranges.some(range => index >= range.start && index <= range.end);
}

module.exports = {
	registerFormatter,
	getFormattingOptions,
	formatDocumentText
};
