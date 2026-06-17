// Role: render and run KAIJU Chronoblade cycle-time reports. Keep shared
// motion interpretation in MetaMotionEngine.js and machine defaults in
// MetaMachineMode.js.
const vscode = require("vscode");
const {
	analyzeChronobladeRange,
	formatNumber,
	formatTime
} = require("../MetaMotionEngine");
const { getChronobladeOptions } = require("./options");

let chronobladePanel;
let chronobladeState;

function registerChronobladeWebview(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.chronoblade", async () => {
			await runChronoblade();
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
	const options = getChronobladeOptions(editor.document);

	await showChronobladePanel(editor, mode, options);
}

async function showChronobladePanel(editor, mode, options) {
	chronobladeState = {
		documentUriText: editor.document.uri.toString(),
		mode,
		options
	};

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
			if (!message || !["whole", "selection"].includes(message.type)) {
				return;
			}

			await renderFromActiveEditor(message.type, message.options || {});
		});
	} else {
		chronobladePanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderChronobladePanel(editor, mode, options);
}

async function renderFromActiveEditor(mode, rawOptions) {
	const editor = getChronobladeSourceEditor();

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Focus a G-code document before sending it to Chronoblade.");
		return;
	}

	const options = getChronobladeOptions(editor.document, rawOptions);

	chronobladeState = {
		documentUriText: editor.document.uri.toString(),
		mode,
		options
	};

	await renderChronobladePanel(editor, mode, options);
}

function getChronobladeSourceEditor() {
	const stateUriText = chronobladeState && chronobladeState.documentUriText;
	const visibleEditor = stateUriText
		? vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === stateUriText)
		: undefined;

	if (visibleEditor) {
		return visibleEditor;
	}

	return vscode.window.activeTextEditor;
}

async function renderChronobladePanel(editor, mode, options) {
	const range = getRangeForMode(editor, mode);

	if (mode === "selection" && !range) {
		vscode.window.showWarningMessage("Select a G-code section before sending the selection to Chronoblade.");
		return;
	}

	const result = analyzeChronobladeRange(editor.document, range, options);

	chronobladePanel.title = "KAIJU Chronoblade";
	chronobladePanel.webview.html = renderChronobladeHtml(editor.document, mode, options, result);
	await compactChronobladePanelEditorGroup(options);
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

function renderChronobladeHtml(document, mode, options, result) {
	const rangeText = result.range.startLine === 0 && result.range.endLine === document.lineCount - 1
		? "Whole program"
		: `Lines ${result.range.startLine + 1}-${result.range.endLine + 1}`;
	const summary = result.summary;

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
			border-bottom: 1px solid var(--vscode-panel-border);
			padding-bottom: 12px;
			margin-bottom: 14px;
		}

		h1 {
			font-size: 18px;
			margin: 0 0 4px;
		}

		.meta,
		.empty,
		.note {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}

		.controls {
			display: grid;
			grid-template-columns: repeat(3, minmax(120px, 1fr));
			gap: 10px;
			margin: 14px 0;
		}

		label {
			display: grid;
			gap: 4px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		input {
			box-sizing: border-box;
			width: 100%;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			padding: 5px 6px;
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 14px;
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
			grid-template-columns: repeat(5, minmax(90px, 1fr));
			gap: 8px;
			margin-bottom: 14px;
		}

		.metric {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 8px;
		}

		.metric-value {
			font-size: 14px;
			font-weight: 600;
		}

		.metric-label {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			margin-top: 2px;
		}

		.table-wrap {
			overflow: auto;
			max-height: 68vh;
			border-top: 1px solid var(--vscode-panel-border);
		}

		table {
			width: 100%;
			border-collapse: collapse;
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

		td.notes {
			white-space: normal;
			min-width: 18ch;
		}

		code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 1px 4px;
			border-radius: 3px;
		}

		@media (max-width: 720px) {
			.controls,
			.summary {
				grid-template-columns: 1fr;
			}
		}
	</style>
</head>
<body>
	<header>
		<h1>KAIJU Chronoblade</h1>
		<div class="meta">${escapeHtml(rangeText)} from ${escapeHtml(document.fileName || document.uri.toString())}</div>
		<div class="meta">${escapeHtml(mode === "selection" ? "Selection report" : "Whole program report")}</div>
	</header>

	<section class="controls">
		<label>G0 rate
			<input id="rapidRate" type="number" min="0" step="100" value="${escapeHtml(options.rapidRate)}">
		</label>
		<label>Tool swap time
			<input id="toolChangeSeconds" type="number" min="0" step="0.1" value="${escapeHtml(options.toolChangeSeconds)}">
		</label>
		<label>Extra station time
			<input id="extraStationSeconds" type="number" min="0" step="0.1" value="${escapeHtml(options.extraStationSeconds)}">
		</label>
	</section>

	<div class="actions">
		<button id="whole">Send Whole Program</button>
		<button id="selection">Send Selection</button>
		<span class="note">G0 rate uses program units per minute. Tool times are seconds.</span>
	</div>

	<section class="summary">
		${renderMetric("Total", formatTime(summary.totalTimeSeconds))}
		${renderMetric("Cutting", formatTime(summary.cuttingTimeSeconds))}
		${renderMetric("G0", formatTime(summary.rapidTimeSeconds))}
		${renderMetric("Tool", formatTime(summary.toolTimeSeconds))}
		${renderMetric("Distance", formatNumber(summary.totalDistance))}
	</section>

	${summary.unknownTimeRows ? `<p class="note">${escapeHtml(summary.unknownTimeRows)} row(s) have unknown time because required motion data is missing.</p>` : ""}
	${renderRows(result.rows)}

	<script>
		const vscode = acquireVsCodeApi();
		const readOptions = () => ({
			rapidRate: document.getElementById("rapidRate").value,
			toolChangeSeconds: document.getElementById("toolChangeSeconds").value,
			extraStationSeconds: document.getElementById("extraStationSeconds").value
		});

		document.getElementById("whole").addEventListener("click", () => {
			vscode.postMessage({ type: "whole", options: readOptions() });
		});

		document.getElementById("selection").addEventListener("click", () => {
			vscode.postMessage({ type: "selection", options: readOptions() });
		});
	</script>
</body>
</html>`;
}

function renderMetric(label, value) {
	return `<div class="metric">
		<div class="metric-value">${escapeHtml(value)}</div>
		<div class="metric-label">${escapeHtml(label)}</div>
	</div>`;
}

function renderRows(rows) {
	if (!rows.length) {
		return "<p class=\"empty\">No motion or tool-change rows found.</p>";
	}

	const body = rows.map(row => {
		return `<tr>
			<td>${escapeHtml(row.lineNumber)}</td>
			<td><code>${escapeHtml(row.instruction)}</code></td>
			<td>${escapeHtml(row.start || "-")}</td>
			<td>${escapeHtml(row.end || "-")}</td>
			<td>${escapeHtml(formatNumber(row.distance))}</td>
			<td>${escapeHtml(formatFeed(row))}</td>
			<td>${escapeHtml(row.spindle || "-")}</td>
			<td>${escapeHtml(row.rpmUsed || "-")}</td>
			<td>${escapeHtml(formatTime(row.timeSeconds))}</td>
			<td class="notes">${escapeHtml((row.warnings || []).join(" ")) || "-"}</td>
		</tr>`;
	}).join("");

	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Line</th>
					<th>Instruction</th>
					<th>Start</th>
					<th>End</th>
					<th>Distance</th>
					<th>Feed</th>
					<th>Spindle</th>
					<th>RPM Used</th>
					<th>Time</th>
					<th>Notes</th>
				</tr>
			</thead>
			<tbody>${body}</tbody>
		</table>
	</div>`;
}

function formatFeed(row) {
	if (!Number.isFinite(row.feed)) {
		return "-";
	}

	return `${formatNumber(row.feed)} ${row.feedMode === "perRev" ? "per rev" : "per min"}`;
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

module.exports = {
	registerChronobladeWebview
};
