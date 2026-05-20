const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("./textRanges");

function registerMacroAlias(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.aliasMacros", async () => {
			await runMacroAliasCommand();
		})
	);
}

async function runMacroAliasCommand() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before using aliases.");
		return;
	}

	const entries = buildAliasEntries(editor.document);
	const aliasedEntries = entries.filter(entry => entry.alias);

	if (!entries.length) {
		vscode.window.showInformationMessage("KAIJU.NC: No macro variables found before the first G/M block.");
		return;
	}

	if (!aliasedEntries.length) {
		vscode.window.showWarningMessage("KAIJU.NC: No alias comments found before the first G/M block.");
		return;
	}

	await toggleAliases(editor, aliasedEntries, getAliasOptions(editor.document));
}

function getAliasOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.alias", document.uri);

	return {
		caseSensitive: config.get("caseSensitive", false)
	};
}

function buildAliasEntries(document) {
	const aliases = new Map();
	const macros = new Set();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;

		if (hasExecutableGMCode(line)) {
			break;
		}

		for (const macro of collectNumericMacros(line)) {
			macros.add(macro);
		}

		for (const candidate of findAliasCandidatesInLine(line, lineNumber)) {
			if (!aliases.has(candidate.macro)) {
				aliases.set(candidate.macro, candidate);
			}
		}
	}

	return [...macros]
		.sort(compareMacroNames)
		.map(macro => {
			const alias = aliases.get(macro);

			return {
				macro,
				alias: alias ? alias.alias : "",
				phrase: alias ? alias.phrase : "",
				sourceLine: alias ? alias.lineNumber : -1
			};
		});
}

function collectNumericMacros(text) {
	const macros = new Set();
	const macroRegex = /#\d+/g;
	let match;

	while ((match = macroRegex.exec(text)) !== null) {
		macros.add(match[0]);
	}

	return macros;
}

function hasExecutableGMCode(line) {
	const searchableLine = maskProtectedRanges(line);

	return /(^|[^A-Za-z0-9_])[GgMm]\d+/.test(searchableLine);
}

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of protectedRanges) {
		for (let i = range.start; i <= range.end; i++) {
			characters[i] = " ";
		}
	}

	return characters.join("");
}

function findAliasCandidatesInLine(line, lineNumber) {
	const candidates = [];
	const commentRanges = getCommentRanges(line);

	for (const range of commentRanges) {
		const commentText = line.slice(range.start + 1, range.end);
		const commentCandidate = makeCommentAliasCandidate(commentText, lineNumber);

		if (commentCandidate) {
			candidates.push(commentCandidate);
			continue;
		}

		const inlineCandidate = makeInlineAssignmentAliasCandidate(line, range, lineNumber);

		if (inlineCandidate) {
			candidates.push(inlineCandidate);
		}
	}

	return candidates;
}

function makeCommentAliasCandidate(commentText, lineNumber) {
	const match = commentText.match(/^\s*(#\d+)\s*(?:=\s*)?(.+)$/);

	if (!match) {
		return undefined;
	}

	return makeAliasCandidate(match[1], match[2], lineNumber);
}

function makeInlineAssignmentAliasCandidate(line, commentRange, lineNumber) {
	const codeBeforeComment = line.slice(0, commentRange.start);
	const assignments = [...codeBeforeComment.matchAll(/#\d+\s*=/g)];

	if (!assignments.length) {
		return undefined;
	}

	const macro = assignments[assignments.length - 1][0].match(/#\d+/)[0];
	const commentText = line.slice(commentRange.start + 1, commentRange.end);

	return makeAliasCandidate(macro, commentText, lineNumber);
}

function makeAliasCandidate(macro, phrase, lineNumber) {
	const alias = makeAliasName(phrase);

	if (!alias) {
		return undefined;
	}

	return {
		macro,
		alias,
		phrase: cleanAliasPhrase(phrase),
		lineNumber
	};
}

function makeAliasName(phrase) {
	const cleanedPhrase = cleanAliasPhrase(phrase);

	if (!cleanedPhrase) {
		return "";
	}

	const alias = cleanedPhrase
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");

	if (!alias) {
		return "";
	}

	return /^[a-z_]/.test(alias) ? alias : `var_${alias}`;
}

function cleanAliasPhrase(phrase) {
	return phrase
		.split("[")[0]
		.replace(/\s+/g, " ")
		.trim();
}

async function toggleAliases(editor, entries, options = {}) {
	const aliasOptions = {
		caseSensitive: false,
		...options
	};
	const shouldConvertToNumbers = documentHasAliases(editor.document, entries, aliasOptions);
	const replacements = entries.map(entry => {
		const aliasMacro = `#${entry.alias}`;

		return shouldConvertToNumbers
			? { from: aliasMacro, to: entry.macro }
			: { from: entry.macro, to: aliasMacro };
	});
	const changed = await replaceAliases(editor, replacements, entries, aliasOptions);

	if (!changed) {
		const direction = shouldConvertToNumbers ? "aliases" : "numeric macros";
		vscode.window.showInformationMessage(`KAIJU.NC: No ${direction} found to toggle.`);
		return;
	}

	vscode.window.showInformationMessage(
		shouldConvertToNumbers
			? "KAIJU.NC: Toggled aliases back to numbers."
			: "KAIJU.NC: Toggled numbers to aliases."
	);
}

function documentHasAliases(document, entries, options) {
	for (const entry of entries) {
		const aliasRegex = makeMacroRegex(`#${entry.alias}`, options);

		for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
			if (lineNumber === entry.sourceLine) {
				continue;
			}

			if (countMatches(document.lineAt(lineNumber).text, aliasRegex) > 0) {
				return true;
			}
		}
	}

	return false;
}

async function replaceAliases(editor, replacements, entries, options) {
	const document = editor.document;
	const sourceMacrosByLine = buildSourceMacrosByLine(entries);
	const nextLines = [];
	let changed = false;

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		let line = document.lineAt(lineNumber).text;
		const protectedLine = protectSourceMacros(line, sourceMacrosByLine.get(lineNumber) || [], options);

		for (const replacement of replacements) {
			const replaceRegex = makeMacroRegex(replacement.from, options);
			const replacedLine = protectedLine.text.replace(replaceRegex, replacement.to);

			if (replacedLine !== protectedLine.text) {
				changed = true;
				protectedLine.text = replacedLine;
			}
		}

		nextLines.push(restoreSourceMacros(protectedLine.text, protectedLine.tokens));
	}

	if (!changed) {
		return false;
	}

	const originalText = document.getText();
	const newline = originalText.includes("\r\n") ? "\r\n" : "\n";
	const fullRange = new vscode.Range(
		document.positionAt(0),
		document.positionAt(originalText.length)
	);

	await editor.edit(editBuilder => {
		editBuilder.replace(fullRange, nextLines.join(newline));
	});

	return true;
}

function buildSourceMacrosByLine(entries) {
	const sourceMacrosByLine = new Map();

	for (const entry of entries) {
		if (entry.sourceLine === -1) {
			continue;
		}

		const macros = sourceMacrosByLine.get(entry.sourceLine) || [];
		macros.push(entry.macro);
		sourceMacrosByLine.set(entry.sourceLine, macros);
	}

	return sourceMacrosByLine;
}

function protectSourceMacros(line, macros, options) {
	const tokens = [];
	let text = line;

	for (const macro of macros) {
		const token = `__KAIJU_ALIAS_SOURCE_${tokens.length}__`;
		const protectedText = text.replace(makeMacroRegex(macro, options), token);

		if (protectedText !== text) {
			tokens.push({ token, macro });
			text = protectedText;
		}
	}

	return { text, tokens };
}

function restoreSourceMacros(text, tokens) {
	return tokens.reduce((result, item) => {
		return result.replace(item.token, item.macro);
	}, text);
}

function makeMacroRegex(macro, options = {}) {
	const flags = options.caseSensitive ? "g" : "gi";

	return new RegExp(`${escapeRegex(macro)}(?![A-Za-z0-9_])`, flags);
}

function countMatches(text, regex) {
	regex.lastIndex = 0;
	return [...text.matchAll(regex)].length;
}

function compareMacroNames(left, right) {
	return Number(left.slice(1)) - Number(right.slice(1));
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
	registerMacroAlias,
	buildAliasEntries,
	toggleAliases
};
