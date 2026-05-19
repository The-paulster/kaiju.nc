const vscode = require("vscode");
const {
	getCommentRanges,
	isInsideRange
} = require("./textRanges");

function registerMacroHover(context) {
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

	const macroDefinitions = buildMacroDefinitionTable(document);
	const definition = macroDefinitions.get(hoveredMacro);

	if (!definition) {
		const md = new vscode.MarkdownString([
			`**${hoveredMacro}**`,
			"",
			"`No definition found above or in document.`"
		].join("\n"));

		return new vscode.Hover(md);
	}

	const md = new vscode.MarkdownString();

	md.appendMarkdown(`**${hoveredMacro}**\n\n`);

	if (definition.value) {
		md.appendMarkdown(`**Value:** \`${definition.value}\`\n\n`);
	} else {
		md.appendMarkdown("**Value:** `No value found`\n\n");
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

function buildMacroDefinitionTable(document) {
	const definitions = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const commentRanges = getCommentRanges(line);
		const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g;

		let match;
		while ((match = assignmentRegex.exec(line)) !== null) {
			const macro = match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0];

			if (definitions.has(macro)) {
				continue;
			}

			if (isInsideRange(match.index, commentRanges)) {
				continue;
			}

			const valueStart = match.index + match[0].length;
			const value = extractValueAfterEquals(line, valueStart);
			const comment = extractFirstComment(line);
			const blockNumber = extractBlockNumber(line);

			const definedLabel = blockNumber
				? blockNumber
				: `Line ${lineNumber + 1}`;

			definitions.set(macro, {
				value,
				comment,
				definedLabel,
				lineNumber,
				lineText: line
			});
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
	registerMacroHover
};
