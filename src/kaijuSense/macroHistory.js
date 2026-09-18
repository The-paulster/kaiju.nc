// Role: present an on-demand, cursor-following macro execution history. Trace
// execution remains in MetaExecutionTrace; this module only reconstructs its
// already-recorded macro deltas for a Sense sidebar.
const vscode = require("vscode");
const { buildAliasEntries } = require("../MetaMacroEngine");
const { buildExecutionTrace } = require("../MetaExecutionTrace");

const VIEW_ID = "kaijuNC.macroHistory";
const COMMAND_ID = "kaijuNC.macroHistory";
const CHECKPOINT_INTERVAL = 200;
const refreshDelayMs = 75;

function registerKaijuSenseMacroHistory(context) {
	const provider = new MacroHistoryViewProvider();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand(COMMAND_ID, async () => {
			await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
			provider.refresh();
		}),
		vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (event.textEditor === vscode.window.activeTextEditor) provider.refresh();
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === getActiveGCodeDocument() || provider.isPinnedTo(event.document)) provider.refresh();
		}),
		vscode.workspace.onDidCloseTextDocument(document => provider.clearPinnedDocument(document))
	);
}

class MacroHistoryViewProvider {
	constructor() {
		this.view = undefined;
		this.pinned = undefined;
		this.refreshTimer = undefined;
		this.snapshots = new Map();
	}

	resolveWebviewView(view) {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = renderMacroHistoryHtml();
		view.webview.onDidReceiveMessage(message => this.handleMessage(message));
		view.onDidChangeVisibility(() => this.refresh());
		this.refresh();
	}

	isPinnedTo(document) {
		return Boolean(this.pinned && document && this.pinned.documentUri === document.uri.toString());
	}

	clearPinnedDocument(document) {
		if (this.isPinnedTo(document)) this.pinned = undefined;
		this.snapshots.delete(document.uri.toString());
		this.refresh();
	}

	refresh() {
		if (!this.view || !this.view.visible) return;
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.sendCurrentState(), refreshDelayMs);
	}

	handleMessage(message) {
		if (!message || message.type !== "setPinned") return;
		if (message.pinned) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === "gcode") {
				this.pinned = { document: editor.document, documentUri: editor.document.uri.toString(), lineNumber: editor.selection.active.line };
			}
		} else {
			this.pinned = undefined;
		}
		this.sendCurrentState();
	}

	sendCurrentState() {
		if (!this.view || !this.view.visible) return;
		const target = this.pinned ? getPinnedTarget(this.pinned) : getActiveTarget();
		if (!target) {
			this.view.webview.postMessage({ type: "state", pinned: Boolean(this.pinned), unavailable: "Open a G-code program to use Macro Hunter." });
			return;
		}
		const payload = this.getPayload(target.document, target.lineNumber);
		this.view.webview.postMessage(Object.assign({ type: "state", pinned: Boolean(this.pinned) }, payload));
	}

	getPayload(document, lineNumber) {
		const key = document.uri.toString();
		let snapshot = this.snapshots.get(key);
		if (!snapshot || snapshot.version !== document.version) {
			snapshot = Object.assign({ version: document.version }, buildMacroHistoryPayload(document, lineNumber));
			this.snapshots.set(key, snapshot);
		}
		return Object.assign({}, snapshot, { lineNumber });
	}
}

function getActiveGCodeDocument() {
	const editor = vscode.window.activeTextEditor;
	return editor && editor.document.languageId === "gcode" ? editor.document : undefined;
}

function getActiveTarget() {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== "gcode") return undefined;
	return { document: editor.document, lineNumber: editor.selection.active.line };
}

function getPinnedTarget(pinned) {
	return pinned.document && pinned.document.languageId === "gcode"
		? { document: pinned.document, lineNumber: pinned.lineNumber }
		: undefined;
}

function buildMacroHistoryPayload(document, lineNumber) {
	const trace = buildExecutionTrace(document, { includePlaybackData: true });
	const aliases = Object.fromEntries(buildAliasEntries(document)
		.filter(entry => entry.phrase || entry.alias)
		.map(entry => [entry.macro.toUpperCase(), entry.phrase || entry.alias]));
	return {
		lineNumber,
		documentName: document.fileName || document.uri.toString(),
		aliases,
		traceStatus: trace.status,
		problems: trace.problems.map(problem => problem.message),
		initialMacroValues: trace.initialMacroValues || {},
		entries: trace.executionEntries.map(entry => ({
			lineNumber: entry.lineNumber,
			macroChanges: entry.macroChanges || [],
			macroReads: Object.keys(entry.macroValues || {}).filter(macro => /^#\d+$/.test(macro))
		}))
	};
}

function makeMacroStateCheckpoints(entries, initialMacroValues, interval = CHECKPOINT_INTERVAL) {
	const checkpoints = new Map([[0, new Map(Object.entries(initialMacroValues || {}))]]);
	const values = new Map(Object.entries(initialMacroValues || {}));
	entries.forEach((entry, index) => {
		applyMacroChanges(values, entry.macroChanges);
		if ((index + 1) % interval === 0) checkpoints.set(index + 1, new Map(values));
	});
	return checkpoints;
}

function restoreMacroState(entries, initialMacroValues, checkpoints, entryIndex, interval = CHECKPOINT_INTERVAL) {
	const completedEntries = Math.max(0, Math.min(entries.length, entryIndex + 1));
	const checkpointIndex = Math.floor(completedEntries / interval) * interval;
	const values = new Map(checkpoints.get(checkpointIndex) || checkpoints.get(0));
	for (let index = checkpointIndex; index < completedEntries; index++) applyMacroChanges(values, entries[index].macroChanges);
	return values;
}

function applyMacroChanges(values, changes) {
	for (const change of changes || []) {
		if (Number.isFinite(change.current)) values.set(change.macro, change.current);
		else values.delete(change.macro);
	}
}

function renderMacroHistoryHtml() {
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
		body { padding: 0 10px; color: var(--vscode-foreground); font: 12px var(--vscode-font-family); }
		header { position: sticky; top: 0; padding: 7px 0 5px; background: var(--vscode-sideBar-background); z-index: 1; }
		.toolbar { display: flex; align-items: center; gap: 6px; } .pin { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-background); border-radius: 3px; padding: 4px 9px; cursor: pointer; font: inherit; font-weight: 600; box-shadow: inset 0 -1px rgba(0, 0, 0, .16); } .pin:hover { background: var(--vscode-button-hoverBackground); border-color: var(--vscode-button-hoverBackground); } .note { color: var(--vscode-descriptionForeground); }
		.occurrence-control { display: flex; flex: 1; align-items: center; gap: 5px; color: var(--vscode-descriptionForeground); } select { min-width: 0; max-width: 100%; flex: 1; color: var(--vscode-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); padding: 3px; } .pinned-line { margin-top: 4px; color: var(--vscode-descriptionForeground); }
		table { width: max-content; min-width: 100%; border-collapse: collapse; font-family: var(--vscode-editor-font-family); } th { text-align: left; color: var(--vscode-descriptionForeground); font-weight: normal; } td, th { padding: 3px 4px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; } .value-column { text-align: right; } .value-increased, .value-increased code { color: var(--vscode-testing-iconPassed, #73c991) !important; } .value-decreased, .value-decreased code { color: var(--vscode-testing-iconFailed, #f14c4c) !important; } .macro { cursor: pointer; } .macro:hover { text-decoration: underline; } .state { overflow-x: hidden; margin-top: 5px; } .horizontal-scroll { height: 16px; overflow-x: scroll; overflow-y: hidden; } .horizontal-width { height: 1px; } .history { margin-top: 8px; max-height: 180px; overflow: auto; }
	</style></head><body><header id="toolbar"></header><main id="content" class="note">Move the caret through a G-code program.</main><script>
		const vscode = acquireVsCodeApi(); let state; let selectedOccurrence = 0; let selectedMacro; let accessCheckpointCache; let tableResizeObserver;
		const toolbar = document.getElementById("toolbar"), content = document.getElementById("content");
		window.addEventListener("message", event => { if (event.data.type !== "state") return; state = event.data; selectedOccurrence = 0; selectedMacro = undefined; accessCheckpointCache = undefined; render(); });
		function apply(values, changes) { for (const change of changes || []) { if (Number.isFinite(change.current)) values.set(change.macro, change.current); else values.delete(change.macro); } }
		function checkpoints() { const result = new Map([[0, new Map(Object.entries(state.initialMacroValues || {}))]]), values = new Map(Object.entries(state.initialMacroValues || {})); state.entries.forEach((entry, index) => { apply(values, entry.macroChanges); if ((index + 1) % ${CHECKPOINT_INTERVAL} === 0) result.set(index + 1, new Map(values)); }); return result; }
		function restore(entryIndex) { const all = checkpoints(), completed = entryIndex + 1, start = Math.floor(completed / ${CHECKPOINT_INTERVAL}) * ${CHECKPOINT_INTERVAL}, values = new Map(all.get(start) || all.get(0)); for (let i = start; i < completed; i++) apply(values, state.entries[i].macroChanges); return values; }
		function noteAccess(accesses, entry, index) { const macros = new Set([...(entry.macroReads || []), ...(entry.macroChanges || []).map(change => change.macro)]); for (const macro of macros) accesses.set(macro, index); }
		function accessCheckpoints() { if (accessCheckpointCache) return accessCheckpointCache; const result = new Map([[0, new Map()]]), accesses = new Map(); state.entries.forEach((entry, index) => { noteAccess(accesses, entry, index); if ((index + 1) % ${CHECKPOINT_INTERVAL} === 0) result.set(index + 1, new Map(accesses)); }); accessCheckpointCache = result; return result; }
		function restoreAccesses(entryIndex) { const all = accessCheckpoints(), completed = entryIndex + 1, start = Math.floor(completed / ${CHECKPOINT_INTERVAL}) * ${CHECKPOINT_INTERVAL}, accesses = new Map(all.get(start) || all.get(0)); for (let i = start; i < completed; i++) noteAccess(accesses, state.entries[i], i); return accesses; }
		function connectHorizontalScroll(stateTable) { if (tableResizeObserver) tableResizeObserver.disconnect(); const scrollbar = toolbar.querySelector('#horizontalScroll'), width = toolbar.querySelector('#horizontalWidth'); const updateWidth = () => { const needed = stateTable.scrollWidth > stateTable.clientWidth + 1; scrollbar.hidden = !needed; width.style.width = needed ? stateTable.scrollWidth + 'px' : '0'; if (!needed) stateTable.scrollLeft = 0; }; updateWidth(); requestAnimationFrame(updateWidth); if (typeof ResizeObserver === 'function') { tableResizeObserver = new ResizeObserver(updateWidth); tableResizeObserver.observe(stateTable); } let syncing = false; stateTable.addEventListener('scroll', () => { if (!syncing) { syncing = true; scrollbar.scrollLeft = stateTable.scrollLeft; syncing = false; } }); scrollbar.addEventListener('scroll', () => { if (!syncing) { syncing = true; stateTable.scrollLeft = scrollbar.scrollLeft; syncing = false; } }); }
		function format(value) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6))); }
		function esc(text) { return String(text).replace(/[&<>\"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[char]); }
		function render() { if (!state || state.unavailable) { toolbar.textContent = ""; content.textContent = state ? state.unavailable : "Move the caret through a G-code program."; return; }
			const occurrences = state.entries.map((entry, index) => ({ entry, index })).filter(item => item.entry.lineNumber === state.lineNumber); if (!occurrences.length) { content.textContent = "This source line was not reached by the current Trace."; return; }
			selectedOccurrence = Math.max(0, Math.min(selectedOccurrence, occurrences.length - 1)); const current = occurrences[selectedOccurrence], values = restore(current.index), previousValues = selectedOccurrence > 0 ? restore(occurrences[selectedOccurrence - 1].index) : new Map(), accesses = restoreAccesses(current.index); const rows = [...values.entries()].filter(([, value]) => Number.isFinite(value)).sort(([left], [right]) => (accesses.get(right) ?? -1) - (accesses.get(left) ?? -1) || left.localeCompare(right, undefined, { numeric: true })).map(([macro, value]) => { const previous = previousValues.get(macro); const changeClass = Number.isFinite(previous) && value > previous ? ' value-increased' : Number.isFinite(previous) && value < previous ? ' value-decreased' : ''; return '<tr><td class="macro" data-macro="' + esc(macro) + '"><code>' + esc(macro) + '</code></td><td class="value-column' + changeClass + '"><code>' + esc(format(value)) + '</code></td><td>' + esc(state.aliases[macro] || '—') + '</td></tr>'; }).join("") || '<tr><td colspan="3" class="note">No resolved macro values.</td></tr>';
			toolbar.innerHTML = '<div class="toolbar"><label class="occurrence-control">Occurrence <select id="occurrence" aria-label="Execution occurrence" title="Scroll to change occurrence">' + occurrences.map((item, index) => '<option value="' + index + '"' + (index === selectedOccurrence ? ' selected' : '') + '>' + (index + 1) + ' / ' + occurrences.length + '</option>').join("") + '</select></label><button id="pin" class="pin" type="button" title="' + (state.pinned ? 'Follow the caret' : 'Pin this source line') + '">' + (state.pinned ? 'Unpin' : 'Pin') + '</button></div>' + (state.pinned ? '<div class="pinned-line">Pinned to L' + (state.lineNumber + 1) + '</div>' : '') + '<div id="horizontalScroll" class="horizontal-scroll" aria-label="Macro table horizontal scroll"><div id="horizontalWidth" class="horizontal-width"></div></div>';
			content.innerHTML = '<div class="state"><table><thead><tr><th title="Most recently read or assigned first">Macro</th><th class="value-column">Value</th><th>Name</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (selectedMacro ? '<section class="history" id="history"></section>' : '');
			const occurrence = toolbar.querySelector('#occurrence'), stateTable = content.querySelector('.state'); occurrence.addEventListener('change', event => { selectedOccurrence = Number(event.target.value); render(); }); occurrence.addEventListener('wheel', event => { event.preventDefault(); const step = event.deltaY > 0 ? 1 : -1; const next = Math.max(0, Math.min(occurrences.length - 1, selectedOccurrence + step)); if (next !== selectedOccurrence) { selectedOccurrence = next; render(); } }, { passive: false }); toolbar.querySelector('#pin').addEventListener('click', () => vscode.postMessage({ type: "setPinned", pinned: !state.pinned })); connectHorizontalScroll(stateTable); content.querySelectorAll('[data-macro]').forEach(cell => cell.addEventListener('click', () => { selectedMacro = cell.dataset.macro; render(); })); if (selectedMacro) renderHistory(occurrences);
		}
		function renderHistory(occurrences) { const history = document.getElementById('history'); if (!history) return; const values = occurrences.map((item, index) => { const value = restore(item.index).get(selectedMacro); return '<tr><td>' + (index + 1) + '</td><td><code>' + (Number.isFinite(value) ? esc(format(value)) : '—') + '</code></td></tr>'; }).join(''); history.innerHTML = '<strong>' + esc(selectedMacro) + ' across all occurrences</strong><table><thead><tr><th>Occurrence</th><th>Value</th></tr></thead><tbody>' + values + '</tbody></table>'; }
	</script></body></html>`;
}

module.exports = {
	registerKaijuSenseMacroHistory,
	buildMacroHistoryPayload,
	makeMacroStateCheckpoints,
	restoreMacroState,
	applyMacroChanges,
	renderMacroHistoryHtml
};
