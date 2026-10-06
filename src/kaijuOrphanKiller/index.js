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
let orphanHighlight;
let reportSerial = 0;

function registerOrphanKiller(context) {
	orphanContext = context;
	orphanHighlight = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
		border: "1px solid",
		borderColor: new vscode.ThemeColor("editor.findMatchBorder")
	});
	context.subscriptions.push(
		orphanHighlight,
		vscode.commands.registerCommand("kaijuNC.orphanKiller", async () => {
			await runOrphanKiller();
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (!orphanState || !event.document || event.document.uri.toString() !== orphanState.documentUriText || !event.contentChanges.length) {
				return;
			}
			orphanState.stale = true;
			updateOrphanHighlights();
			postOrphanNavigation();
			if (orphanState.live) scheduleLiveOrphanRefresh();
		}),
		vscode.window.onDidChangeVisibleTextEditors(() => updateOrphanHighlights()),
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
	orphanState.sourceColumn = editor.viewColumn;
	updateOrphanHighlights();

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
			clearTimeout(liveRefreshTimer);
			orphanPanel = undefined;
			orphanState = undefined;
			updateOrphanHighlights();
		});

		let navigationQueue = Promise.resolve();
		orphanPanel.webview.onDidReceiveMessage(async message => {
			if (message && message.type === "refresh") {
				await refreshOrphanPanel();
			} else if (message && message.type === "setLive") {
				if (!orphanState || !orphanState.documentUriText) return;
				const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(orphanState.documentUriText));
				await setOrphanLive(document, message.live === true);
			} else if (message && message.type === "navigate") {
				navigationQueue = navigationQueue.then(() => navigateOrphan(message)).catch(() => {
					vscode.window.showWarningMessage("Could not reveal the orphan macro. Refresh the report and try again.");
				});
				await navigationQueue;
			}
		});
	} else {
		orphanPanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderOrphanPanel(editor.document);
}

async function refreshOrphanPanel() {
	const state = orphanState;
	if (!state || !state.documentUriText) {
		return;
	}

	const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.documentUriText));
	if (state !== orphanState || !orphanPanel) return;
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
		live: getOrphanSettings(document).live === true,
		occurrences: [], activeIndex: -1, stale: false
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
	const previous = orphanState.occurrences[orphanState.activeIndex];
	orphanState.occurrences = [...result.undefinedUses, ...result.unusedDefinitions]
		.flatMap(item => item.occurrences.map(occurrence => ({ ...occurrence, macro: item.macro })))
		.sort((a, b) => a.line - b.line || a.start - b.start);
	orphanState.activeIndex = previous
		? orphanState.occurrences.findIndex(item => item.macro === previous.macro && item.line === previous.line && item.start === previous.start)
		: -1;
	if (previous && orphanState.activeIndex < 0) {
		orphanState.activeIndex = orphanState.occurrences.findIndex(item => item.macro === previous.macro);
	}
	orphanState.documentVersion = document.version;
	orphanState.stale = false;
	orphanState.reportId = ++reportSerial;

	orphanPanel.title = "KAIJU Orphan Killer";
	orphanPanel.webview.html = renderOrphanHtml(document, result, orphanState.live, orphanState);
	updateOrphanHighlights();
	await compactOrphanPanelEditorGroup(document, options);
}

function getActiveOrphanRange() {
	const occurrence = orphanState && !orphanState.stale && orphanState.occurrences[orphanState.activeIndex];
	return occurrence ? new vscode.Range(occurrence.line, occurrence.start, occurrence.line, occurrence.end) : undefined;
}

function updateOrphanHighlights() {
	const range = getActiveOrphanRange();
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(orphanHighlight, range && editor.document.uri.toString() === orphanState.documentUriText ? [range] : []);
	}
}

function getOrphanNavigation(state) {
	const occurrences = state.occurrences || [];
	const index = state.activeIndex === undefined ? -1 : state.activeIndex;
	const occurrence = occurrences[index];
	return {
		type: "navigation", reportId: state.reportId,
		index, total: occurrences.length,
		macro: occurrence ? occurrence.macro : "", line: occurrence ? occurrence.line + 1 : undefined,
		stale: state.stale === true
	};
}

function postOrphanNavigation() {
	if (!orphanPanel || !orphanState) return;
	void orphanPanel.webview.postMessage(getOrphanNavigation(orphanState));
}

async function navigateOrphan(message) {
	const state = orphanState;
	if (!state || state.stale || message.reportId !== state.reportId || !state.occurrences.length) return;
	const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.documentUriText));
	if (state !== orphanState || message.reportId !== state.reportId || state.stale) return;
	if (document.version !== state.documentVersion) {
		state.stale = true;
		updateOrphanHighlights();
		postOrphanNavigation();
		return;
	}
	let index;
	if (message.direction === 1 || message.direction === -1) {
		index = state.activeIndex < 0
			? (message.direction === 1 ? 0 : state.occurrences.length - 1)
			: (state.activeIndex + message.direction + state.occurrences.length) % state.occurrences.length;
	} else if (typeof message.macro === "string") {
		index = state.occurrences.findIndex(item => item.macro === message.macro && (message.line === undefined || item.line + 1 === message.line));
	} else return;
	if (index < 0) return;
	const visible = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === state.documentUriText);
	const editor = visible || await vscode.window.showTextDocument(document, { viewColumn: state.sourceColumn || vscode.ViewColumn.One, preserveFocus: true });
	if (state !== orphanState || message.reportId !== state.reportId || state.stale || document.version !== state.documentVersion) return;
	state.activeIndex = index;
	const range = getActiveOrphanRange();
	editor.selection = new vscode.Selection(range.start, range.end);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	updateOrphanHighlights();
	postOrphanNavigation();
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
				addOccurrence(definitions, macro, lineNumber, assignment);
			}
		}

		for (const reference of findMacroReferences(line, protectedRanges, assignmentRanges)) {
			const macro = resolveMacroAlias(reference.macro, macroAliases);

			if (!isMacroIgnored(macro, ignoredMacroRanges)) {
				addOccurrence(references, macro, lineNumber, reference);
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

function makeResultItem(macro, occurrences, macroAliases) {
	const aliasInfo = macroAliases.get(macro);

	return {
		macro,
		name: aliasInfo ? aliasInfo.name : "",
		lines: [...new Set(occurrences.map(item => item.line + 1))],
		occurrences
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

		const token = match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0];
		assignments.push({
			macro: normalizeMacro(token),
			start: match.index,
			tokenEnd: match.index + token.length,
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
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return references;
}

function isInsideAssignmentTarget(index, assignmentRanges) {
	return assignmentRanges.some(range => index >= range.start && index < range.end);
}

function addOccurrence(map, macro, lineNumber, token) {
	if (!map.has(macro)) {
		map.set(macro, []);
	}

	map.get(macro).push({ line: lineNumber, start: token.start, end: token.tokenEnd === undefined ? token.end : token.tokenEnd });
}

function normalizeMacro(macro) {
	return macro.toUpperCase();
}

function renderOrphanHtml(document, result, live, navigation = {}) {
	const nonce = makeWebviewNonce();
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
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		:root { color-scheme: dark; --bg: var(--vscode-editor-background, #1e1e1e); --fg: var(--vscode-editor-foreground, #d4d4d4); --muted: var(--vscode-descriptionForeground, #9ca3af); --border: var(--vscode-panel-border, #3c3c3c); --surface: var(--vscode-sideBar-background, #252526); }
		body { margin: 0; padding: 14px; background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family, Segoe UI, sans-serif); font-size: var(--vscode-font-size, 13px); }
		header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
		h1 { font-size: 15px; font-weight: 650; margin: 0; }
		.summary, .empty { color: var(--muted); font-size: 12px; }
		.toolbar { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
		button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-background); border-radius: 3px; padding: 4px 8px; font: inherit; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button:disabled { opacity: .5; cursor: default; }
		button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
		.navigation { position: sticky; top: 0; z-index: 1; background: var(--bg); display: flex; align-items: center; gap: 6px; margin: 10px 0; padding: 6px 0; flex-wrap: wrap; }
		#position { color: var(--muted); font-size: 12px; }
		.row.active .cell { background: var(--vscode-editor-findMatchHighlightBackground, #ffffff18); }
		.row.active code { outline: 1px solid var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder)); }
		button.finding, button.line-link { background: transparent; border: 0; padding: 0; color: var(--vscode-textLink-foreground); }
		button.finding { color: inherit; }
		button.line-link.active { text-decoration: underline; font-weight: 700; }
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
	<div class="navigation" aria-label="Orphan navigation">
		<button id="previous" title="Previous occurrence (Shift+Enter)">Previous</button>
		<button id="next" title="Next occurrence (Enter)">Next</button>
		<span id="position" role="status" aria-live="polite"></span>
	</div>
	<section class="report-section">
		<h2>Used but not defined</h2>
		<div class="section-body">${undefinedRows}</div>
	</section>
	<section class="report-section">
		<h2>Defined but not used</h2>
		<div class="section-body">${unusedRows}</div>
	</section>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const reportId = ${JSON.stringify(navigation.reportId || 0)};
		let stale = false;
		function updateNavigation(state) {
			stale = state.stale === true;
			document.getElementById("previous").disabled = stale || state.total === 0;
			document.getElementById("next").disabled = stale || state.total === 0;
			document.getElementById("position").textContent = stale ? "Source changed — Refresh to navigate" : (state.index + 1) + " of " + state.total;
			let activeButton;
			for (const row of document.querySelectorAll(".row[data-macro]")) {
				const active = !stale && row.dataset.macro === state.macro;
				row.classList.toggle("active", active);
				const button = row.querySelector(".finding");
				button.setAttribute("aria-pressed", String(active));
				button.disabled = stale;
				if (active) activeButton = button;
				for (const link of row.querySelectorAll(".line-link")) {
					link.disabled = stale;
					link.classList.toggle("active", active && Number(link.dataset.line) === state.line);
				}
			}
			if (activeButton) activeButton.scrollIntoView({ block: "nearest" });
		}
		function navigate(fields) {
			if (!stale) vscode.postMessage({ type: "navigate", reportId, ...fields });
		}
		document.getElementById("previous").addEventListener("click", () => navigate({ direction: -1 }));
		document.getElementById("next").addEventListener("click", () => navigate({ direction: 1 }));
		for (const row of document.querySelectorAll(".row[data-macro]")) {
			row.querySelector(".finding").addEventListener("click", () => navigate({ macro: row.dataset.macro }));
			for (const link of row.querySelectorAll(".line-link")) {
				link.addEventListener("click", () => navigate({ macro: row.dataset.macro, line: Number(link.dataset.line) }));
			}
		}
		document.addEventListener("keydown", event => {
			if (event.key !== "Enter" || event.ctrlKey || event.altKey || event.metaKey) return;
			if (event.target.closest("input, a, #refresh, .line-link")) return;
			event.preventDefault();
			navigate({ direction: event.shiftKey || event.target.id === "previous" ? -1 : 1 });
		});
		window.addEventListener("message", event => {
			if (event.data.type === "navigation" && event.data.reportId === reportId) updateNavigation(event.data);
		});
		updateNavigation(${JSON.stringify(getOrphanNavigation(navigation))});
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

function makeWebviewNonce() {
	let nonce = "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let index = 0; index < 32; index++) nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	return nonce;
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
		return `<div class="row" data-macro="${escapeHtml(item.macro)}">
			<div class="cell"><button class="finding" aria-pressed="false" title="Reveal first occurrence"><code>${escapeHtml(item.macro)}</code></button></div>
			<div class="cell">${escapeHtml(item.name || "-")}</div>
			<div class="cell">${item.lines.map(line => `<button class="line-link" data-line="${line}" title="Reveal occurrence on line ${line}">${line}</button>`).join(", ")}</div>
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
	getOrphanSettingsSnapshot: document => ({ saved: getOrphanSettings(document), effective: { ...getOrphanKillerOptions(document), live: getOrphanSettings(document).live === true } }),
	inspectOrphanMacros
};
