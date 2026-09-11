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
let orphanContext;
let liveRefreshTimer;

function registerOrphanKiller(context) {
	orphanContext = context;
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.orphanKiller", async () => {
			await runOrphanKiller();
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (!orphanState || !orphanState.live || !event.document || event.document.uri.toString() !== orphanState.documentUriText) {
				return;
			}
			scheduleLiveOrphanRefresh();
		}),
		{
			dispose() {
				clearTimeout(liveRefreshTimer);
			}
		}
	);
}

async function runOrphanKiller() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before running Orphan Killer.");
		return;
	}

	orphanState = makeOrphanState(editor.document);

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
			} else if (message && message.type === "setLive") {
				if (!orphanState || !orphanState.documentUriText) return;
				const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(orphanState.documentUriText));
				await setOrphanLive(document, message.live === true);
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

function scheduleLiveOrphanRefresh() {
	clearTimeout(liveRefreshTimer);
	liveRefreshTimer = setTimeout(() => {
		void refreshOrphanPanel();
	}, 180);
}

function makeOrphanState(document) {
	return {
		documentUriText: document.uri.toString(),
		live: getOrphanSettings(document).live === true
	};
}

function getOrphanSettings(document) {
	const all = orphanContext && orphanContext.workspaceState
		? orphanContext.workspaceState.get("kaijuOrphanKiller.settingsByDocument", {})
		: {};
	return Object.assign({}, all[document.uri.toString()] || {});
}

async function setOrphanLive(document, live) {
	if (!orphanContext || !orphanContext.workspaceState) return;
	const all = Object.assign({}, orphanContext.workspaceState.get("kaijuOrphanKiller.settingsByDocument", {}));
	all[document.uri.toString()] = Object.assign({}, all[document.uri.toString()] || {}, { live });
	await orphanContext.workspaceState.update("kaijuOrphanKiller.settingsByDocument", all);
	if (orphanState && orphanState.documentUriText === document.uri.toString()) {
		orphanState.live = live;
	}
}

async function renderOrphanPanel(document) {
	const options = getOrphanKillerOptions(document);
	const result = inspectOrphanMacros(document, options);

	orphanPanel.title = "KAIJU Orphan Killer";
	orphanPanel.webview.html = renderOrphanHtml(document, result, orphanState && orphanState.live === true);
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

function renderOrphanHtml(document, result, live) {
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
		:root { color-scheme: dark; --bg: var(--vscode-editor-background, #1e1e1e); --fg: var(--vscode-editor-foreground, #d4d4d4); --muted: var(--vscode-descriptionForeground, #9ca3af); --border: var(--vscode-panel-border, #3c3c3c); --surface: var(--vscode-sideBar-background, #252526); }
		body { margin: 0; padding: 14px; background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family, Segoe UI, sans-serif); font-size: var(--vscode-font-size, 13px); }
		header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
		h1 { font-size: 15px; font-weight: 650; margin: 0; }
		.summary, .empty { color: var(--muted); font-size: 12px; }
		.toolbar { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
		button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-background); border-radius: 3px; padding: 4px 8px; font: inherit; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		.checkbox { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; cursor: pointer; }
		.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(105px, 1fr)); gap: 8px; margin-bottom: 14px; }
		.summary-card { border: 1px solid var(--border); border-radius: 5px; background: var(--surface); padding: 8px 10px; }
		.summary-card .value { font-size: 18px; font-weight: 650; line-height: 1.15; }
		.summary-card .label { color: var(--muted); font-size: 11px; margin-top: 3px; text-transform: uppercase; letter-spacing: .04em; }
		.report-section { border: 1px solid var(--border); border-radius: 5px; overflow: hidden; margin-top: 10px; }
		h2 { font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: .04em; margin: 0; padding: 8px 10px; border-bottom: 1px solid var(--border); }
		.section-body { padding: 0 10px 8px; }
		.table { display: inline-grid; grid-template-columns: max-content minmax(12ch, 36ch) max-content; max-width: 100%; }

		.row {
			display: contents;
		}

		.cell {
			border-bottom: 1px solid var(--border);
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
		</div>
		<div class="toolbar"><label class="checkbox" title="Refresh this report automatically after edits to this program."><input id="live" type="checkbox"${live ? " checked" : ""}> Live</label><button id="refresh">Refresh</button></div>
	</header>
	<div class="summary-grid">
		<div class="summary-card"><div class="value">${result.undefinedUses.length}</div><div class="label">Undefined uses</div></div>
		<div class="summary-card"><div class="value">${result.unusedDefinitions.length}</div><div class="label">Unused definitions</div></div>
		<div class="summary-card"><div class="value">${totalCount}</div><div class="label">Total findings</div></div>
	</div>
	<div class="summary">${escapeHtml(summary)}</div>
	<section class="report-section">
		<h2>Used but not defined</h2>
		<div class="section-body">${undefinedRows}</div>
	</section>
	<section class="report-section">
		<h2>Defined but not used</h2>
		<div class="section-body">${unusedRows}</div>
	</section>

	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById("refresh").addEventListener("click", () => {
			vscode.postMessage({ type: "refresh" });
		});
		document.getElementById("live").addEventListener("change", event => {
			vscode.postMessage({ type: "setLive", live: event.target.checked });
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
