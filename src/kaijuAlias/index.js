// Role: implement KAIJU Alias commands and editor toggling. Keep shared macro
// alias parsing and expression evaluation in MetaMacroEngine.js.
const vscode = require("vscode");
const { buildAliasEntries, makeMacroRegex } = require("../MetaMacroEngine");
const { getAliasOptions } = require("./options");

function registerKaijuAlias(context) {
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

function countMatches(text, regex) {
	regex.lastIndex = 0;
	return [...text.matchAll(regex)].length;
}

module.exports = {
	registerKaijuAlias,
	toggleAliases
};
