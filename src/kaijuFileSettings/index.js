// Role: present a read-only, document-bound settings snapshot from existing owners.
const vscode = require("vscode");
const { randomBytes } = require("crypto");
const manifest = require("../../package.json");
const { getMachineModeForDocument, getDocumentMachineSettings } = require("../MetaMachineMode");
const { getChronobladeSettingsSnapshot } = require("../kaijuChronoblade/webview");
const { getVisionSettingsSnapshot } = require("../kaijuVision/webview");
const { getOrphanSettingsSnapshot } = require("../kaijuOrphanKiller");
const { getWarpaintSettingsSnapshot } = require("../kaijuWarpaint");
const { getAliasModeState } = require("../kaijuAlias");
const { getAliasOptions } = require("../kaijuAlias/options");
const { getSenseOptions } = require("../kaijuSense/options");
const { getAlertOptions } = require("../kaijuAlert/options");
const { getFormattingOptions } = require("../kaijuReconstructor/options");
const { getDecompositionOptions } = require("../kaijuDecomposition/options");

const CONFIGURATION_LAYERS = [
	["defaultValue", "Default"], ["globalValue", "User"],
	["workspaceValue", "Workspace"], ["workspaceFolderValue", "Workspace folder"],
	["defaultLanguageValue", "Language default"], ["globalLanguageValue", "User language override"],
	["workspaceLanguageValue", "Workspace language override"], ["workspaceFolderLanguageValue", "Workspace folder language override"]
];

function collectConfiguration(document) {
	const config = vscode.workspace.getConfiguration(undefined, document);
	const sections = [].concat(manifest.contributes.configuration);
	const properties = Object.assign({}, ...sections.map(section => section.properties));
	return Object.keys(properties).filter(key => key.startsWith("kaijuNC.")).sort().map(key => {
		const inspected = typeof config.inspect === "function" ? config.inspect(key) : undefined;
		const layers = CONFIGURATION_LAYERS.filter(([field]) => inspected && inspected[field] !== undefined)
			.map(([field, source]) => ({ source, value: inspected[field] }));
		if (!layers.length) layers.push({ source: "Default", value: properties[key].default });
		const value = config.get(key, properties[key].default);
		const merged = value && typeof value === "object" && !Array.isArray(value) && layers.length > 1;
		return { key, value, source: merged ? "Merged configuration layers" : layers[layers.length - 1].source, layers };
	});
}

function buildFileSettingsSnapshot(document) {
	const machine = getMachineModeForDocument(document);
	const program = getDocumentMachineSettings(document);
	const alias = getAliasOptions(document);
	return {
		file: document.uri.toString(), version: document.version, capturedAt: new Date().toISOString(),
		machine, program,
		features: {
			Chronoblade: getChronobladeSettingsSnapshot(document),
			Vision: getVisionSettingsSnapshot(document),
			"Orphan Killer": getOrphanSettingsSnapshot(document),
			Warpaint: getWarpaintSettingsSnapshot(document),
			Alias: { effective: alias, state: getAliasModeState(document, alias) },
			Sense: { effective: getSenseOptions(document) },
			Alert: { effective: getAlertOptions(document) },
			Reconstructor: { effective: getFormattingOptions(document) },
			Decomposition: { effective: getDecompositionOptions(document) }
		},
		configuration: collectConfiguration(document)
	};
}

function flatten(value, prefix = "") {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
		return Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
	}
	return [{ key: prefix, value }];
}

function snapshotRows(snapshot) {
	const rows = [];
	const add = (group, values, source) => {
		for (const row of flatten(values)) rows.push({ group, ...row, source: typeof source === "function" ? source(row.key) : source });
	};
	add("Machine", snapshot.machine, key => {
		if (key.startsWith("motionOptions.workOffsets")) return snapshot.program.workOffsets ? "Saved program offsets" : "Resolved machine defaults";
		if (key.startsWith("gCodeDialect")) return snapshot.program.selection.gCodeDialectId ? "Saved program G-code selection" : "Resolved G-code profile";
		if (key.startsWith("machineProfile") || key.startsWith("machineSettings")) return snapshot.program.selection.machineProfileId ? "Saved program machine selection" : "Resolved machine profile";
		return key.startsWith("profile.") && snapshot.machine.machineModeSource === "inferred" ? "Automatic inference" : "Shared machine resolver";
	});
	add("Saved program overrides", snapshot.program, "Saved program state (empty means inherit)");
	for (const [name, feature] of Object.entries(snapshot.features)) {
		add(name, feature.effective, key => feature.saved && Object.prototype.hasOwnProperty.call(feature.saved, key.split(".")[0]) && feature.saved[key.split(".")[0]] !== undefined
			? "Saved program choice; normalized by feature" : `${name} resolver (configuration / machine / default)`);
		for (const [key, value] of Object.entries(feature)) {
			if (key !== "effective") add(`${name}: ${key}`, value, key === "state" ? "Current document Alias state" : "Saved program state");
		}
	}
	for (const entry of snapshot.configuration) rows.push({ group: "VS Code configuration", ...entry });
	return rows;
}

function registerFileSettings(context) {
	const panels = new Map();
	context.subscriptions.push(vscode.commands.registerCommand("kaijuNC.fileSettings", async uri => {
		const document = uri && typeof uri.scheme === "string"
			? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
		if (!document || document.languageId !== "gcode") {
			vscode.window.showWarningMessage("Open a G-code file to inspect its KAIJU settings.");
			return;
		}
		const key = document.uri.toString();
		if (panels.has(key)) { panels.get(key).reveal(); return; }
		const panel = vscode.window.createWebviewPanel("kaijuFileSettings", "KAIJU File Settings", vscode.ViewColumn.Beside,
			{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
		panels.set(key, panel);
		context.subscriptions.push(panel);
		let snapshot;
		const refresh = () => {
			try {
				const current = vscode.workspace.textDocuments.find(item => item.uri.toString() === key) || document;
				snapshot = buildFileSettingsSnapshot(current);
				panel.webview.html = renderFileSettingsHtml(snapshot);
			} catch (error) { vscode.window.showErrorMessage(`KAIJU File Settings: ${error.message}`); }
		};
		context.subscriptions.push(panel.onDidDispose(() => panels.delete(key)), panel.webview.onDidReceiveMessage(async message => {
			if (message && message.type === "refresh") refresh();
			if (message && message.type === "copy" && snapshot) {
				await vscode.env.clipboard.writeText(JSON.stringify(snapshot, null, 2));
				await panel.webview.postMessage({ type: "copied" });
			}
		}));
		refresh();
	}));
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function displayValue(value) {
	return value === undefined ? "Unset / inherited" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function renderFileSettingsHtml(snapshot) {
	const nonce = randomBytes(16).toString("hex");
	const rows = snapshotRows(snapshot);
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:8px;box-sizing:border-box;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}h1{font-size:14px;margin:0 auto 0 0}button,input{font:inherit}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 9px;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}
input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:4px;width:260px;max-width:100%}button:focus-visible,input:focus-visible{outline:1px solid var(--vscode-focusBorder)}
.intro{color:var(--vscode-descriptionForeground);margin:8px 0 0;line-height:1.4}.file{overflow-wrap:anywhere;margin:8px 0 4px}.meta{color:var(--vscode-descriptionForeground);margin-bottom:8px}.scroll{overflow:auto;flex:1;min-height:0}table{border-collapse:collapse;min-width:100%;width:max-content}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--vscode-panel-border);padding:4px 8px}th{background:var(--vscode-editor-background);position:sticky;top:0}pre{font-family:var(--vscode-editor-font-family);font-size:inherit;margin:0;white-space:pre-wrap;max-width:640px;overflow-wrap:anywhere}td:first-child{color:var(--vscode-descriptionForeground)}summary{cursor:pointer}details{margin-top:4px;color:var(--vscode-descriptionForeground)}[hidden]{display:none!important}
</style></head><body>
<div class="toolbar"><h1>KAIJU File Settings</h1><input id="search" type="search" aria-label="Search settings" placeholder="Search settings, values, sources"><button id="refresh">Refresh</button><button id="copy">Copy JSON</button></div>
<p class="intro">Inspect the settings KAIJU uses for this file and where they come from, including machine profiles, saved program overrides, and VS Code settings. This viewer is read-only. Refresh updates the snapshot; Copy JSON copies all settings, including those hidden by search.</p>
<div class="file">${escapeHtml(snapshot.file)}</div><div class="meta">Read-only snapshot · Version ${escapeHtml(snapshot.version)} · ${escapeHtml(snapshot.capturedAt)} · <span id="count">${rows.length}</span> settings</div>
<div class="scroll"><table><thead><tr><th>Group</th><th>Setting</th><th>Effective value</th><th>Source / stored values</th></tr></thead><tbody>
${rows.map(row => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(row.key)}</td><td><pre>${escapeHtml(displayValue(row.value))}</pre></td><td>${escapeHtml(row.source)}${row.layers ? `<details><summary>Configuration layers</summary>${row.layers.map(layer => `<div>${escapeHtml(layer.source)}<pre>${escapeHtml(displayValue(layer.value))}</pre></div>`).join("")}</details>` : ""}</td></tr>`).join("")}
</tbody></table></div><p id="empty" hidden>No matching settings.</p><span id="status" role="status"></span>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const search = document.getElementById('search');
search.value = (vscode.getState() || {}).search || '';
function filterRows() {
 const query = search.value.toLowerCase(); let count = 0;
 for (const row of document.querySelectorAll('tbody tr')) { row.hidden = !row.textContent.toLowerCase().includes(query); if (!row.hidden) count++; }
 document.getElementById('count').textContent = count;
 document.getElementById('empty').hidden = count > 0;
 vscode.setState({ search: search.value });
}
search.addEventListener('input', filterRows); filterRows();
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
window.addEventListener('message', event => { if (event.data && event.data.type === 'copied') document.getElementById('status').textContent = 'JSON copied.'; });
</script></body></html>`;
}

module.exports = { registerFileSettings, buildFileSettingsSnapshot, collectConfiguration, snapshotRows, renderFileSettingsHtml };
