// Role: render and run KAIJU Chronoblade cycle-time reports. Keep shared
// motion interpretation in MetaMotionEngine.js and machine defaults in
// MetaMachineMode.js.
const vscode = require("vscode");
const path = require("path");
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
	const sourceName = getChronobladeSourceName(document);
	const reportLabel = mode === "selection" ? "Selection report" : "Whole program report";
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

		.meta-line {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
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
			table-layout: fixed;
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

		.instruction-cell {
			width: 7ch;
			max-width: 7ch;
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

		.instruction-cell code,
		.truncate {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
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
		<div class="meta meta-line" title="${escapeAttribute(`${rangeText} from ${sourceName}`)}">${escapeHtml(rangeText)} from ${escapeHtml(sourceName)}</div>
		<div class="meta meta-line" title="${escapeAttribute(reportLabel)}">${escapeHtml(reportLabel)}</div>
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
		${renderMetric("Dwell", formatTime(summary.dwellTimeSeconds))}
		${renderMetric("Tool", formatTime(summary.toolTimeSeconds))}
		${renderMetric("Distance", formatNumber(summary.totalDistance, options.humanFormat))}
	</section>

	${summary.unknownTimeRows ? `<p class="note">${escapeHtml(summary.unknownTimeRows)} row(s) have unknown time because required motion data is missing.</p>` : ""}
	${renderRows(result.rows, options.humanFormat)}

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

function getChronobladeSourceName(document) {
	if (document.fileName) {
		return path.basename(document.fileName).replace(/\.decomposition\.gcode$/i, "");
	}

	const uriText = document.uri && document.uri.toString ? document.uri.toString() : "";
	const uriTail = uriText.split(/[\\/]/).pop() || uriText;

	return uriTail.replace(/\.decomposition\.gcode$/i, "") || "untitled";
}

function renderRows(rows, humanFormat) {
	if (!rows.length) {
		return "<p class=\"empty\">No motion or tool-change rows found.</p>";
	}

	let accumulatedTimeSeconds = 0;
	const body = rows.map(row => {
		if (row.type === "label") {
			const comment = row.comment ? ` ${row.comment}` : "";
			const total = Number.isFinite(row.labelTotalTimeSeconds)
				? ` Total: ${formatTime(row.labelTotalTimeSeconds)}`
				: "";

			return `<tr class="label-row">
				${renderToolMarkerCell(row)}
				<td class="tool-marker-gap"></td>
				<td>${escapeHtml(row.lineNumber)}</td>
				<td colspan="9"><span class="truncate" title="${escapeAttribute(`${row.instruction}${comment}${total}`)}"><code>${escapeHtml(row.instruction)}</code>${escapeHtml(comment)}${escapeHtml(total)}</span></td>
			</tr>`;
		}

		if (Number.isFinite(row.timeSeconds)) {
			accumulatedTimeSeconds += row.timeSeconds;
		}

		return `<tr>
			${renderToolMarkerCell(row)}
			<td class="tool-marker-gap"></td>
			<td>${escapeHtml(row.lineNumber)}</td>
			<td class="instruction-cell" title="${escapeAttribute(row.instruction)}"><code>${escapeHtml(row.instruction)}</code></td>
			<td class="position-cell">${renderPositionCell(row.start)}</td>
			<td class="position-cell">${renderPositionCell(row.end)}</td>
			<td>${escapeHtml(formatDistance(row, humanFormat))}</td>
			<td>${escapeHtml(formatFeed(row, humanFormat))}</td>
			<td>${escapeHtml(row.spindle || "-")}</td>
			<td>${escapeHtml(row.rpmUsed || "-")}</td>
			<td>${escapeHtml(formatTime(row.timeSeconds))}</td>
			<td>${escapeHtml(formatAccumulatedTime(accumulatedTimeSeconds))}</td>
		</tr>`;
	}).join("");

	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="tool-marker-header"></th>
					<th class="tool-marker-gap"></th>
					<th style="width:5ch">Line</th>
					<th style="width:7ch">Code</th>
					<th style="width:18ch">Start</th>
					<th style="width:18ch">End</th>
					<th style="width:9ch">Distance</th>
					<th style="width:10ch">Feed</th>
					<th style="width:15ch">Spindle</th>
					<th style="width:15ch">RPM Used</th>
					<th style="width:10ch">Time</th>
					<th style="width:10ch">Total</th>
				</tr>
			</thead>
			<tbody>${body}</tbody>
		</table>
	</div>`;
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

	return `<span class="coord axis-${escapeAttribute(normalizedAxis)}"><span class="axis-letter">${escapeHtml(axis.toUpperCase())}</span>${escapeHtml(valueText)}</span>`;
}

function formatFeed(row, humanFormat) {
	if (!Number.isFinite(row.feed)) {
		return "-";
	}

	return `${row.feedMode === "perRev" ? "G95" : "G94"} F${formatNumber(row.feed, humanFormat)}`;
}

function formatAccumulatedTime(seconds) {
	return Number.isFinite(seconds) && seconds > 0 ? formatTime(seconds) : "-";
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

module.exports = {
	registerChronobladeWebview
};
