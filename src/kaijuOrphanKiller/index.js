// Role: render and run KAIJU Orphan Killer macro definition/reference reports.
// Keep alias command behavior in kaijuAlias/ and Sense macro hovers in
// kaijuSense/macro.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("../MetaTextRanges");
const { buildAliasEntries } = require("../MetaMacroEngine");
const {
	DEFAULT_IGNORED_MACROS,
	getOrphanKillerOptions
} = require("./options");

let orphanPanel;
let orphanState;

function registerOrphanKiller(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.orphanKiller", async () => {
			await runOrphanKiller();
		})
	);
}

async function runOrphanKiller() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before running Orphan Killer.");
		return;
	}

	orphanState = {
		documentUriText: editor.document.uri.toString()
	};

	if (!orphanPanel) {
		orphanPanel = vscode.window.createWebviewPanel(
			"kaijuOrphanKiller",
			"KAIJU Orphan Killer",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		orphanPanel.onDidDispose(() => {
			orphanPanel = undefined;
			orphanState = undefined;
		});

		orphanPanel.webview.onDidReceiveMessage(async message => {
			if (message && message.type === "refresh") {
				await refreshOrphanPanel();
			}
		});
	} else {
		orphanPanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderOrphanPanel(editor.document);
}

async function refreshOrphanPanel() {
	if (!orphanState || !orphanState.documentUriText) {
		return;
	}

	const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(orphanState.documentUriText));
	await renderOrphanPanel(document);
}

async function renderOrphanPanel(document) {
	const options = getOrphanKillerOptions(document);
	const result = inspectOrphanMacros(document, options);

	orphanPanel.title = "KAIJU Orphan Killer";
	orphanPanel.webview.html = renderOrphanHtml(document, result);
	await compactOrphanPanelEditorGroup(document, options);
}

async function compactOrphanPanelEditorGroup(document, options) {
	const compactPanelWidth = options.compactPanelWidth;

	try {
		const layout = await vscode.commands.executeCommand("vscode.getEditorLayout");

		if (!isSimpleSideBySideLayout(layout)) {
			return;
		}

		await vscode.commands.executeCommand("vscode.setEditorLayout", {
			orientation: 0,
			groups: [
				{ size: 1 - compactPanelWidth },
				{ size: compactPanelWidth }
			]
		});
	} catch {
		// Editor layout commands are best-effort; the report still works without resizing.
	}
}

function isSimpleSideBySideLayout(layout) {
	return layout
		&& layout.orientation === 0
		&& Array.isArray(layout.groups)
		&& layout.groups.length === 2
		&& layout.groups.every(group => !Array.isArray(group.groups));
}

function inspectOrphanMacros(document, options = {}) {
	const definitions = new Map();
	const references = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const ignoredMacros = options.ignoredMacros === undefined
		? DEFAULT_IGNORED_MACROS
		: options.ignoredMacros;
	const ignoredMacroRanges = parseMacroIgnoreRanges(ignoredMacros);

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const protectedRanges = [
			...getCommentRanges(line),
			...getAngleBracketRanges(line)
		];
		const assignmentRanges = findAssignmentRanges(line, protectedRanges);

		for (const assignment of assignmentRanges) {
			const macro = resolveMacroAlias(assignment.macro, macroAliases);

			if (!isMacroIgnored(macro, ignoredMacroRanges)) {
				addLine(definitions, macro, lineNumber);
			}
		}

		for (const reference of findMacroReferences(line, protectedRanges, assignmentRanges)) {
			const macro = resolveMacroAlias(reference.macro, macroAliases);

			if (!isMacroIgnored(macro, ignoredMacroRanges)) {
				addLine(references, macro, lineNumber);
			}
		}
	}

	return {
		undefinedUses: [...references.keys()]
			.filter(macro => !definitions.has(macro))
			.sort(compareMacroNames)
			.map(macro => makeResultItem(macro, references.get(macro), macroAliases)),
		unusedDefinitions: [...definitions.keys()]
			.filter(macro => !references.has(macro))
			.sort(compareMacroNames)
			.map(macro => makeResultItem(macro, definitions.get(macro), macroAliases))
	};
}

function buildMacroAliasMap(document) {
	const macroAliases = new Map();

	for (const entry of buildAliasEntries(document)) {
		if (!entry.alias) {
			continue;
		}

		const numericMacro = normalizeMacro(entry.macro);
		const aliasMacro = normalizeMacro(`#${entry.alias}`);
		const aliasInfo = {
			macro: numericMacro,
			alias: aliasMacro,
			name: entry.phrase || entry.alias
		};

		macroAliases.set(aliasMacro, aliasInfo);
		macroAliases.set(numericMacro, aliasInfo);
	}

	return macroAliases;
}

function resolveMacroAlias(macro, macroAliases) {
	const normalizedMacro = normalizeMacro(macro);
	const aliasInfo = macroAliases.get(normalizedMacro);

	return aliasInfo ? aliasInfo.macro : normalizedMacro;
}

function makeResultItem(macro, lines, macroAliases) {
	const aliasInfo = macroAliases.get(macro);

	return {
		macro,
		name: aliasInfo ? aliasInfo.name : "",
		lines
	};
}

function parseMacroIgnoreRanges(value) {
	if (typeof value !== "string") {
		return [];
	}

	return value
		.split(",")
		.map(part => parseMacroIgnoreRange(part.trim()))
		.filter(Boolean);
}

function parseMacroIgnoreRange(part) {
	if (!part) {
		return undefined;
	}

	const match = part.match(/^#?\s*(\d+)?\s*(?:-\s*#?\s*(\d+)?)?$/);

	if (!match) {
		return undefined;
	}

	const hasDash = part.includes("-");
	const start = match[1] === undefined ? undefined : Number(match[1]);
	const end = match[2] === undefined ? undefined : Number(match[2]);

	if (start === undefined && end === undefined) {
		return undefined;
	}

	if (!hasDash && start !== undefined) {
		return { start, end: start };
	}

	const rangeStart = start === undefined ? 0 : start;
	const rangeEnd = end === undefined ? Number.POSITIVE_INFINITY : end;

	if (rangeStart > rangeEnd) {
		return { start: rangeEnd, end: rangeStart };
	}

	return { start: rangeStart, end: rangeEnd };
}

function isMacroIgnored(macro, ignoredMacroRanges) {
	const number = getNumericMacroNumber(macro);

	if (number === undefined) {
		return false;
	}

	return ignoredMacroRanges.some(range => number >= range.start && number <= range.end);
}

function getNumericMacroNumber(macro) {
	const match = normalizeMacro(macro).match(/^#(\d+)$/);

	return match ? Number(match[1]) : undefined;
}

function findAssignmentRanges(line, protectedRanges) {
	const assignments = [];
	const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g;
	let match;

	while ((match = assignmentRegex.exec(line)) !== null) {
		if (isInsideRange(match.index, protectedRanges)) {
			continue;
		}

		assignments.push({
			macro: normalizeMacro(match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0]),
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return assignments;
}

function findMacroReferences(line, protectedRanges, assignmentRanges) {
	const references = [];
	const macroRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g;
	let match;

	while ((match = macroRegex.exec(line)) !== null) {
		if (isInsideRange(match.index, protectedRanges)) {
			continue;
		}

		if (isInsideAssignmentTarget(match.index, assignmentRanges)) {
			continue;
		}

		references.push({
			macro: normalizeMacro(match[0]),
			start: match.index
		});
	}

	return references;
}

function isInsideAssignmentTarget(index, assignmentRanges) {
	return assignmentRanges.some(range => index >= range.start && index < range.end);
}

function addLine(map, macro, lineNumber) {
	if (!map.has(macro)) {
		map.set(macro, []);
	}

	const lines = map.get(macro);

	if (lines[lines.length - 1] !== lineNumber + 1) {
		lines.push(lineNumber + 1);
	}
}

function normalizeMacro(macro) {
	return macro.toUpperCase();
}

function renderOrphanHtml(document, result) {
	const undefinedRows = renderRows(result.undefinedUses);
	const unusedRows = renderRows(result.unusedDefinitions);
	const totalCount = result.undefinedUses.length + result.unusedDefinitions.length;
	const summary = totalCount === 0
		? "No orphan macros found."
		: `${result.undefinedUses.length} undefined used, ${result.unusedDefinitions.length} defined but unused.`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 16px;
		}

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			padding-bottom: 12px;
			margin-bottom: 16px;
		}

		h1 {
			font-size: 18px;
			margin: 0;
		}

		h2 {
			font-size: 13px;
			text-transform: uppercase;
			color: var(--vscode-descriptionForeground);
			margin: 18px 0 8px;
		}

		button {
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			border: 0;
			border-radius: 4px;
			padding: 6px 10px;
			cursor: pointer;
		}

		button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.meta,
		.empty {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			margin-top: 4px;
		}

		.table {
			display: inline-grid;
			grid-template-columns: max-content minmax(12ch, 36ch) max-content;
			max-width: 100%;
		}

		.row {
			display: contents;
		}

		.cell {
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 7px 12px 7px 0;
			overflow-wrap: anywhere;
		}

		.cell:last-child {
			padding-right: 0;
			white-space: nowrap;
		}

		.row.header {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}

		.row.header .cell {
			padding-top: 0;
		}

		code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 1px 4px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<header>
		<div>
			<h1>KAIJU Orphan Killer</h1>
			<div class="meta">${escapeHtml(summary)}</div>
			<div class="meta">${escapeHtml(document.fileName || document.uri.toString())}</div>
		</div>
		<button id="refresh">Refresh</button>
	</header>

	<section>
		<h2>Used But Not Defined</h2>
		${undefinedRows}
	</section>

	<section>
		<h2>Defined But Not Used</h2>
		${unusedRows}
	</section>

	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById("refresh").addEventListener("click", () => {
			vscode.postMessage({ type: "refresh" });
		});
	</script>
</body>
</html>`;
}

function renderRows(items) {
	if (!items.length) {
		return "<p class=\"empty\">None found.</p>";
	}

	const header = `<div class="table">
		<div class="row header">
			<div class="cell">Macro</div>
			<div class="cell">Name</div>
			<div class="cell">Lines</div>
		</div>`;
	const rows = items.map(item => {
		return `<div class="row">
			<div class="cell"><code>${escapeHtml(item.macro)}</code></div>
			<div class="cell">${escapeHtml(item.name || "-")}</div>
			<div class="cell">${escapeHtml(item.lines.join(", "))}</div>
		</div>`;
	}).join("");

	return header + rows + "</div>";
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function compareMacroNames(left, right) {
	const leftNumber = Number(left.slice(1));
	const rightNumber = Number(right.slice(1));

	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
		return leftNumber - rightNumber;
	}

	return left.localeCompare(right);
}

module.exports = {
	registerOrphanKiller,
	inspectOrphanMacros
};
