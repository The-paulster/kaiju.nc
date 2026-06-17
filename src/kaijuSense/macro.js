// Role: provide KAIJU Sense macro hovers. Keep alias toggling in ../kaijuAlias.js
// and macro parsing/evaluation in ../MetaMacroEngine.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	isInsideRange
} = require("../MetaTextRanges");
const {
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
} = require("../MetaMacroEngine");

function registerKaijuSenseMacro(context) {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ language: "gcode" }, {
			provideHover(document, position) {
				return provideMacroHover(document, position);
			}
		})
	);
}

function provideMacroHover(document, position) {
	if (document.languageId !== "gcode") {
		return undefined;
	}

	const hoveredMacro = getMacroAtPosition(document, position);

	if (!hoveredMacro) {
		return undefined;
	}

	const macroAliases = buildMacroAliasMap(document);
	const macroDefinitions = buildMacroDefinitionTable(document, macroAliases);
	const resolvedMacro = resolveMacroAlias(hoveredMacro, macroAliases);
	const definition = macroDefinitions.get(normalizeMacro(hoveredMacro)) || macroDefinitions.get(resolvedMacro);

	if (!definition) {
		const md = new vscode.MarkdownString([
			`**KAIJU Sense - ${hoveredMacro}**`,
			"",
			"`No definition found above or in document.`"
		].join("\n"));

		return new vscode.Hover(md);
	}

	const md = new vscode.MarkdownString();

	md.appendMarkdown(`**KAIJU Sense - ${hoveredMacro}**\n\n`);

	if (definition.value) {
		md.appendMarkdown(`**Value:** \`${definition.value}\`\n\n`);
	} else {
		md.appendMarkdown("**Value:** `No value found`\n\n");
	}

	if (Number.isFinite(definition.numericValue)) {
		md.appendMarkdown(`**Resolved:** \`${formatMacroNumber(definition.numericValue)}\`\n\n`);
	}

	if (definition.comment) {
		md.appendMarkdown(`**Comment:** ${escapeMarkdown(definition.comment)}\n\n`);
	} else {
		md.appendMarkdown("**Comment:** `No comment found`\n\n");
	}

	md.appendMarkdown(`**Defined:** ${definition.definedLabel}\n\n`);

	md.appendCodeblock(definition.lineText.trim(), "gcode");

	return new vscode.Hover(md);
}

function getMacroAtPosition(document, position) {
	const line = document.lineAt(position.line).text;
	const commentRanges = getCommentRanges(line);

	if (isInsideRange(position.character, commentRanges)) {
		return undefined;
	}

	const macroRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g;

	let match;
	while ((match = macroRegex.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		if (position.character >= start && position.character <= end) {
			return match[0];
		}
	}

	return undefined;
}

function buildMacroDefinitionTable(document, macroAliases) {
	const definitions = new Map();
	const macroValues = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const commentRanges = getCommentRanges(line);
		const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g;

		let match;
		while ((match = assignmentRegex.exec(line)) !== null) {
			const macro = match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0];
			const normalizedMacro = normalizeMacro(macro);
			const resolvedMacro = resolveMacroAlias(normalizedMacro, macroAliases);

			if (isInsideRange(match.index, commentRanges)) {
				continue;
			}

			const valueStart = match.index + match[0].length;
			const value = extractValueAfterEquals(line, valueStart);
			const numericValue = evaluateNumericExpression(value, macroValues, macroAliases);
			const comment = extractFirstComment(line);
			const blockNumber = extractBlockNumber(line);

			const definedLabel = blockNumber
				? blockNumber
				: `Line ${lineNumber + 1}`;

			const definition = {
				value,
				numericValue,
				comment,
				definedLabel,
				lineNumber,
				lineText: line
			};

			if (!definitions.has(normalizedMacro)) {
				definitions.set(normalizedMacro, definition);
			}

			if (!definitions.has(resolvedMacro)) {
				definitions.set(resolvedMacro, definition);
			}

			setMacroValue(macroValues, normalizedMacro, numericValue, macroAliases);
		}
	}

	return definitions;
}

function extractValueAfterEquals(line, valueStart) {
	let valueEnd = line.length;

	const commentStart = line.indexOf("(", valueStart);
	if (commentStart !== -1) {
		valueEnd = commentStart;
	}

	return line.slice(valueStart, valueEnd).trim();
}

function extractFirstComment(line) {
	const match = line.match(/\(([^)]*)\)/);

	if (!match) {
		return "";
	}

	return match[1].trim();
}

function extractBlockNumber(line) {
	const match = line.match(/\b[Nn]\d+\b/);

	if (!match) {
		return "";
	}

	return match[0].toUpperCase();
}

function formatMacroNumber(value) {
	if (Number.isInteger(value)) {
		return String(value);
	}

	return String(Number(value.toFixed(6)));
}

function escapeMarkdown(text) {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/\*/g, "\\*")
		.replace(/_/g, "\\_")
		.replace(/`/g, "\\`")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]");
}

module.exports = {
	registerKaijuSenseMacro
};
