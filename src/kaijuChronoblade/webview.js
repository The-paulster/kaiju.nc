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
			grid-template-columns: repeat(6, minmax(0, 1fr));
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

		.report-toggles {
			display: flex;
			flex-wrap: wrap;
			gap: 14px;
			margin: -6px 0 14px;
		}

		.checkbox {
			display: flex;
			align-items: center;
			gap: 6px;
			min-height: 28px;
		}

		.table-wrap {
			overflow: auto;
			max-height: 68vh;
			border-top: 1px solid var(--vscode-panel-border);
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
		${renderMetric("Total", formatChronobladeTime(summary.totalTimeSeconds))}
		${renderMetric("Cutting", formatChronobladeTime(summary.cuttingTimeSeconds))}
		${renderMetric("G0", formatChronobladeTime(summary.rapidTimeSeconds))}
		${renderMetric("Dwell", formatChronobladeTime(summary.dwellTimeSeconds))}
		${renderMetric("Tool", formatChronobladeTime(summary.toolTimeSeconds))}
		${renderMetric("Distance", formatNumber(summary.totalDistance, options.humanFormat))}
	</section>

	<div class="report-toggles">
		<label class="checkbox"><input id="significantFigures" type="checkbox"${options.significantFiguresOnly ? " checked" : ""}> Significant figures only</label>
		<label class="checkbox"><input id="hideZeroTimeLabels" type="checkbox"${options.hideZeroTimeLabels ? " checked" : ""}> Hide labels with zero time</label>
	</div>

	${renderRows(result.rows, options.humanFormat)}

	<script>
		const vscode = acquireVsCodeApi();
		const significantFiguresInput = document.getElementById("significantFigures");
		const hideZeroTimeLabelsInput = document.getElementById("hideZeroTimeLabels");
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

		const formatSignificantFigures = value => value.replace(/(-?\\d+)\\.(\\d+)/g, (_match, whole, fraction) => whole + "." + fraction.replace(/0+$/, ""));
		const updateSignificantFigures = () => {
			document.querySelectorAll("[data-significant-figures]").forEach(element => {
				const fullValue = element.dataset.fullValue || element.textContent;
				element.dataset.fullValue = fullValue;
				element.textContent = significantFiguresInput.checked ? formatSignificantFigures(fullValue) : fullValue;
			});
		};
		const updateZeroTimeLabels = () => {
			document.body.classList.toggle("hide-zero-time-labels", hideZeroTimeLabelsInput.checked);
		};

		significantFiguresInput.addEventListener("change", updateSignificantFigures);
		hideZeroTimeLabelsInput.addEventListener("change", updateZeroTimeLabels);
		updateSignificantFigures();
		updateZeroTimeLabels();

		document.querySelector(".chronoblade-table")?.addEventListener("click", event => {
			const labelRow = event.target.closest(".label-row");
			if (!labelRow) {
				return;
			}

			const toggle = labelRow.querySelector(".section-toggle");
			const group = labelRow.closest(".section-group");
			const isCollapsed = group.classList.toggle("is-collapsed");

			toggle.setAttribute("aria-expanded", String(!isCollapsed));
			toggle.querySelector(".section-chevron").textContent = String.fromCharCode(isCollapsed ? 9654 : 9660);
		});
	</script>
</body>
</html>`;
}

function renderMetric(label, value) {
	return `<div class="metric">
		<div class="metric-value" data-significant-figures>${escapeHtml(value)}</div>
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
	const unlabelledRows = [];
	const sections = [];
	let activeSection;

	for (const row of rows) {
		if (row.type === "label") {
			activeSection = { label: row, rows: [] };
			sections.push(activeSection);
			continue;
		}

		if (Number.isFinite(row.timeSeconds)) {
			accumulatedTimeSeconds += row.timeSeconds;
		}

		const renderedRow = `<tr class="section-content">
			${renderToolMarkerCell(row)}
			<td class="tool-marker-gap"></td>
			<td class="line-cell">${escapeHtml(row.lineNumber)}</td>
			<td class="instruction-cell" title="${escapeAttribute(row.instruction)}"><code>${escapeHtml(row.instruction)}</code></td>
			<td class="position-cell"><span class="cell-value">${renderPositionCell(row.start)}</span></td>
			<td class="position-cell"><span class="cell-value">${renderPositionCell(row.end)}</span></td>
			<td><span class="cell-value" data-significant-figures>${escapeHtml(formatDistance(row, humanFormat))}</span></td>
			<td><span class="cell-value" data-significant-figures>${escapeHtml(formatFeed(row, humanFormat))}</span></td>
			<td><span class="cell-value" data-significant-figures>${escapeHtml(row.spindle || "-")}</span></td>
			<td><span class="cell-value" data-significant-figures>${escapeHtml(row.rpmUsed || "-")}</span></td>
			<td><span class="cell-value" data-significant-figures>${escapeHtml(formatChronobladeTime(row.timeSeconds))}</span></td>
			<td><span class="cell-value" data-significant-figures>${escapeHtml(formatAccumulatedTime(accumulatedTimeSeconds))}</span></td>
		</tr>`;

		if (activeSection) {
			activeSection.rows.push(renderedRow);
		} else {
			unlabelledRows.push(renderedRow);
		}
	}

	const body = [
		unlabelledRows.length ? `<tbody>${unlabelledRows.join("")}</tbody>` : "",
		...renderSectionGroups(sections)
	].join("");

	return `<div class="table-wrap">
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
			${body}
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

	return `${row.feedMode === "perRev" ? "G95" : "G94"} F${formatNumber(row.feed, humanFormat)}`;
}

function formatAccumulatedTime(seconds) {
	return Number.isFinite(seconds) && seconds > 0 ? formatChronobladeTime(seconds) : "-";
}

function formatChronobladeTime(seconds) {
	return Number.isFinite(seconds) ? formatTime(seconds) : "-";
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
