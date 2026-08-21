// Role: provide KAIJU Sense macro hovers. Keep alias toggling in ../kaijuAlias.js
// and macro parsing/evaluation in ../MetaMacroEngine.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	isInsideRange
} = require("../MetaTextRanges");
const {
	buildAliasEntries,
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
} = require("../MetaMacroEngine");
const {
	getExecutionTrace,
	getMacroHistory
} = require("../MetaExecutionTrace");

function registerKaijuSenseMacro(context) {
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider({ language: "gcode" }, {
			provideDefinition(document, position) {
				return provideMacroDefinition(document, position);
			}
		}),
		vscode.languages.registerHoverProvider({ language: "gcode" }, {
			provideHover(document, position) {
				return provideMacroHover(document, position);
			}
		})
	);
}

function provideMacroDefinition(document, position) {
	if (document.languageId !== "gcode") {
		return undefined;
	}

	const macro = getMacroAtPosition(document, position);
	if (!macro) {
		return undefined;
	}

	const aliases = buildMacroAliasMap(document);
	const definitions = buildMacroDefinitionTable(document, aliases);
	const resolvedMacro = resolveMacroAlias(macro, aliases);
	const definition = definitions.get(normalizeMacro(macro)) || definitions.get(resolvedMacro);
	if (!definition || !Number.isInteger(definition.identityLineNumber)) {
		return undefined;
	}

	const sourceLine = document.lineAt(definition.identityLineNumber).text;
	const sourceMacro = definition.identityMacro || normalizeMacro(macro);
	const character = Math.max(0, sourceLine.toUpperCase().indexOf(sourceMacro.toUpperCase()));
	const range = new vscode.Range(
		definition.identityLineNumber,
		character,
		definition.identityLineNumber,
		character + sourceMacro.length
	);
	return new vscode.Location(document.uri, range);
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

	md.appendMarkdown(`**Source:** ${definition.identityLabel}\n\n`);

	appendTraceHistory(md, document, position.line, hoveredMacro, macroAliases, definition.numericValue);

	md.appendCodeblock(definition.identityLineText.trim(), "gcode");

	return new vscode.Hover(md);
}

function appendTraceHistory(md, document, lineNumber, macro, macroAliases, staticValue) {
	const trace = getExecutionTrace(document);

	if (!trace) {
		appendResolvedValue(md, staticValue, "Trace running");
		return;
	}

	const history = getMacroHistory(trace, lineNumber, macro, macroAliases);

	if (!history) {
		appendResolvedValue(md, staticValue, "No executed value");
		return;
	}

	if (history.count === 1) {
		md.appendMarkdown(`**Resolved:** \`${formatHistory(history)}\`\n\n`);
	} else {
		md.appendMarkdown(`**Trace occurrences:** \`${history.count}\`\n\n`);
		md.appendMarkdown(`**Trace values:** \`${formatHistory(history)}\`\n\n`);
	}
}

function appendResolvedValue(md, value, unavailableReason) {
	if (Number.isFinite(value)) {
		md.appendMarkdown(`**Resolved:** \`${formatMacroNumber(value)}\` (${unavailableReason})\n\n`);
	} else {
		md.appendMarkdown(`**Resolved:** \`${unavailableReason}\`\n\n`);
	}
}

function formatHistory(history) {
	if (Array.isArray(history.values)) {
		return history.values.map(formatMacroNumber).join(", ");
	}

	return `${history.first.map(formatMacroNumber).join(", ")} … ${history.last.map(formatMacroNumber).join(", ")}`;
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

	for (const entry of buildAliasEntries(document)) {
		const normalizedMacro = normalizeMacro(entry.macro);
		const resolvedMacro = resolveMacroAlias(normalizedMacro, macroAliases);
		const lineNumber = entry.sourceLine;
		const lineText = lineNumber >= 0 && lineNumber < document.lineCount
			? document.lineAt(lineNumber).text
			: "";
		const definition = {
			value: "",
			numericValue: NaN,
			name: entry.phrase || entry.comment || entry.alias,
			alias: entry.alias,
			definedLabel: lineNumber >= 0 ? `Line ${lineNumber + 1}` : "Alias comment",
			lineNumber,
			lineText,
			identityLabel: lineNumber >= 0 ? `Line ${lineNumber + 1}` : "Alias comment",
			identityLineText: lineText,
			identityLineNumber: lineNumber,
			identityMacro: normalizedMacro,
			aliasOnly: true
		};

		if (!definitions.has(normalizedMacro)) {
			definitions.set(normalizedMacro, definition);
		}

		if (!definitions.has(resolvedMacro)) {
			definitions.set(resolvedMacro, definition);
		}
	}

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
			const previousDefinition = definitions.get(normalizedMacro) || definitions.get(resolvedMacro);
			const name = previousDefinition && previousDefinition.name
				? previousDefinition.name
				: extractFirstComment(line);
			const blockNumber = extractBlockNumber(line);

			const definedLabel = blockNumber
				? blockNumber
				: `Line ${lineNumber + 1}`;

			const definition = {
				value,
				numericValue,
				name,
				alias: previousDefinition && previousDefinition.alias ? previousDefinition.alias : "",
				definedLabel,
				lineNumber,
				lineText: line,
				identityLabel: previousDefinition && previousDefinition.identityLabel
					? previousDefinition.identityLabel
					: definedLabel,
				identityLineText: previousDefinition && previousDefinition.identityLineText
					? previousDefinition.identityLineText
					: line,
				identityLineNumber: previousDefinition && Number.isInteger(previousDefinition.identityLineNumber)
					? previousDefinition.identityLineNumber
					: lineNumber,
				identityMacro: previousDefinition && previousDefinition.identityMacro
					? previousDefinition.identityMacro
					: normalizedMacro,
				aliasOnly: false
			};

			if (!definitions.has(normalizedMacro) || definitions.get(normalizedMacro).aliasOnly) {
				definitions.set(normalizedMacro, definition);
			}

			if (!definitions.has(resolvedMacro) || definitions.get(resolvedMacro).aliasOnly) {
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
	registerKaijuSenseMacro,
	provideMacroDefinition
};
