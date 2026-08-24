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
		});

	} else {
		chronobladePanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderChronobladePanel(editor, mode, options);
}

async function renderChronobladePanel(editor, mode, options) {
	const range = getRangeForMode(editor, mode);

	if (mode === "selection" && !range) {
		vscode.window.showWarningMessage("Select a G-code section before sending the selection to Chronoblade.");
		return;
	}

	const result = analyzeChronobladeRange(editor.document, range, options);

	chronobladePanel.title = "KAIJU Chronoblade";
	chronobladePanel.webview.html = renderChronobladeHtml(options, result);
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

function renderChronobladeHtml(options, result) {
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
			padding: 2px 16px 16px;
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
			margin: 14px 0;
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
			flex: 0 0 112px;
			margin: 0;
		}

		.checkbox {
			display: flex;
			align-items: center;
			gap: 6px;
			min-height: 28px;
			white-space: nowrap;
		}

		.table-wrap {
			overflow: auto;
			max-height: 68vh;
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
			${renderMetric("Other", formatChronobladeMetricTime(summary.otherTimeSeconds), "Reserved for future time categories not currently tracked by Chronoblade.")}
		</section>
		<div class="timing-controls">
			<label class="timing-control">G0 rate
				<input id="rapidRate" type="number" min="0" step="100" value="${escapeHtml(options.rapidRate)}" title="Rapid-traverse rate used to estimate G0 moves, in program units per minute.">
			</label>
			<label class="timing-control">Tool swap
				<input id="toolChangeSeconds" type="number" min="0" step="0.1" value="${escapeHtml(options.toolChangeSeconds)}" title="Base time added for each tool change, in seconds.">
			</label>
			<label class="timing-control">Extra station
				<input id="extraStationSeconds" type="number" min="0" step="0.1" value="${escapeHtml(options.extraStationSeconds)}" title="Additional time for each turret station beyond an adjacent tool swap, in seconds.">
			</label>
		</div>
		<div class="report-toggles">
			<label class="checkbox" title="Show values without insignificant trailing fractional zeros while retaining a decimal point."><input id="significantFigures" type="checkbox"${options.significantFiguresOnly ? " checked" : ""}> Trim zeros</label>
			<label class="checkbox" title="Hide N-label sections whose total estimated time is zero."><input id="hideZeroTimeLabels" type="checkbox"${options.hideZeroTimeLabels ? " checked" : ""}> Hide zero labels</label>
		</div>
	</section>

	${renderRows(result.rows, options.humanFormat)}
	<script type="application/json" id="chronoblade-data">${escapeScriptJson({ rows: result.rows, humanFormat: options.humanFormat })}</script>

	<script>
		const chronobladeData = JSON.parse(document.getElementById("chronoblade-data").textContent);
		const significantFiguresInput = document.getElementById("significantFigures");
		const hideZeroTimeLabelsInput = document.getElementById("hideZeroTimeLabels");
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
				'<td class="line-cell">' + escapeHtml(row.lineNumber) + '</td><td class="instruction-cell" title="' + escapeAttribute(row.instruction) + '"><code>' + escapeHtml(row.instruction) + '</code></td>' +
				'<td class="position-cell"><span class="cell-value">' + renderVirtualPositionCell(row.start) + '</span></td><td class="position-cell"><span class="cell-value">' + renderVirtualPositionCell(row.end) + '</span></td>' +
				'<td><span class="cell-value">' + escapeHtml(formatVirtualDistance(row)) + '</span></td><td><span class="cell-value">' + escapeHtml(formatVirtualFeed(row)) + '</span></td>' +
				'<td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(row.spindle || '-')) + '</span></td><td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(row.rpmUsed || '-')) + '</span></td>' +
				'<td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(formatVirtualTime(row.timeSeconds))) + '</span></td><td><span class="cell-value">' + escapeHtml(formatVirtualSignificant(formatVirtualAccumulatedTime(entry.accumulatedTimeSeconds))) + '</span></td></tr>';
		}

		function renderVirtualLabelRow(entry) {
			const row = entry.row;
			const collapsed = collapsedSections.has(entry.sectionId);
			const total = Number.isFinite(entry.accumulatedLabelTimeSeconds) ? ' Total: ' + formatVirtualTime(entry.accumulatedLabelTimeSeconds) : '';
			return '<tr class="label-row" data-section-id="' + entry.sectionId + '">' + renderVirtualToolMarkerCell(row) + '<td class="tool-marker-gap"></td><td class="line-cell">' + escapeHtml(row.lineNumber) + '</td>' +
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

		function formatVirtualFeed(row) {
			return Number.isFinite(row.feed) ? (row.feedMode === 'perRev' ? 'G95' : 'G94') + ' F' + formatVirtualNumber(row.feed) : '-';
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

	return `${row.feedMode === "perRev" ? "G95" : "G94"} F${formatNumber(row.feed, humanFormat)}`;
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
