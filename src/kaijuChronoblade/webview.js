// Role: render and run KAIJU Chronoblade cycle-time reports. Keep shared
// motion interpretation in MetaMotionEngine.js and machine defaults in
// MetaMachineMode.js.
const vscode = require("vscode");
const {
	analyzeChronobladeRange,
	formatNumber,
	formatTime
} = require("../MetaMotionEngine");
const {
	buildExecutionTrace,
	getExecutionTrace,
	onDidChangeExecutionTrace,
	scheduleExecutionTrace,
	attachTraceOutputLines
} = require("../MetaExecutionTrace");
const { decomposeDocument } = require("../kaijuDecomposition");
const { onDidChangeMachineMode } = require("../MetaMachineMode");
const { getChronobladeOptions } = require("./options");

let chronobladePanel;
let chronobladeState;
let chronobladeContext;
let timingProfilesPanel;

function registerChronobladeWebview(context) {
	chronobladeContext = context;
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.chronoblade", async () => {
			await runChronoblade();
		}),
		onDidChangeExecutionTrace(document => {
			void refreshLiveChronoblade(document);
		}),
		onDidChangeMachineMode(document => {
			void refreshMachineModeChronoblade(document);
		})
	);
}

async function runChronoblade() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before running Chronoblade.");
		return;
	}

	const mode = editor.selection && !editor.selection.isEmpty ? "selection" : "whole";
	const options = makeChronobladeOptions(editor.document);

	await showChronobladePanel(editor, mode, options);
}

async function showChronobladePanel(editor, mode, options) {
	chronobladeState = { documentUriText: editor.document.uri.toString(), mode, options };
	if (!chronobladePanel) {
		chronobladePanel = vscode.window.createWebviewPanel(
			"kaijuChronoblade",
			"KAIJU Chronoblade",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		chronobladePanel.onDidDispose(() => {
			chronobladePanel = undefined;
			chronobladeState = undefined;
		});

		chronobladePanel.webview.onDidReceiveMessage(async message => {
			if (!message) return;
			if (message.type === "openChronobladeTimingProfiles") {
				await showTimingProfilesEditor(getChronobladeSourceEditor()?.document);
				return;
			}
			if (!["setChronobladeAnalysis", "setChronobladeLive", "setChronobladeTiming", "setChronobladeTimingProfile"].includes(message.type)) return;
			const sourceEditor = getChronobladeSourceEditor();
			if (!sourceEditor) return;
			await saveDocumentChronobladeSettings(sourceEditor.document, message.options || {}, message.type === "setChronobladeTimingProfile");
			const nextOptions = makeChronobladeOptions(sourceEditor.document, message.options || {});
			chronobladeState = { documentUriText: sourceEditor.document.uri.toString(), mode: chronobladeState.mode, options: nextOptions };
			if (nextOptions.live) scheduleExecutionTrace(sourceEditor.document);
			if (message.type !== "setChronobladeLive") await renderChronobladePanel(sourceEditor, chronobladeState.mode, nextOptions);
		});

	} else {
		chronobladePanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderChronobladePanel(editor, mode, options);
}

async function showTimingProfilesEditor(document) {
	if (!document) return;
	if (!timingProfilesPanel) {
		timingProfilesPanel = vscode.window.createWebviewPanel("kaijuChronobladeTimingProfiles", "Chronoblade Timing Profiles", vscode.ViewColumn.Beside, { enableScripts: true });
		timingProfilesPanel.onDidDispose(() => { timingProfilesPanel = undefined; });
		timingProfilesPanel.webview.onDidReceiveMessage(async message => {
			if (!message || message.type !== "saveTimingProfiles") return;
			const editor = getChronobladeSourceEditor();
			if (!editor) return;
			const profiles = normalizeTimingProfilesForSetting(message.profiles);
			await vscode.workspace.getConfiguration("kaijuNC.chronoblade", editor.document.uri).update("timingProfiles", profiles, true);
			await renderTimingProfilesEditor(editor.document);
		});
	} else {
		timingProfilesPanel.reveal(vscode.ViewColumn.Beside);
	}
	await renderTimingProfilesEditor(document);
}

async function renderTimingProfilesEditor(document) {
	if (!timingProfilesPanel) return;
	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const profiles = Array.isArray(config.get("timingProfiles", [])) ? config.get("timingProfiles", []).map(profile => Object.assign({}, profile, {
		customTimes: Object.entries(profile && profile.customTimes || {}).map(([code, seconds]) => ({ code, seconds }))
	})) : [];
	timingProfilesPanel.webview.html = renderTimingProfilesHtml(profiles);
}

function normalizeTimingProfilesForSetting(rawProfiles) {
	if (!Array.isArray(rawProfiles)) return [];
	const names = new Set();
	return rawProfiles.flatMap(raw => {
		const name = String(raw && raw.name || "").trim();
		if (!name || names.has(name.toLowerCase())) return [];
		names.add(name.toLowerCase());
		const profile = { name };
		for (const key of ["rapidRate", "toolChangeSeconds", "extraStationSeconds"]) {
			const value = Number(raw[key]);
			if (Number.isFinite(value) && value >= 0) profile[key] = value;
		}
		const customTimes = {};
		for (const entry of Array.isArray(raw.customTimes) ? raw.customTimes : []) {
			const code = String(entry && entry.code || "").trim().toUpperCase();
			const seconds = Number(entry && entry.seconds);
			if (/^M0*\d+$/.test(code) && Number.isFinite(seconds) && seconds >= 0) customTimes[code] = seconds;
		}
		if (Object.keys(customTimes).length) profile.customTimes = customTimes;
		return [profile];
	});
}

async function renderChronobladePanel(editor, mode, options) {
	const range = getRangeForMode(editor, mode);

	if (mode === "selection" && !range) {
		vscode.window.showWarningMessage("Select a G-code section before sending the selection to Chronoblade.");
		return;
	}

	const traceResult = options.analysisMode === "trace" ? await getChronobladeTrace(editor.document) : undefined;
	const analysisOptions = traceResult && isUsableChronobladeTrace(traceResult.trace)
		? Object.assign({}, options, { executionTrace: traceResult.trace })
		: options;
	const result = analyzeChronobladeRange(editor.document, range, analysisOptions);
	result.traceWarning = traceResult && traceResult.warning;

	chronobladePanel.title = "KAIJU Chronoblade";
	chronobladePanel.webview.html = renderChronobladeHtml(options, result);
	await compactChronobladePanelEditorGroup(options);
}

async function refreshLiveChronoblade(document) {
	if (!chronobladePanel || !chronobladeState || !document || document.uri.toString() !== chronobladeState.documentUriText || !chronobladeState.options.live) return;
	const trace = getExecutionTrace(document);
	if (!trace || trace.status === "running") return;
	if (!isUsableChronobladeTrace(trace)) {
		if (chronobladeState.options.analysisMode === "trace") showChronobladeLiveWarning(trace);
		return;
	}
	const editor = getChronobladeSourceEditor();
	if (!editor || editor.document.uri.toString() !== chronobladeState.documentUriText) return;
	const options = makeChronobladeOptions(editor.document, chronobladeState.options);
	chronobladeState = { documentUriText: editor.document.uri.toString(), mode: chronobladeState.mode, options };
	await renderChronobladePanel(editor, chronobladeState.mode, options);
}

async function refreshMachineModeChronoblade(document) {
	if (!chronobladePanel || !chronobladeState || !document || document.uri.toString() !== chronobladeState.documentUriText) return;
	const editor = getChronobladeSourceEditor();
	if (!editor || editor.document.uri.toString() !== document.uri.toString()) return;
	const options = makeChronobladeOptions(document, chronobladeState.options);
	chronobladeState = { documentUriText: document.uri.toString(), mode: chronobladeState.mode, options };
	await renderChronobladePanel(editor, chronobladeState.mode, options);
}

function showChronobladeLiveWarning(trace) {
	if (!chronobladePanel || !trace) return;
	const details = [`The newest Trace is ${trace.status}.`];
	for (const problem of trace.problems || []) details.push(`Line ${Number(problem.lineNumber) + 1}: ${problem.message}`);
	void chronobladePanel.webview.postMessage({ type: "liveTraceWarning", warning: details.join("\n") });
}

async function getChronobladeTrace(document) {
	const trace = buildExecutionTrace(document, { includeDecompositionData: true });
	const decomposition = isUsableChronobladeTrace(trace)
		? await decomposeDocument(document, { promptForUnknownMacros: false, executionTrace: trace })
		: undefined;
	if (decomposition) attachTraceOutputLines(trace, decomposition.decompositionLines);
	return {
		trace,
		warning: !isUsableChronobladeTrace(trace) ? `Trace is ${trace.status}; showing as-written timing.` : trace.status === "assumed" ? "Trace used assumed-zero macro values." : ""
	};
}

function isUsableChronobladeTrace(trace) {
	return trace && (trace.status === "ready" || trace.status === "assumed");
}

function getChronobladeSourceEditor() {
	const uriText = chronobladeState && chronobladeState.documentUriText;
	return (uriText && vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uriText)) || vscode.window.activeTextEditor;
}

function getChronobladeDocumentKey(document) {
	return document && document.uri ? document.uri.toString() : "";
}

function getDocumentChronobladeSettings(document) {
	const all = chronobladeContext && chronobladeContext.workspaceState ? chronobladeContext.workspaceState.get("kaijuChronoblade.settingsByDocument", {}) : {};
	return Object.assign({}, all[getChronobladeDocumentKey(document)] || {});
}

async function saveDocumentChronobladeSettings(document, rawSettings, resetTimingOverrides = false) {
	if (!chronobladeContext || !chronobladeContext.workspaceState) return;
	const all = Object.assign({}, chronobladeContext.workspaceState.get("kaijuChronoblade.settingsByDocument", {}));
	const current = Object.assign({}, all[getChronobladeDocumentKey(document)] || {});
	const next = Object.assign(current, {
		analysisMode: rawSettings.analysisMode === "trace" ? "trace" : "asWritten",
		showTraceLine: rawSettings.showTraceLine === true,
		live: rawSettings.live === true
	});

	if (Object.prototype.hasOwnProperty.call(rawSettings, "timingProfile")) {
		next.timingProfile = String(rawSettings.timingProfile || "").trim();
	}

	if (resetTimingOverrides) {
		delete next.rapidRate;
		delete next.toolChangeSeconds;
		delete next.extraStationSeconds;
	} else {
		for (const key of ["rapidRate", "toolChangeSeconds", "extraStationSeconds"]) {
			if (Object.prototype.hasOwnProperty.call(rawSettings, key)) next[key] = rawSettings[key];
		}
	}

	all[getChronobladeDocumentKey(document)] = next;
	await chronobladeContext.workspaceState.update("kaijuChronoblade.settingsByDocument", all);
}

function makeChronobladeOptions(document, rawOptions = {}) {
	return getChronobladeOptions(document, Object.assign({}, getDocumentChronobladeSettings(document), rawOptions));
}

function getRangeForMode(editor, mode) {
	if (mode === "whole") {
		return undefined;
	}

	if (!editor.selection || editor.selection.isEmpty) {
		return undefined;
	}

	if (editor.selection.end.character === 0 && editor.selection.end.line > editor.selection.start.line) {
		return new vscode.Range(
			editor.selection.start,
			new vscode.Position(editor.selection.end.line - 1, Number.MAX_SAFE_INTEGER)
		);
	}

	return editor.selection;
}

async function compactChronobladePanelEditorGroup(options) {
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

function renderTimingProfilesHtml(profiles) {
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; }
		label { display:grid; gap:4px; font-size:12px; color:var(--vscode-descriptionForeground); }
		input, select { box-sizing:border-box; width:100%; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding:5px 6px; }
		.profile-bar { display:grid; grid-template-columns:minmax(0, 1fr) auto auto; align-items:end; gap:8px; }
		.grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; margin:10px 0; }
		.event { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; margin:6px 0; }
		button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; border-radius:3px; padding:5px 8px; cursor:pointer; }
		.list-actions { display:flex; gap:8px; margin:8px 0; } .hint { font-size:12px; color:var(--vscode-descriptionForeground); margin:12px 0 6px; }
	</style></head><body>
		<div class="profile-bar"><label>Profile<select id="profileSelect"></select></label><button id="newProfile">New profile</button><button id="deleteProfile">Delete profile</button></div>
		<div class="grid"><label>Name<input id="name"></label><label>G0 rate<input id="rapidRate" type="number" min="0"></label><label>Tool swap<input id="toolChangeSeconds" type="number" min="0" step="0.1"></label><label>Extra station<input id="extraStationSeconds" type="number" min="0" step="0.1"></label></div>
		<p class="hint">Custom commands add time to Chronoblade's Other category.</p><div class="list-actions"><button id="save">Save profile</button><button id="addEvent">New command</button></div><div id="events"></div>
		<script>const vscode=acquireVsCodeApi();let profiles=${escapeScriptJson(profiles)};let active=0;
		const $=id=>document.getElementById(id); const value=id=>$(id).value; const number=id=>Number(value(id));
		function eventRows(){return [...document.querySelectorAll('.event')].map(row=>({code:row.querySelector('.code').value,seconds:row.querySelector('.seconds').value}));}
		function capture(){if(!profiles[active])return; profiles[active]={name:value('name'),rapidRate:number('rapidRate'),toolChangeSeconds:number('toolChangeSeconds'),extraStationSeconds:number('extraStationSeconds'),customTimes:eventRows()};}
		function render(){const p=profiles[active]||{name:'',rapidRate:'',toolChangeSeconds:'',extraStationSeconds:'',customTimes:[]};$('profileSelect').innerHTML=profiles.map((x,i)=>'<option value="'+i+'"'+(i===active?' selected':'')+'>'+escape(x.name)+'</option>').join('');$('name').value=p.name;$('rapidRate').value=p.rapidRate;$('toolChangeSeconds').value=p.toolChangeSeconds;$('extraStationSeconds').value=p.extraStationSeconds; $('events').innerHTML=(p.customTimes||[]).map(row).join('');}
		function row(e={code:'M',seconds:''}){return '<div class="event"><input class="code" value="'+escape(e.code)+'" placeholder="M05"><input class="seconds" type="number" min="0" step="0.1" value="'+escape(e.seconds)+'" placeholder="Seconds"><button class="remove">Remove</button></div>';}
		function escape(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
		$('profileSelect').onchange=()=>{capture();active=Number(value('profileSelect'));render();};$('addEvent').onclick=()=>$('events').insertAdjacentHTML('beforeend',row());$('newProfile').onclick=()=>{capture();profiles.push({name:'New profile',rapidRate:'',toolChangeSeconds:'',extraStationSeconds:'',customTimes:[]});active=profiles.length-1;render();};$('deleteProfile').onclick=()=>{if(!profiles.length)return;profiles.splice(active,1);active=Math.max(0,active-1);render();};$('events').onclick=e=>{if(e.target.classList.contains('remove'))e.target.closest('.event').remove();};$('save').onclick=()=>{capture();vscode.postMessage({type:'saveTimingProfiles',profiles});};render();
		</script></body></html>`;
}

function renderChronobladeHtml(options, result) {
	const summary = result.summary;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		html,
		body {
			height: 100%;
		}

		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 2px 16px 16px;
			box-sizing: border-box;
			display: flex;
			flex-direction: column;
		}

		.empty,
		.note {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}

		.controls {
			display: flex;
			align-items: flex-start;
			gap: 10px;
			margin: 8px 0 10px;
		}

		.timing-controls {
			display: grid;
			gap: 6px;
			flex: 0 0 188px;
		}

		label.timing-control {
			display: grid;
			grid-template-columns: 84px 96px;
			align-items: center;
			gap: 8px;
		}

		.profile-picker {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 3px;
		}

		.profile-picker button {
			padding: 2px 4px;
			font-size: 11px;
		}

		label {
			display: grid;
			gap: 4px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		input,
		select {
			box-sizing: border-box;
			width: 100%;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			padding: 5px 6px;
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

		.summary {
			display: grid;
			grid-template-columns: repeat(4, minmax(88px, 1fr));
			gap: 8px;
			min-width: 0;
			flex: 1 1 360px;
		}

		.settings-controls {
			display: flex;
			align-items: flex-start;
			gap: 10px;
			flex: 0 0 auto;
		}

		.settings-primary {
			display: grid;
			grid-template-columns: 188px 142px;
			gap: 6px 10px;
		}

		.profile-control {
			display: grid;
			grid-template-columns: 84px minmax(0, 1fr);
			align-items: center;
			gap: 8px;
			grid-column: 1 / -1;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.metric {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 8px;
		}

		.metric-value {
			font-size: 14px;
			font-weight: 600;
			white-space: nowrap;
		}

		.metric-label {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			margin-top: 2px;
			white-space: nowrap;
		}

		.report-toggles {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
			flex: 0 0 132px;
			margin: 0;
		}

		.analysis-controls {
			display: grid;
			align-content: start;
			gap: 6px;
			flex: 0 0 142px;
		}

		label.analysis-control {
			display: grid;
			grid-template-columns: 40px 96px;
			align-items: center;
			gap: 6px;
		}

		.checkbox {
			display: flex;
			align-items: center;
			gap: 6px;
			min-height: 28px;
			white-space: nowrap;
		}

		.trace-warning {
			color: var(--vscode-editorWarning-foreground);
			font-size: 11px;
			white-space: nowrap;
		}

		.table-wrap {
			overflow: auto;
			flex: 1 1 auto;
			min-height: 0;
			border-top: 1px solid var(--vscode-panel-border);
		}

		.chronoblade-spacer td {
			border: 0;
			padding: 0;
			height: var(--chronoblade-spacer-height, 0px);
		}

		#chronobladeTableBody tr.chronoblade-spacer {
			height: 0;
		}

		table {
			width: max-content;
			min-width: 100%;
			border-collapse: collapse;
			table-layout: auto;
			font-size: 12px;
		}

		th {
			position: sticky;
			top: 0;
			background: var(--vscode-editor-background);
			color: var(--vscode-descriptionForeground);
			text-align: left;
			font-size: 11px;
			text-transform: uppercase;
			z-index: 1;
		}

		th,
		td {
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 7px 10px 7px 0;
			vertical-align: top;
			white-space: nowrap;
		}

		#chronobladeTableBody tr {
			height: 35px;
		}

		th.tool-marker-header,
		td.tool-marker-cell {
			width: 4px;
			min-width: 4px;
			max-width: 4px;
			padding: 0;
		}

		th.tool-marker-gap,
		td.tool-marker-gap {
			width: 6px;
			min-width: 6px;
			max-width: 6px;
			padding: 0;
		}

		tr.label-row td {
			background: var(--vscode-editor-inactiveSelectionBackground);
			color: var(--vscode-descriptionForeground);
			font-weight: 600;
		}

		tr.label-row {
			cursor: pointer;
		}

		.section-group.is-collapsed .section-content {
			display: none;
		}

		body.hide-zero-time-labels .section-group[data-zero-time="true"] {
			display: none;
		}

		.section-toggle {
			display: block;
			width: 100%;
			padding: 0;
			color: inherit;
			background: transparent;
			border: 0;
			border-radius: 0;
			font: inherit;
			text-align: left;
		}

		.section-toggle:hover {
			background: transparent;
			text-decoration: underline;
		}

		.section-chevron {
			display: inline-block;
			width: 1.25em;
			text-decoration: none;
		}

		.line-column,
		.line-cell,
		.code-column,
		.instruction-cell {
			text-align: center;
		}

		.position-cell {
		}
		.position-cell .coord {
			margin-right: 0.45ch;
		}

		.position-cell .axis-x {
			color: #D65D5D;
		}

		.position-cell .axis-y {
			color: #6A9955;
		}

		.position-cell .axis-z {
			color: #4A90E2;
		}

		.position-cell .axis-letter {
			font-weight: 700;
		}

		code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 1px 4px;
			border-radius: 3px;
		}

		@media (max-width: 720px) {
			.controls {
				align-items: stretch;
				flex-direction: column;
			}

			.summary {
				flex: 0 0 auto;
			}

		}
	</style>
</head>
<body>
	<section class="controls">
		<section class="summary">
			${renderMetric("Total", formatChronobladeMetricTime(summary.totalTimeSeconds))}
			${renderMetric("Cutting", formatChronobladeMetricTime(summary.cuttingTimeSeconds))}
			${renderMetric("G0", formatChronobladeMetricTime(summary.rapidTimeSeconds), "Total estimated G0 rapid-traverse time.")}
			${renderMetric("Dwell", formatChronobladeMetricTime(summary.dwellTimeSeconds))}
			${renderMetric("Tool", formatChronobladeMetricTime(summary.toolTimeSeconds))}
			${renderMetric("Distance", formatNumber(summary.totalDistance, options.humanFormat))}
			${renderMetric("Cut distance", formatNumber(summary.cuttingDistance, options.humanFormat), "Total distance of non-G0 cutting moves.")}
			${renderMetric("Other", formatChronobladeMetricTime(summary.otherTimeSeconds), "Time from custom M-code entries in the selected timing profile.")}
		</section>
		<div class="settings-controls">
			<div class="settings-primary">
			<div class="timing-controls">
				<label class="timing-control">Extra station
					<input id="extraStationSeconds" type="number" min="0" step="0.1" value="${escapeHtml(options.extraStationSeconds)}" title="Additional time for each turret station beyond an adjacent tool swap, in seconds.">
				</label>
				<label class="timing-control">G0 rate
					<input id="rapidRate" type="number" min="0" step="100" value="${escapeHtml(options.rapidRate)}" title="Rapid-traverse rate used to estimate G0 moves, in program units per minute.">
				</label>
				<label class="timing-control">Tool swap
					<input id="toolChangeSeconds" type="number" min="0" step="0.1" value="${escapeHtml(options.toolChangeSeconds)}" title="Base time added for each tool change, in seconds.">
				</label>
			</div>
			<div class="analysis-controls">
				<label class="analysis-control">Motion
				<select id="analysisMode">
					<option value="trace"${options.analysisMode === "trace" ? " selected" : ""}>Trace</option>
					<option value="asWritten"${options.analysisMode === "asWritten" ? " selected" : ""}>As written</option>
				</select>
			</label>
				<label class="analysis-control">Line
				<select id="lineData"${options.analysisMode === "asWritten" ? " disabled" : ""}>
					<option value="source"${!options.showTraceLine ? " selected" : ""}>Source</option>
					<option value="trace"${options.showTraceLine ? " selected" : ""}>Trace</option>
				</select>
			</label>
				${result.traceWarning ? `<span class="trace-warning" title="${escapeAttribute(result.traceWarning)}">⚠ TRACE WARNING</span>` : ""}
				<span id="liveWarning" class="trace-warning" hidden></span>
			</div>
			<div class="profile-control"><span title="${options.hasTimingOverrides ? "One or more timing fields override this profile. Select a profile to reset them." : "Selected Chronoblade timing profile."}">Profile${options.hasTimingOverrides ? "*" : ""}</span>
				<div class="profile-picker"><select id="timingProfile" title="Chronoblade timing profile.">
					${options.timingProfiles.map(profile => `<option value="${escapeAttribute(profile.name)}"${profile.name === options.timingProfile ? " selected" : ""}>${escapeHtml(profile.name)}</option>`).join("")}
				</select><button id="editTimingProfiles" type="button" title="Edit Chronoblade timing profiles.">Edit</button></div>
			</div>
			</div>
			<div class="report-toggles">
			<label class="checkbox"><input id="live" type="checkbox"${options.live ? " checked" : ""}> Live</label>
			<label class="checkbox" title="Show values without insignificant trailing fractional zeros while retaining a decimal point."><input id="significantFigures" type="checkbox"${options.significantFiguresOnly ? " checked" : ""}> Trim zeros</label>
			<label class="checkbox" title="Hide N-label sections whose total estimated time is zero."><input id="hideZeroTimeLabels" type="checkbox"${options.hideZeroTimeLabels ? " checked" : ""}> Hide zero labels</label>
			</div>
		</div>
	</section>

	${renderRows(result.rows, options.humanFormat)}
	<script type="application/json" id="chronoblade-data">${escapeScriptJson({ rows: result.rows, humanFormat: options.humanFormat, lineData: options.showTraceLine ? "trace" : "source" })}</script>

	<script>
		const vscode = acquireVsCodeApi();
		const chronobladeData = JSON.parse(document.getElementById("chronoblade-data").textContent);
		const significantFiguresInput = document.getElementById("significantFigures");
		const hideZeroTimeLabelsInput = document.getElementById("hideZeroTimeLabels");
		const analysisModeSelect = document.getElementById("analysisMode");
		const lineDataSelect = document.getElementById("lineData");
		const liveInput = document.getElementById("live");
		const timingProfileSelect = document.getElementById("timingProfile");
		const editTimingProfilesButton = document.getElementById("editTimingProfiles");
		const rapidRateInput = document.getElementById("rapidRate");
		const toolChangeSecondsInput = document.getElementById("toolChangeSeconds");
		const extraStationSecondsInput = document.getElementById("extraStationSeconds");
		const tableWrap = document.getElementById("chronobladeTableWrap");
		const tableBody = document.getElementById("chronobladeTableBody");
		const ROW_HEIGHT = 35;
		const ROW_OVERSCAN = 14;
		const collapsedSections = new Set();
		let visibleRows = [];
		const formatSignificantFigures = value => value.replace(/(-?\\d+)\\.(\\d+)/g, (_match, whole, fraction) => whole + "." + fraction.replace(/0+$/, ""));
		const updateSignificantFigures = () => {
			document.querySelectorAll("[data-significant-figures]").forEach(element => {
				const fullValue = element.dataset.fullValue || element.textContent;
				element.dataset.fullValue = fullValue;
				element.textContent = significantFiguresInput.checked ? formatSignificantFigures(fullValue) : fullValue;
			});
			renderVirtualRows();
		};
		const updateZeroTimeLabels = () => {
			rebuildVisibleRows();
		};

		significantFiguresInput.addEventListener("change", updateSignificantFigures);
		hideZeroTimeLabelsInput.addEventListener("change", updateZeroTimeLabels);
		const collectAnalysisOptions = () => ({ analysisMode: analysisModeSelect.value, showTraceLine: lineDataSelect.value === "trace", live: liveInput.checked, timingProfile: timingProfileSelect.value });
		const collectTimingOptions = () => Object.assign(collectAnalysisOptions(), {
			rapidRate: rapidRateInput.value,
			toolChangeSeconds: toolChangeSecondsInput.value,
			extraStationSeconds: extraStationSecondsInput.value
		});
		analysisModeSelect.addEventListener("change", () => {
			if (analysisModeSelect.value === "asWritten") lineDataSelect.value = "source";
			vscode.postMessage({ type: "setChronobladeAnalysis", options: collectAnalysisOptions() });
		});
		lineDataSelect.addEventListener("change", () => vscode.postMessage({ type: "setChronobladeAnalysis", options: collectAnalysisOptions() }));
		liveInput.addEventListener("change", () => vscode.postMessage({ type: "setChronobladeLive", options: collectAnalysisOptions() }));
		timingProfileSelect.addEventListener("change", () => vscode.postMessage({ type: "setChronobladeTimingProfile", options: collectAnalysisOptions() }));
		editTimingProfilesButton.addEventListener("click", () => vscode.postMessage({ type: "openChronobladeTimingProfiles" }));
		for (const input of [rapidRateInput, toolChangeSecondsInput, extraStationSecondsInput]) {
			input.addEventListener("change", () => vscode.postMessage({ type: "setChronobladeTiming", options: collectTimingOptions() }));
		}
		window.addEventListener("message", event => {
			const message = event.data;
			if (!message || message.type !== "liveTraceWarning") return;
			const warning = String(message.warning || "");
			const element = document.getElementById("liveWarning");
			if (!warning || !element) return;
			element.textContent = "⚠ TRACE WARNING";
			element.title = warning;
			element.hidden = false;
		});
		updateSignificantFigures();
		updateZeroTimeLabels();

		tableBody?.addEventListener("click", event => {
			const labelRow = event.target.closest(".label-row");
			if (!labelRow) {
				return;
			}

			const sectionId = Number(labelRow.dataset.sectionId);
			if (!Number.isFinite(sectionId)) return;
			if (collapsedSections.has(sectionId)) collapsedSections.delete(sectionId);
			else collapsedSections.add(sectionId);
			rebuildVisibleRows();
		});

		tableWrap?.addEventListener("scroll", renderVirtualRows);
		window.addEventListener("resize", renderVirtualRows);

		function rebuildVisibleRows() {
			const nextRows = [];
			let activeSectionId = -1;
			let hideActiveSection = false;
			let accumulatedTimeSeconds = 0;
			let accumulatedLabelTimeSeconds = 0;

			for (const row of chronobladeData.rows || []) {
				if (row.type === "label") {
					activeSectionId++;
					if (Number.isFinite(row.labelTotalTimeSeconds)) accumulatedLabelTimeSeconds += row.labelTotalTimeSeconds;
					hideActiveSection = hideZeroTimeLabelsInput.checked && Math.abs(Number(row.labelTotalTimeSeconds) || 0) < 0.000000001;
					if (!hideActiveSection) nextRows.push({ kind: "label", row, sectionId: activeSectionId, accumulatedLabelTimeSeconds });
					continue;
				}

				if (Number.isFinite(row.timeSeconds)) accumulatedTimeSeconds += row.timeSeconds;
				if (!hideActiveSection && !collapsedSections.has(activeSectionId)) nextRows.push({ kind: "row", row, accumulatedTimeSeconds });
			}

			visibleRows = nextRows;
			if (tableWrap) tableWrap.scrollTop = Math.min(tableWrap.scrollTop, Math.max(0, visibleRows.length * ROW_HEIGHT - tableWrap.clientHeight));
			renderVirtualRows();
		}

		function renderVirtualRows() {
			if (!tableWrap || !tableBody) return;
			const first = Math.max(0, Math.floor(tableWrap.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
			const count = Math.ceil(tableWrap.clientHeight / ROW_HEIGHT) + ROW_OVERSCAN * 2;
			const last = Math.min(visibleRows.length, first + Math.max(1, count));
			const rows = visibleRows.slice(first, last).map(renderVirtualRow).join("");
			tableBody.innerHTML = renderSpacerRow(first * ROW_HEIGHT) + rows + renderSpacerRow((visibleRows.length - last) * ROW_HEIGHT);
		}

		function renderVirtualRow(entry) {
			return entry.kind === "label" ? renderVirtualLabelRow(entry) : renderVirtualReportRow(entry);
		}

		function renderVirtualReportRow(entry) {
			const row = entry.row;
			return '<tr class="section-content">' + renderVirtualToolMarkerCell(row) + '<td class="tool-marker-gap"></td>' +
				'<td class="line-cell">' + escapeHtml(formatVirtualLine(row)) + '</td><td class="instruction-cell" title="' + escapeAttribute(row.instruction) + '"><code>' + escapeHtml(row.instruction) + '</code></td>' +
				'<td class="position-cell"><span class="cell-value">' + renderVirtualPositionCell(row.start) + '</span></td><td class="position-cell"><span class="cell-value">' + renderVirtualPositionCell(row.end) + '</span></td>' +
				'<td><span class="cell-value">' + escapeHtml(formatVirtualDistance(row)) + '</span></td><td><span class="cell-value">' + escapeHtml(formatVirtualFeed(row)) + '</span></td>' +
				'<td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(row.spindle || '-')) + '</span></td><td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(row.rpmUsed || '-')) + '</span></td>' +
				'<td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(formatVirtualTime(row.timeSeconds))) + '</span></td><td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(formatVirtualAccumulatedTime(entry.accumulatedTimeSeconds))) + '</span></td></tr>';
		}

		function renderVirtualLabelRow(entry) {
			const row = entry.row;
			const collapsed = collapsedSections.has(entry.sectionId);
			const total = Number.isFinite(entry.accumulatedLabelTimeSeconds) ? ' Total: ' + formatVirtualTime(entry.accumulatedLabelTimeSeconds) : '';
			return '<tr class="label-row" data-section-id="' + entry.sectionId + '">' + renderVirtualToolMarkerCell(row) + '<td class="tool-marker-gap"></td><td class="line-cell">' + escapeHtml(formatVirtualLine(row)) + '</td>' +
				'<td colspan="9"><button class="section-toggle" type="button" aria-expanded="' + String(!collapsed) + '" title="Collapse this label section"><span class="section-chevron" aria-hidden="true">' + (collapsed ? '&#9654;' : '&#9660;') + '</span><code>' + escapeHtml(row.instruction) + '</code>' + escapeHtml(row.comment ? ' ' + row.comment : '') + escapeHtml(total) + '</button></td></tr>';
		}

		function renderSpacerRow(height) {
			return height > 0 ? '<tr class="chronoblade-spacer" style="--chronoblade-spacer-height:' + Math.round(height) + 'px"><td colspan="12"></td></tr>' : '';
		}

		function renderVirtualToolMarkerCell(row) {
			return '<td class="tool-marker-cell"' + (row.toolColor ? ' style="background:' + escapeAttribute(row.toolColor) + '"' : '') + '></td>';
		}

		function renderVirtualPositionCell(positionText) {
			if (!positionText) return '-';
			return escapeHtml(formatVirtualSignificant(String(positionText))).replace(/([XYZ])([^XYZ\\s]+)/gi, (_match, axis, value) => '<span class="coord axis-' + axis.toLowerCase() + '"><span class="axis-letter">' + axis.toUpperCase() + '</span>' + value + '</span>');
		}

		function formatVirtualDistance(row) {
			if (row.type === 'tool') return 'Tool change';
			if (Number.isFinite(row.distance) && Math.abs(row.distance) < 0.000000001) return '0.00';
			return Number.isFinite(row.distance) ? formatVirtualNumber(row.distance) : 'unknown';
		}

		function formatVirtualLine(row) {
			const trace = chronobladeData.lineData === "trace" && Number.isFinite(row.executionIndex);
			const value = trace ? row.executionIndex + 1 : (row.sourceLineNumber || row.lineNumber);
			return (trace ? "T" : "S") + String(value).padStart(3, "0");
		}

		function formatVirtualFeed(row) {
			return Number.isFinite(row.feed) ? (row.feedModeWord || (row.feedMode === 'perRev' ? 'Feed/rev' : 'Feed/min')) + ' F' + formatVirtualNumber(row.feed) : '-';
		}

		function formatVirtualAccumulatedTime(seconds) {
			return Number.isFinite(seconds) && seconds > 0 ? formatVirtualTime(seconds) : '-';
		}

		function formatVirtualTime(seconds) {
			if (!Number.isFinite(seconds)) return '-';
			if (seconds < 60) return seconds.toFixed(2) + ' s';
			const minutes = Math.floor(seconds / 60);
			return minutes + ' min ' + (seconds - minutes * 60).toFixed(1) + ' s';
		}

		function formatVirtualNumber(value) {
			const minimum = Math.max(0, Math.min(9, Math.trunc(Number(chronobladeData.humanFormat.minimumDecimalPlaces) || 0)));
			const maximum = Math.max(minimum, Math.min(9, Math.trunc(Number(chronobladeData.humanFormat.maximumDecimalPlaces) || minimum)));
			const rounded = Number(value).toFixed(maximum);
			if (maximum === minimum) return minimum === 0 ? rounded + '.' : rounded;
			const parts = rounded.split('.');
			const fraction = parts[1].replace(/0+$/, '').padEnd(minimum, '0');
			return fraction ? parts[0] + '.' + fraction : (minimum === 0 ? parts[0] + '.' : parts[0]);
		}

		function formatVirtualSignificant(value) {
			return significantFiguresInput.checked ? formatSignificantFigures(String(value)) : String(value);
		}

		function escapeHtml(text) {
			return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
		}

		function escapeAttribute(text) { return escapeHtml(text); }

		rebuildVisibleRows();
	</script>
</body>
</html>`;
}

function renderMetric(label, value, tooltip = "") {
	return `<div class="metric"${tooltip ? ` title="${escapeAttribute(tooltip)}"` : ""}>
		<div class="metric-value" data-significant-figures>${escapeHtml(value)}</div>
		<div class="metric-label">${escapeHtml(label)}</div>
	</div>`;
}

function renderRows(rows, humanFormat) {
	if (!rows.length) {
		return "<p class=\"empty\">No motion or tool-change rows found.</p>";
	}

	return `<div id="chronobladeTableWrap" class="table-wrap">
		<table class="chronoblade-table">
			<colgroup>
				<col class="tool-marker-header">
				<col class="tool-marker-gap">
				<col style="width:5ch; min-width:5ch">
				<col style="width:7ch; min-width:7ch">
				<col style="width:18ch; min-width:18ch">
				<col style="width:18ch; min-width:18ch">
				<col style="width:9ch; min-width:9ch">
				<col style="width:10ch; min-width:10ch">
				<col style="width:12ch; min-width:12ch">
				<col>
				<col>
				<col>
			</colgroup>
			<thead>
				<tr>
					<th class="tool-marker-header"></th>
					<th class="tool-marker-gap"></th>
					<th class="line-column">Line</th>
					<th class="code-column">Code</th>
					<th style="width:18ch">Start</th>
					<th style="width:18ch">End</th>
					<th style="width:9ch">Distance</th>
					<th style="width:10ch">Feed</th>
					<th style="width:12ch">Spindle</th>
					<th>RPM Used</th>
					<th>Time</th>
					<th>Total</th>
				</tr>
			</thead>
			<tbody id="chronobladeTableBody"></tbody>
		</table>
	</div>`;
}

function renderSectionGroups(sections) {
	let accumulatedLabelTimeSeconds = 0;

	return sections.map((section, index) => {
		if (Number.isFinite(section.label.labelTotalTimeSeconds)) {
			accumulatedLabelTimeSeconds += section.label.labelTotalTimeSeconds;
		}

		return `<tbody class="section-group" data-section-id="${index}" data-zero-time="${isZeroTimeSection(section.label)}">
			${renderLabelRow(section.label, index, accumulatedLabelTimeSeconds)}
			${section.rows.join("")}
		</tbody>`;
	});
}

function renderLabelRow(row, sectionId, accumulatedLabelTimeSeconds) {
	const comment = row.comment ? ` ${row.comment}` : "";
	const total = Number.isFinite(accumulatedLabelTimeSeconds)
		? ` Total: ${formatTime(accumulatedLabelTimeSeconds)}`
		: "";

	return `<tr class="label-row" data-section-id="${sectionId}">
		${renderToolMarkerCell(row)}
		<td class="tool-marker-gap"></td>
		<td class="line-cell">${escapeHtml(row.lineNumber)}</td>
		<td colspan="9"><button class="section-toggle" type="button" aria-expanded="true" title="Collapse this label section"><span class="section-chevron" aria-hidden="true">&#9660;</span><code>${escapeHtml(row.instruction)}</code>${escapeHtml(comment)}${escapeHtml(total)}</button></td>
	</tr>`;
}

function isZeroTimeSection(row) {
	return Number.isFinite(row.labelTotalTimeSeconds) && Math.abs(row.labelTotalTimeSeconds) < 0.000000001;
}

function renderToolMarkerCell(row) {
	const style = row.toolColor ? ` style="background:${escapeAttribute(row.toolColor)}"` : "";

	return `<td class="tool-marker-cell"${style}></td>`;
}

function renderPositionCell(positionText) {
	if (!positionText) {
		return "-";
	}

	const text = String(positionText);
	const parts = [];
	const coordinateRegex = /([XYZ])([^XYZ\s]+)/gi;
	let lastIndex = 0;
	let match;

	while ((match = coordinateRegex.exec(text)) !== null) {
		parts.push(escapeHtml(text.slice(lastIndex, match.index)));
		parts.push(renderCoordinateWord(match[1], match[2]));
		lastIndex = coordinateRegex.lastIndex;
	}

	parts.push(escapeHtml(text.slice(lastIndex)));

	return parts.join("") || "-";
}

function renderCoordinateWord(axis, valueText) {
	const normalizedAxis = String(axis).toLowerCase();

	return `<span class="coord axis-${escapeAttribute(normalizedAxis)}"><span class="axis-letter">${escapeHtml(axis.toUpperCase())}</span><span data-significant-figures>${escapeHtml(valueText)}</span></span>`;
}

function formatFeed(row, humanFormat) {
	if (!Number.isFinite(row.feed)) {
		return "-";
	}

	return `${row.feedModeWord || (row.feedMode === "perRev" ? "Feed/rev" : "Feed/min")} F${formatNumber(row.feed, humanFormat)}`;
}

function formatAccumulatedTime(seconds) {
	return Number.isFinite(seconds) && seconds > 0 ? formatChronobladeTime(seconds) : "-";
}

function formatChronobladeTime(seconds) {
	return Number.isFinite(seconds) ? formatTime(seconds) : "-";
}

function formatChronobladeMetricTime(seconds) {
	if (!Number.isFinite(seconds)) {
		return "-";
	}
	if (seconds < 60) {
		return `${seconds.toFixed(2)} s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes} m ${(seconds - minutes * 60).toFixed(1)} s`;
}

function formatDistance(row, humanFormat) {
	if (row.type === "tool") {
		return "Tool change";
	}

	if (isZeroDistance(row)) {
		return "0.00";
	}

	return formatNumber(row.distance, humanFormat);
}

function isZeroDistance(row) {
	return Number.isFinite(row.distance) && Math.abs(row.distance) < 0.000000001;
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeAttribute(text) {
	return escapeHtml(text);
}

function escapeScriptJson(value) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

module.exports = {
	registerChronobladeWebview
};
