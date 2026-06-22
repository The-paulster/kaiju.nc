// Role: render and run KAIJU Vision motion-table reports. Keep shared motion
// interpretation in MetaMotionEngine.js and machine defaults in
// MetaMachineMode.js.
const path = require("path");
const vscode = require("vscode");
const {
	analyzeVisionRange,
	formatNumber,
	summarizeVisionRows
} = require("../MetaMotionEngine");
const { getVisionOptions } = require("./options");

let visionPanel;
let visionState;

function registerKaijuVisionWebview(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.vision", async () => {
			await runKaijuVision();
		})
	);
}

async function runKaijuVision() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before running KAIJU Vision.");
		return;
	}

	const mode = editor.selection && !editor.selection.isEmpty ? "selection" : "whole";
	const options = getVisionOptions(editor.document);

	await showVisionPanel(editor, mode, options);
}

async function showVisionPanel(editor, mode, options) {
	visionState = {
		documentUriText: editor.document.uri.toString(),
		mode,
		options
	};

	if (!visionPanel) {
		visionPanel = vscode.window.createWebviewPanel(
			"kaijuVision",
			"KAIJU Vision",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		visionPanel.onDidDispose(() => {
			visionPanel = undefined;
			visionState = undefined;
		});

		visionPanel.webview.onDidReceiveMessage(async message => {
			if (!message) {
				return;
			}

			if (message.type === "saveSvg") {
				await saveVisionSvg(message.svg, message.plane);
				return;
			}

			if (["whole", "selection"].includes(message.type)) {
				await renderFromActiveEditor(message.type, message.options || {});
			}
		});
	} else {
		visionPanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderVisionPanel(editor, mode, options);
}

async function renderFromActiveEditor(mode, rawOptions) {
	const editor = getVisionSourceEditor();

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Focus a G-code document before sending it to KAIJU Vision.");
		return;
	}

	const options = getVisionOptions(editor.document, rawOptions);

	visionState = {
		documentUriText: editor.document.uri.toString(),
		mode,
		options
	};

	await renderVisionPanel(editor, mode, options);
}

function getVisionSourceEditor() {
	const stateUriText = visionState && visionState.documentUriText;
	const visibleEditor = stateUriText
		? vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === stateUriText)
		: undefined;

	if (visibleEditor) {
		return visibleEditor;
	}

	return vscode.window.activeTextEditor;
}

async function renderVisionPanel(editor, mode, options) {
	const range = getRangeForMode(editor, mode);

	if (mode === "selection" && !range) {
		vscode.window.showWarningMessage("Select a G-code section before sending the selection to KAIJU Vision.");
		return;
	}

	const result = analyzeVisionRange(editor.document, range, options);

	visionPanel.title = "KAIJU Vision";
	visionPanel.webview.html = renderVisionHtml(editor.document, mode, options, result);
	await compactVisionPanelEditorGroup(options);
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

async function compactVisionPanelEditorGroup(options) {
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
		// Editor layout commands are best-effort; Vision still works without resizing.
	}
}

function isSimpleSideBySideLayout(layout) {
	return layout
		&& layout.orientation === 0
		&& Array.isArray(layout.groups)
		&& layout.groups.length === 2
		&& layout.groups.every(group => !Array.isArray(group.groups));
}

async function saveVisionSvg(svg, plane) {
	if (!svg || typeof svg !== "string") {
		vscode.window.showWarningMessage("KAIJU Vision has no SVG to save.");
		return;
	}

	const editor = getVisionSourceEditor();
	const sourceName = editor && editor.document && editor.document.fileName
		? path.basename(editor.document.fileName, path.extname(editor.document.fileName))
		: "kaiju-vision";
	const suggestedName = `${sanitizeFileName(sourceName)}_kaiju-vision_${plane || "xz"}.svg`;
	const defaultUri = editor && editor.document && editor.document.uri && editor.document.uri.scheme === "file"
		? vscode.Uri.file(path.join(path.dirname(editor.document.fileName), suggestedName))
		: undefined;
	const targetUri = await vscode.window.showSaveDialog({
		defaultUri,
		filters: {
			"SVG image": ["svg"]
		}
	});

	if (!targetUri) {
		return;
	}

	const svgText = svg.trim().startsWith("<?xml")
		? svg
		: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;

	await vscode.workspace.fs.writeFile(targetUri, Buffer.from(svgText, "utf8"));
	vscode.window.showInformationMessage(`KAIJU Vision saved ${path.basename(targetUri.fsPath || targetUri.path)}.`);
}

function sanitizeFileName(name) {
	return String(name || "kaiju-vision")
		.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "") || "kaiju-vision";
}

function renderVisionHtml(document, mode, options, result) {
	const rangeText = result.range.startLine === 0 && result.range.endLine === document.lineCount - 1
		? "Whole program"
		: `Lines ${result.range.startLine + 1}-${result.range.endLine + 1}`;
	const summary = summarizeVisionRows(result.rows);
	const payload = {
		rows: result.rows,
		options,
		rangeText,
		sourceName: document.fileName || document.uri.toString(),
		summary
	};

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		:root {
			--rapid: #ff8800;
			--cut: #ffd500;
			--axis-x: #D65D5D;
			--axis-y: #6A9955;
			--axis-z: #4A90E2;
			--vision-row-height: 26px;
		}

		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 16px;
			box-sizing: border-box;
			height: 100vh;
			overflow: hidden;
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
			flex-wrap: wrap;
			align-items: end;
			gap: 10px;
			margin: 0 0 10px;
		}

		label {
			display: grid;
			gap: 4px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		select {
			box-sizing: border-box;
			min-width: 110px;
			color: var(--vscode-dropdown-foreground);
			background: var(--vscode-dropdown-background);
			border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
			padding: 5px 6px;
		}

		.checkbox {
			display: flex;
			align-items: center;
			gap: 6px;
			min-height: 28px;
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
			flex: 0 0 auto;
			display: flex;
			flex-wrap: wrap;
			gap: 14px;
			margin: 0 0 12px;
			font-size: 12px;
		}

		.legend {
			display: flex;
			gap: 10px;
			align-items: center;
		}

		.swatch {
			display: inline-block;
			width: 18px;
			height: 3px;
			vertical-align: middle;
			margin-right: 4px;
		}

		.viewer {
			width: 100%;
			height: 100%;
			background: transparent;
			overflow: hidden;
			cursor: grab;
			user-select: none;
			touch-action: none;
		}

		.viewer-slot {
			flex: 1 1 auto;
			min-height: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: hidden;
		}

		.viewer.dragging {
			cursor: grabbing;
		}

		.viewer svg {
			display: block;
			width: 100%;
			height: 100%;
		}

		.vision-tooltip {
			position: absolute;
			display: none;
			z-index: 10;
			max-width: min(520px, 78vw);
			padding: 8px 10px;
			border: 1px solid var(--vscode-panel-border,#3c3c3c);
			background: var(--vscode-editorHoverWidget-background,#252526);
			color: var(--vscode-editorHoverWidget-foreground,#d4d4d4);
			box-shadow: 0 4px 12px rgba(0,0,0,0.35);
			font-family: Consolas, monospace;
			font-size: 12px;
			line-height: 1.35;
			pointer-events: none;
		}

		.tooltip-items {
			display: flex;
			gap: 14px;
		}

		.tooltip-item {
			min-width: 74px;
		}

		.tooltip-row + .tooltip-row {
			margin-top: 6px;
			padding-top: 6px;
			border-top: 1px solid var(--vscode-panel-border,#3c3c3c);
		}

		.tooltip-line {
			white-space: nowrap;
		}

		.axis-x { color: #D65D5D; }
		.axis-y { color: #6A9955; }
		.axis-z { color: #4A90E2; }
		.table-wrap {
			flex: 0 0 calc(var(--vision-row-height) * 9);
			overflow: auto;
			max-height: calc(var(--vision-row-height) * 9);
			border-top: 1px solid var(--vscode-panel-border);
			margin-top: 10px;
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
			height: var(--vision-row-height);
			line-height: var(--vision-row-height);
			padding: 0 10px 0 0;
			vertical-align: top;
			white-space: nowrap;
		}

		td.notes {
			white-space: normal;
			min-width: 18ch;
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

		code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 1px 4px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<section class="controls">
		<label>Plane
			<select id="plane">
				<option value="xy"${options.plane === "xy" ? " selected" : ""}>X-Y</option>
				<option value="yx"${options.plane === "yx" ? " selected" : ""}>Y-X</option>
				<option value="xz"${options.plane === "xz" ? " selected" : ""}>X-Z</option>
				<option value="zx"${options.plane === "zx" ? " selected" : ""}>Z-X</option>
				<option value="yz"${options.plane === "yz" ? " selected" : ""}>Y-Z</option>
				<option value="zy"${options.plane === "zy" ? " selected" : ""}>Z-Y</option>
			</select>
		</label>
		<label class="checkbox"><input id="labels" type="checkbox" checked> Endpoint labels</label>
		<label class="checkbox"><input id="zeroLines" type="checkbox"> Zero lines</label>
		<label class="checkbox"><input id="toolColors" type="checkbox"${options.useToolColors ? " checked" : ""}> Tool colors</label>
		<button id="fit">Fit View</button>
		<button id="zoomOut">Zoom -</button>
		<button id="zoomIn">Zoom +</button>
		<span id="zoomLabel" class="note">100%</span>
		<button id="save">Save SVG</button>
		<button id="whole">Send Whole Program</button>
		<button id="selection">Send Selection</button>
	</section>

	<section class="summary">
		<span>${escapeHtml(summary.moveCount)} move(s)</span>
		<span>${escapeHtml(formatNumber(summary.totalDistance, options.humanFormat))} total distance</span>
		${summary.unknownRows ? `<span>${escapeHtml(summary.unknownRows)} row(s) have incomplete path data</span>` : ""}
		<span class="legend"><span><span class="swatch" style="background: var(--rapid)"></span>G0</span><span><span class="swatch" style="background: var(--cut)"></span>G1/G2/G3</span></span>
	</section>

	<div id="viewerSlot" class="viewer-slot" style="position: relative;">
		<div id="viewer" class="viewer"></div>
		<div id="visionTooltip" class="vision-tooltip"></div>
	</div>
	${renderRows(result.rows, options.humanFormat)}

	<script type="application/json" id="vision-data">${escapeScriptJson(payload)}</script>
	<script>
		const vscode = acquireVsCodeApi();
		const data = JSON.parse(document.getElementById("vision-data").textContent);
		const planeSelect = document.getElementById("plane");
		const labelsInput = document.getElementById("labels");
		const zeroLinesInput = document.getElementById("zeroLines");
		const toolColorsInput = document.getElementById("toolColors");
		const viewerSlot = document.getElementById("viewerSlot");
		const viewer = document.getElementById("viewer");
		const tooltip = document.getElementById("visionTooltip");
		const zoomLabel = document.getElementById("zoomLabel");
		const zoomStep = Math.max(1.01, Number(data.options.zoomStep) || 1.75);
		const wheelZoomStep = Math.max(1.01, Number(data.options.wheelZoomStep) || 1.36);
		let zoom = 1;
		let pan = { x: 0, y: 0 };
		let currentFitBounds;
		let currentBounds;
		let dragState;
		const planes = {
			xy: makePlane("X-Y", getOrderedOrientation(data.options.xyOrientation, "xRightYUp", "x", "y"), "x", "y"),
			yx: makePlane("Y-X", getOrderedOrientation(data.options.xyOrientation, "yRightXUp", "y", "x"), "y", "x"),
			xz: makePlane("X-Z", getOrderedOrientation(data.options.xzOrientation, "xRightZUp", "x", "z"), "x", "z"),
			zx: makePlane("Z-X", getOrderedOrientation(data.options.xzOrientation, "zRightXUp", "z", "x"), "z", "x"),
			yz: makePlane("Y-Z", getOrderedOrientation(data.options.zyOrientation, "yRightZUp", "y", "z"), "y", "z"),
			zy: makePlane("Z-Y", getOrderedOrientation(data.options.zyOrientation, "zRightYUp", "z", "y"), "z", "y")
		};

		function getOrderedOrientation(orientation, fallback, firstAxis, secondAxis) {
			const match = String(orientation || "").match(/^([xyz])(Right|Left)([xyz])(Up|Down)$/i);

			if (!match
				|| match[1].toLowerCase() !== firstAxis
				|| match[3].toLowerCase() !== secondAxis) {
				return fallback;
			}

			return orientation;
		}


		function makePlane(label, orientation, firstAxis, secondAxis) {
			const match = String(orientation).match(/^([xyz])(Right|Left)([xyz])(Up|Down)$/i);

			if (!match) {
				return {
					label,
					h: firstAxis,
					v: secondAxis,
					hSign: 1,
					vSign: 1,
					hLabel: firstAxis.toUpperCase(),
					vLabel: secondAxis.toUpperCase()
				};
			}

			const h = match[1].toLowerCase();
			const v = match[3].toLowerCase();
			const axes = new Set([firstAxis, secondAxis]);

			if (!axes.has(h) || !axes.has(v) || h === v) {
				return {
					label,
					h: firstAxis,
					v: secondAxis,
					hSign: 1,
					vSign: 1,
					hLabel: firstAxis.toUpperCase(),
					vLabel: secondAxis.toUpperCase()
				};
			}

			return {
				label,
				h,
				v,
				hSign: match[2].toLowerCase() === "right" ? 1 : -1,
				vSign: match[4].toLowerCase() === "up" ? 1 : -1,
				hLabel: h.toUpperCase(),
				vLabel: v.toUpperCase()
			};
		}

		function project(point, plane) {
			const x = Number(point[plane.h]);
			const y = Number(point[plane.v]);

			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				return undefined;
			}

			return {
				x: x * plane.hSign,
				y: -y * plane.vSign
			};
		}

		function getDrawableRows(plane) {
			return data.rows.map(row => {
				if (row.type === "tool" || row.type === "cycle") {
					return Object.assign({}, row, { projectedPoints: [] });
				}

				const points = (row.points || [])
					.map(point => project(point, plane))
					.filter(Boolean);
				const end = points[points.length - 1];

				return Object.assign({}, row, { projectedPoints: points, projectedEnd: end });
			}).filter(row => row.projectedPoints.length >= 2);
		}

		function getDrawableCycleRows(plane) {
			return data.rows.filter(row => row.type === "cycle")
				.map(row => {
					const points = (row.points || [])
						.map(point => project(point, plane))
						.filter(Boolean);
					const projectedPoint = project(row.point || row.end || {}, plane) || points[points.length - 1];

					return Object.assign({}, row, { projectedPoints: points, projectedPoint });
				})
				.filter(row => row.projectedPoint);
		}

		function getDrawableToolChanges(plane) {
			return data.rows.filter(row => row.type === "tool")
				.map(row => Object.assign({}, row, { projectedPoint: project(row.point || {}, plane) }))
				.filter(row => row.projectedPoint);
		}

		function makeBounds(rows, cycles, toolChanges) {
			const points = [];

			for (const row of rows) {
				points.push(...row.projectedPoints);
			}

			for (const cycle of cycles) {
				if (cycle.projectedPoints && cycle.projectedPoints.length) {
					points.push(...cycle.projectedPoints);
				} else {
					points.push(cycle.projectedPoint);
				}
			}

			for (const toolChange of toolChanges) {
				points.push(toolChange.projectedPoint);
			}

			if (!points.length) {
				return { minX: -10, minY: -10, width: 20, height: 20 };
			}

			const xs = points.map(point => point.x);
			const ys = points.map(point => point.y);
			let minX = Math.min(...xs);
			let maxX = Math.max(...xs);
			let minY = Math.min(...ys);
			let maxY = Math.max(...ys);
			const spanX = Math.max(0.001, maxX - minX);
			const spanY = Math.max(0.001, maxY - minY);
			const pad = Math.max(spanX, spanY) * 0.08 || 1;

			minX -= pad;
			maxX += pad;
			minY -= pad;
			maxY += pad;

			const centerX = minX + (maxX - minX) / 2;
			const centerY = minY + (maxY - minY) / 2;
			const side = Math.max(1, maxX - minX, maxY - minY);

			return {
				minX: centerX - side / 2,
				minY: centerY - side / 2,
				width: side,
				height: side
			};
		}

		function zoomBounds(bounds) {
			const centerX = bounds.minX + bounds.width / 2;
			const centerY = bounds.minY + bounds.height / 2;
			const width = bounds.width / zoom;
			const height = bounds.height / zoom;

			return {
				minX: centerX + pan.x - width / 2,
				minY: centerY + pan.y - height / 2,
				width,
				height
			};
		}

		function setZoom(nextZoom, event) {
			if (!currentFitBounds) {
				zoom = Math.max(1, nextZoom);
				zoomLabel.textContent = Math.round(zoom * 100) + "%";
				render();
				return;
			}

			const oldBounds = currentBounds || zoomBounds(currentFitBounds);
			const oldZoom = zoom;
			zoom = Math.max(1, nextZoom);

			if (event && oldZoom !== zoom) {
				const rect = viewer.getBoundingClientRect();
				const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
				const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
				const anchorX = oldBounds.minX + ratioX * oldBounds.width;
				const anchorY = oldBounds.minY + ratioY * oldBounds.height;
				const newWidth = currentFitBounds.width / zoom;
				const newHeight = currentFitBounds.height / zoom;
				const newMinX = anchorX - ratioX * newWidth;
				const newMinY = anchorY - ratioY * newHeight;
				const fitCenterX = currentFitBounds.minX + currentFitBounds.width / 2;
				const fitCenterY = currentFitBounds.minY + currentFitBounds.height / 2;

				pan = {
					x: newMinX + newWidth / 2 - fitCenterX,
					y: newMinY + newHeight / 2 - fitCenterY
				};
			}

			zoomLabel.textContent = Math.round(zoom * 100) + "%";
			render();
		}

		function resetView() {
			zoom = 1;
			pan = { x: 0, y: 0 };
			zoomLabel.textContent = "100%";
			render();
		}

		function formatPointList(points) {
			return points.map(point => round(point.x) + "," + round(point.y)).join(" ");
		}

		function round(value) {
			return Math.round(value * 10000) / 10000;
		}

		function formatAxisNumber(value, humanFormat, trimTrailingZeros = false) {
			const maximum = Math.max(0, Math.min(9, Number(humanFormat && humanFormat.maximumDecimalPlaces) || 3));
			const configuredMinimum = Math.max(0, Math.min(maximum, Number(humanFormat && humanFormat.minimumDecimalPlaces) || 0));
			const minimum = trimTrailingZeros ? 0 : configuredMinimum;
			let text = Number(value).toFixed(maximum);

			if (maximum > minimum) {
				while (text.includes(".") && text.endsWith("0") && countDecimalPlaces(text) > minimum) {
					text = text.slice(0, -1);
				}

				if (text.endsWith(".") && minimum === 0 && !trimTrailingZeros) {
					text = text.slice(0, -1);
				}
			}

			return text;
		}

		function countDecimalPlaces(text) {
			const decimalIndex = text.indexOf(".");

			return decimalIndex === -1 ? 0 : text.length - decimalIndex - 1;
		}
		function svgEscape(value) {
			return String(value)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;");
		}

		function sizeViewer() {
			const rect = viewerSlot.getBoundingClientRect();
			const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));

			viewer.style.width = size + "px";
			viewer.style.height = size + "px";
		}

		function render() {
			sizeViewer();
			const plane = planes[planeSelect.value] || planes.xz;
			const rows = getDrawableRows(plane);
			const cycles = getDrawableCycleRows(plane);
			const toolChanges = getDrawableToolChanges(plane);
			const viewerRect = viewer.getBoundingClientRect();
			const fitBounds = makeBounds(rows, cycles, toolChanges);
			currentFitBounds = fitBounds;
			const bounds = zoomBounds(fitBounds);
			currentBounds = bounds;
			const showLabels = labelsInput.checked;
			const showZeroLines = zeroLinesInput.checked;
			const useToolColors = toolColorsInput.checked;
			const unitsPerPixel = bounds.width / Math.max(1, Math.min(viewerRect.width, viewerRect.height));
			const labelSize = unitsPerPixel * data.options.labelFontSize;
			const labelOffset = unitsPerPixel * data.options.labelOffset;
			const compassSize = unitsPerPixel * data.options.compassSize;
			const compassOffsetX = unitsPerPixel * data.options.compassOffsetX;
			const compassOffsetY = unitsPerPixel * data.options.compassOffsetY;
			const compassTextSize = compassSize * 0.16;
			const endpointSize = unitsPerPixel * data.options.endpointSize;
			const startPointSize = unitsPerPixel * data.options.startPointSize;
			const toolChangeSize = unitsPerPixel * 4;
			const cyclePointSize = unitsPerPixel * 4;
			const arrowSize = unitsPerPixel * 8 * data.options.arrowSize;
			const endpointLabelOutline = unitsPerPixel * 1.5;
			const labelHitboxPadding = unitsPerPixel * 8;
			const connectorPointGap = unitsPerPixel * 2;
			const connectorLabelGap = unitsPerPixel * 0.35;
			const endpointLabelAvoidance = data.options.endpointLabelAvoidance !== false;
			const lineScale = data.options.lineThickness;

			if (!rows.length && !cycles.length && !toolChanges.length) {
				viewer.innerHTML = '<p class="empty" style="padding: 16px;">No drawable moves found for the selected plane.</p>';
				return;
			}

			const paths = rows.map(row => renderMotionPath(row, useToolColors)).join("");
			const directionArrows = rows.map(row => renderDirectionArrow(row, useToolColors, endpointSize, arrowSize, unitsPerPixel)).join("");
			const cycleStrokes = cycles.map(cycle => renderCycleStroke(cycle, useToolColors)).join("");
			const cycleTargets = cycles.map(cycle => makePointLabelTarget(cycle.projectedPoint, cyclePointSize, "cycle-point", "endpoint-label", showLabels ? "L" + cycle.lineNumber + " " + cycle.instruction : "", showLabels ? makeVisiblePositionLine(cycle.end, data.options.humanFormat) : "", makePointLabelDetails(cycle.end, cycle, "cycle")));
			const toolTargets = toolChanges.map(toolChange => makeToolChangeLabelTarget(toolChange, showLabels, plane, data.options.humanFormat, toolChangeSize));
			const firstRow = rows[0];
			const firstPoint = firstRow && firstRow.projectedPoints[0];
			const labelTargets = [];

			if (firstPoint) {
				labelTargets.push(makePointLabelTarget(firstPoint, startPointSize, "start-point", "start-label", showLabels ? "START" : "", showLabels ? makeVisiblePositionLine(firstRow.start, data.options.humanFormat) : "", makePointLabelDetails(firstRow.start, Object.assign({}, firstRow, { instruction: "START" }), "start")));
			}

			labelTargets.push(...cycleTargets);
			labelTargets.push(...toolTargets);

			for (const row of rows) {
				const end = row.projectedEnd || row.projectedPoints[row.projectedPoints.length - 1];

				if (!end) {
					continue;
				}

				labelTargets.push(makePointLabelTarget(end, endpointSize, "endpoint", "endpoint-label", showLabels ? "L" + row.lineNumber : "", showLabels ? makeVisiblePositionLine(row.end, data.options.humanFormat) : "", makePointLabelDetails(row.end, row, "endpoint")));
			}

			const pointMergeDistance = unitsPerPixel * data.options.pointMergeDistance;
			const collapsedLabelTargets = collapseCoincidentLabelTargets(labelTargets, plane, data.options.humanFormat, pointMergeDistance);
			const labelsAndMarkers = layoutPointLabels(collapsedLabelTargets, {
				labelSize,
				labelOffset,
				labelHitboxPadding,
				connectorPointGap,
				connectorLabelGap,
				endpointLabelAvoidance
			}).map(renderPointLabel).join("");
			const zeroAxes = showZeroLines ? renderZeroAxes(bounds) : "";
			const compass = renderCompass(bounds, plane, compassSize, compassOffsetX, compassOffsetY);
			const svg = '<svg id="vision-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' + [bounds.minX, bounds.minY, bounds.width, bounds.height].map(round).join(" ") + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="KAIJU Vision ' + plane.label + ' path">' +
				'<style>' +
					'.zero-line{stroke:#6f6f6f;stroke-width:' + 0.8 * lineScale + ';stroke-dasharray:6 5;vector-effect:non-scaling-stroke;}.compass{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + compassTextSize + 'px;font-weight:600;}.endpoint-label,.start-label{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + labelSize + 'px;}.endpoint-label{stroke:#000;stroke-width:' + endpointLabelOutline + ';stroke-linejoin:round;paint-order:stroke fill;}.tool-change-label{font-family:Consolas,monospace;font-size:' + labelSize + 'px;font-weight:600;stroke:#000;stroke-width:' + endpointLabelOutline + ';stroke-linejoin:round;paint-order:stroke fill;}.point-label{text-anchor:middle;}.label-connector{stroke:#fff;stroke-width:0.85;stroke-linecap:round;opacity:0.9;vector-effect:non-scaling-stroke;}.rapid{fill:none;stroke:#ff8800;stroke-width:' + 1.1 * lineScale + ';stroke-dasharray:8 6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}.cut{fill:none;stroke:#ffd500;stroke-width:' + 1.4 * lineScale + ';stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}.direction-arrow{fill:none;stroke-width:' + 1.35 * lineScale + ';stroke-linecap:round;vector-effect:non-scaling-stroke;}.rapid-direction{stroke:#ff8800;}.cut-direction{stroke:#ffd500;}.cycle-stroke{fill:none;stroke:#4fc3ff;stroke-width:' + 1.45 * lineScale + ';stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}.cycle-point{fill:#4fc3ff;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.tool-change-dot{fill:#6A9955;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.endpoint{fill:var(--vscode-foreground,#d4d4d4);stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.75 * lineScale + ';vector-effect:non-scaling-stroke;}.start-point{fill:#6A9955;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.arrow-rapid{fill:#ff8800;}.arrow-cut{fill:#ffd500;}' +
				'</style>' +
				'<defs>' +
					'<marker id="rapid-arrow" markerWidth="' + arrowSize + '" markerHeight="' + arrowSize + '" refX="' + arrowSize + '" refY="' + arrowSize / 2 + '" orient="auto" markerUnits="userSpaceOnUse"><path class="arrow-rapid" d="M0,0 L' + arrowSize + ',' + arrowSize / 2 + ' L0,' + arrowSize + ' Z" /></marker>' +
					'<marker id="cut-arrow" markerWidth="' + arrowSize + '" markerHeight="' + arrowSize + '" refX="' + arrowSize + '" refY="' + arrowSize / 2 + '" orient="auto" markerUnits="userSpaceOnUse"><path class="arrow-cut" d="M0,0 L' + arrowSize + ',' + arrowSize / 2 + ' L0,' + arrowSize + ' Z" /></marker>' +
				'</defs>' +
				zeroAxes +
				compass +
				paths +
				directionArrows +
				cycleStrokes +
				labelsAndMarkers +
				'</svg>';

			hideTooltip();
			viewer.innerHTML = svg;
		}

		function makePointLabelTarget(point, pointSize, pointClass, labelClass, labelLine, coordinateLine, details = {}) {
			return {
				point,
				pointSize,
				pointClass,
				labelClass,
				labelLine,
				coordinateLine,
				kind: details.kind || "endpoint",
				sourcePosition: details.position,
				hoverHtml: details.hoverHtml || ""
			};
		}

		function makePointLabelDetails(position, row, kind) {
			return {
				kind,
				position,
				hoverHtml: makePointHoverHtml(position, row)
			};
		}

		function makeToolChangeLabelTarget(toolChange, showLabels, plane, humanFormat, toolChangeSize) {
			return makePointLabelTarget(
				toolChange.projectedPoint,
				toolChangeSize,
				"tool-change-dot",
				"endpoint-label",
				showLabels ? "T[1]" : "",
				showLabels ? makePlaneCoordinateLine(toolChange.point, plane, humanFormat, data.options.trimLabelTrailingZeros !== false) : "",
				{ kind: "tool", position: toolChange.point, hoverHtml: makeToolChangeHoverHtml(toolChange) }
			);
		}

		function makePointHoverHtml(position, row) {
			const lineLabel = row && Number.isFinite(row.lineNumber) ? "L" + row.lineNumber : "";
			const instruction = row && row.instruction ? row.instruction : "";
			const lines = ['<div class="tooltip-line">' + svgEscape((lineLabel + " " + instruction).trim()) + '</div>'];

			for (const axis of ["x", "y", "z"]) {
				const value = position && position[axis];

				if (Number.isFinite(value)) {
					lines.push('<div class="tooltip-line axis-' + axis + '">' + axis.toUpperCase() + formatAxisNumber(value, data.options.humanFormat) + '</div>');
				}
			}

			return '<div class="tooltip-row">' + lines.filter(Boolean).join("") + '</div>';
		}

		function makeToolChangeHoverHtml(toolChange) {
			const lineLabel = Number.isFinite(toolChange.lineNumber) ? "L" + toolChange.lineNumber : "";
			const previousTool = toolChange.previousTool || "";
			const currentTool = toolChange.tool || toolChange.instruction || "";
			const previousColor = toolChange.previousToolColor || "var(--vscode-foreground,#d4d4d4)";
			const currentColor = toolChange.toolColor || "var(--vscode-foreground,#d4d4d4)";
			const toolText = previousTool
				? '<span style="color:' + escapeAttribute(previousColor) + '">' + svgEscape(previousTool) + '</span> -> <span style="color:' + escapeAttribute(currentColor) + '">' + svgEscape(currentTool) + '</span>'
				: '<span style="color:' + escapeAttribute(currentColor) + '">' + svgEscape(currentTool) + '</span>';
			const lines = ['<div class="tooltip-line">' + svgEscape(lineLabel + (lineLabel ? " " : "")) + toolText + '</div>'];

			for (const axis of ["x", "y", "z"]) {
				const value = toolChange.point && toolChange.point[axis];

				if (Number.isFinite(value)) {
					lines.push('<div class="tooltip-line axis-' + axis + '">' + axis.toUpperCase() + formatAxisNumber(value, data.options.humanFormat) + '</div>');
				}
			}

			return '<div class="tooltip-row">' + lines.join("") + '</div>';
		}
		function collapseCoincidentLabelTargets(targets, plane, humanFormat, mergeDistance) {
			const tolerance = Math.max(0, Number(mergeDistance) || 0);
			const groups = [];

			for (const target of targets) {
				let group = tolerance > 0
					? groups.find(candidate => candidate.some(existing => getPointDistance(existing.point, target.point) <= tolerance))
					: groups.find(candidate => makePointKey(candidate[0].point) === makePointKey(target.point));

				if (!group) {
					group = [];
					groups.push(group);
				}

				group.push(target);
			}

			return groups.flatMap(group => group.length > 1 ? makeCollapsedLabelTargets(group, plane, humanFormat) : group[0]);
		}

		function makeCollapsedLabelTargets(group, plane, humanFormat) {
			const representative = chooseRepresentativeTarget(group);
			const sourcePosition = representative.sourcePosition || (group.find(target => target.sourcePosition) || {}).sourcePosition;
			const toolCount = group.filter(target => target.kind === "tool").length;
			const hoverHtml = '<div class="tooltip-item">' + group.map(target => target.hoverHtml || '<div class="tooltip-row"><div class="tooltip-line">' + svgEscape([target.labelLine, target.coordinateLine].filter(Boolean).join(" ")) + '</div></div>').join("") + '</div>';

			const collapsedTarget = Object.assign({}, representative, {
				pointSize: Math.max(...group.map(target => target.pointSize || 0)),
				labelLine: makeCollapsedLabelText(group.length, toolCount, sourcePosition, plane, humanFormat, data.options.trimLabelTrailingZeros !== false),
				coordinateLine: "",
				hoverHtml
			});
			const markerTargets = group
				.filter(target => target !== representative)
				.map(target => Object.assign({}, target, {
					labelLine: "",
					coordinateLine: "",
					connector: undefined,
					hoverHtml
				}));

			return [collapsedTarget, ...markerTargets];
		}

		function chooseRepresentativeTarget(group) {
			const priority = { start: 4, tool: 3, cycle: 2, endpoint: 1 };

			return group.slice().sort((a, b) => (priority[b.kind] || 0) - (priority[a.kind] || 0))[0] || group[0];
		}

		function makeCollapsedLabelText(count, toolCount, position, plane, humanFormat, trimTrailingZeros) {
			const parts = ["[" + count + "]"];

			if (toolCount > 0) {
				parts.push("T[" + toolCount + "]");
			}

			for (const axis of [plane.h, plane.v]) {
				const value = position && position[axis];

				if (Number.isFinite(value)) {
					parts.push(axis.toUpperCase() + formatAxisNumber(value, humanFormat, trimTrailingZeros));
				}
			}

			return parts.join(" ");
		}

		function makePlaneCoordinateLine(position, plane, humanFormat, trimTrailingZeros) {
			const parts = [];

			for (const axis of [plane.h, plane.v]) {
				const value = position && position[axis];

				if (Number.isFinite(value)) {
					parts.push(axis.toUpperCase() + formatAxisNumber(value, humanFormat, trimTrailingZeros));
				}
			}

			return parts.join(" ");
		}

		function makeVisiblePositionLine(position, humanFormat) {
			const parts = [];

			for (const axis of ["x", "y", "z"]) {
				const value = position && position[axis];

				if (Number.isFinite(value)) {
					parts.push(axis.toUpperCase() + formatAxisNumber(value, humanFormat, data.options.trimLabelTrailingZeros !== false));
				}
			}

			return parts.join(" ");
		}
		function layoutPointLabels(targets, options) {
			const pointObstacles = targets.map(target => makePointObstacle(target.point, target.pointSize, options.labelHitboxPadding, makePointKey(target.point)));
			const placedLabelBoxes = [];
			const placedConnectors = [];
			const duplicateCounts = countLabelTargetsByPoint(targets);
			const stackedOffsets = new Map();

			return targets.map(target => {
				if (!target.labelLine && !target.coordinateLine) {
					return target;
				}

				const stackKey = makePointKey(target.point);

				if (duplicateCounts.get(stackKey) > 1) {
					const stacked = makeStackedLabelPlacement(target, options, stackedOffsets.get(stackKey) || 0);
					stackedOffsets.set(stackKey, stacked.nextOffset);
					placedLabelBoxes.push(stacked.box);

					return Object.assign({}, target, {
						labelX: stacked.labelX,
						firstBaselineY: stacked.firstBaselineY
					});
				}

				const candidates = makeLabelCandidates(target, options);
				let chosen = candidates[0];

				if (options.endpointLabelAvoidance) {
					let bestScore = Number.POSITIVE_INFINITY;

					for (const candidate of candidates) {
						const connector = candidate.index === 0 ? undefined : makeLabelConnector(target.point, target.pointSize, candidate.box, options.connectorPointGap, options.connectorLabelGap);
						const collisionScore = scoreLabelCandidate(candidate.box, connector, pointObstacles, placedLabelBoxes, placedConnectors, stackKey);
						const score = collisionScore + candidate.priority;

						if (score < bestScore) {
							chosen = Object.assign({}, candidate, { connector });
							bestScore = score;
						}

						if (collisionScore === 0) {
							break;
						}
					}
				}

				placedLabelBoxes.push(chosen.box);

				if (chosen.connector) {
					placedConnectors.push(chosen.connector);
				}

				return Object.assign({}, target, {
					labelX: chosen.labelX,
					firstBaselineY: chosen.firstBaselineY,
					connector: chosen.connector
				});
			});
		}

		function countLabelTargetsByPoint(targets) {
			const counts = new Map();

			for (const target of targets) {
				if (!target.labelLine && !target.coordinateLine) {
					continue;
				}

				const key = makePointKey(target.point);
				counts.set(key, (counts.get(key) || 0) + 1);
			}

			return counts;
		}

		function makePointKey(point) {
			return round(point.x) + "," + round(point.y);
		}

		function getPointDistance(a, b) {
			return Math.hypot(a.x - b.x, a.y - b.y);
		}

		function makeStackedLabelPlacement(target, options, stackOffset) {
			const metrics = measurePointLabel(target, options.labelSize, options.labelHitboxPadding);
			const gap = Math.max(options.labelSize * 0.35, options.labelOffset);
			const top = target.point.y + target.pointSize + options.labelOffset + stackOffset;
			const left = target.point.x - metrics.width / 2;

			return {
				nextOffset: stackOffset + metrics.height + gap,
				labelX: target.point.x,
				firstBaselineY: top + metrics.firstBaselineOffset,
				box: {
					left,
					top,
					right: left + metrics.width,
					bottom: top + metrics.height
				}
			};
		}

		function makePointObstacle(point, radius, padding, key) {
			return {
				key,
				left: point.x - radius - padding,
				top: point.y - radius - padding,
				right: point.x + radius + padding,
				bottom: point.y + radius + padding
			};
		}

		function makeLabelCandidates(target, options) {
			const metrics = measurePointLabel(target, options.labelSize, options.labelHitboxPadding);
			const xDistance = target.pointSize + options.labelOffset + metrics.width / 2;
			const yDistance = target.pointSize + options.labelOffset + metrics.height / 2;
			const offsets = [[0, yDistance]];
			const rings = [1.15, 1.65, 2.25, 3.0];
			const angles = [];

			for (let angle = 0; angle < 360; angle += 10) {
				angles.push(angle);
			}

			for (const ring of rings) {
				for (const angle of angles) {
					offsets.push(makeAngleOffset(angle, xDistance * ring, yDistance * ring));
				}
			}

			return offsets.map((offset, index) => makeLabelCandidate(target.point.x + offset[0], target.point.y + offset[1], metrics, index, offset));
		}

		function measurePointLabel(target, labelSize, padding) {
			const lineCount = target.coordinateLine ? 2 : 1;
			const maxCharacters = Math.max(String(target.labelLine || "").length, String(target.coordinateLine || "").length, 1);

			return {
				width: maxCharacters * labelSize * 0.72 + padding * 2,
				height: (lineCount === 1 ? labelSize * 1.2 : labelSize * 2.35) + padding * 2,
				lineCount,
				padding,
				firstBaselineOffset: padding + labelSize * 0.9
			};
		}

		function makeAngleOffset(angleDegrees, xRadius, yRadius) {
			const radians = angleDegrees * Math.PI / 180;

			return [
				Math.cos(radians) * xRadius,
				Math.sin(radians) * yRadius
			];
		}

		function makeLabelCandidate(centerX, centerY, metrics, index, offset) {
			const left = centerX - metrics.width / 2;
			const top = centerY - metrics.height / 2;
			const distance = offset ? Math.hypot(offset[0], offset[1]) : 0;

			return {
				index,
				priority: distance * 0.02 + index * 0.001,
				labelX: centerX,
				firstBaselineY: top + metrics.firstBaselineOffset,
				box: {
					left,
					top,
					right: left + metrics.width,
					bottom: top + metrics.height
				}
			};
		}

		function scoreLabelCandidate(box, connector, pointObstacles, placedLabelBoxes, placedConnectors, targetKey) {
			let score = 0;

			for (const obstacle of pointObstacles) {
				if (obstacle.key === targetKey) {
					continue;
				}

				score += getIntersectionArea(box, obstacle) * 1000;
			}

			for (const placedBox of placedLabelBoxes) {
				score += getIntersectionArea(box, placedBox) * 1200;
			}

			if (connector) {
				for (const placedConnector of placedConnectors) {
					if (segmentsIntersect(connector, placedConnector)) {
						score += 100000000;
					}
				}
			}

			return score;
		}

		function segmentsIntersect(a, b) {
			const directionA = {
				x: a.x2 - a.x1,
				y: a.y2 - a.y1
			};
			const directionB = {
				x: b.x2 - b.x1,
				y: b.y2 - b.y1
			};
			const denominator = cross(directionA, directionB);

			if (Math.abs(denominator) < 0.000001) {
				return false;
			}

			const delta = {
				x: b.x1 - a.x1,
				y: b.y1 - a.y1
			};
			const t = cross(delta, directionB) / denominator;
			const u = cross(delta, directionA) / denominator;

			return t > 0.03 && t < 0.97 && u > 0.03 && u < 0.97;
		}

		function cross(a, b) {
			return a.x * b.y - a.y * b.x;
		}

		function getIntersectionArea(a, b) {
			const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
			const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

			return width * height;
		}

		function makeLabelConnector(point, pointSize, box, pointGap, labelGap) {
			const targetX = Math.max(box.left, Math.min(box.right, point.x));
			const targetY = Math.max(box.top, Math.min(box.bottom, point.y));
			const dx = targetX - point.x;
			const dy = targetY - point.y;
			const length = Math.hypot(dx, dy);

			if (length <= 0) {
				return undefined;
			}

			const ux = dx / length;
			const uy = dy / length;

			return {
				x1: point.x + ux * (pointSize + pointGap),
				y1: point.y + uy * (pointSize + pointGap),
				x2: targetX - ux * labelGap,
				y2: targetY - uy * labelGap
			};
		}

		function renderPointLabel(target) {
			const x = round(target.point.x);
			const y = round(target.point.y);
			const tooltipAttribute = target.hoverHtml ? ' data-tooltip="' + escapeAttribute(target.hoverHtml) + '"' : "";
			const marker = '<circle class="' + target.pointClass + '" cx="' + x + '" cy="' + y + '" r="' + target.pointSize + '" />';

			if (!target.labelLine && !target.coordinateLine) {
				return '<g class="point-label-hit"' + tooltipAttribute + '>' + marker + '</g>';
			}

			const connector = target.connector
				? '<line class="label-connector" x1="' + round(target.connector.x1) + '" y1="' + round(target.connector.y1) + '" x2="' + round(target.connector.x2) + '" y2="' + round(target.connector.y2) + '" />'
				: "";

			return '<g class="point-label-hit"' + tooltipAttribute + '>' + marker +
				connector +
				'<text class="point-label ' + target.labelClass + '" x="' + round(target.labelX) + '" y="' + round(target.firstBaselineY) + '">' +
					'<tspan x="' + round(target.labelX) + '">' + svgEscape(target.labelLine) + '</tspan>' +
					(target.coordinateLine ? '<tspan x="' + round(target.labelX) + '" dy="1.15em">' + svgEscape(target.coordinateLine) + '</tspan>' : "") +
				'</text>' +
				'</g>';
		}


		function renderMotionPath(row, useToolColors) {
			const cls = row.motionCode === 0 ? "rapid" : "cut";
			const toolColor = useToolColors && row.toolColor ? boostToolColor(row.toolColor) : "";
			const strokeStyle = toolColor ? ' style="stroke:' + escapeAttribute(toolColor) + '"' : "";

			return '<polyline class="' + cls + '"' + strokeStyle + ' points="' + formatPointList(row.projectedPoints) + '" />';
		}

		function renderDirectionArrow(row, useToolColors, endpointSize, arrowSize, unitsPerPixel) {
			const arrowSegment = makeDirectionArrowSegment(row.projectedPoints, endpointSize, arrowSize, unitsPerPixel);

			if (!arrowSegment) {
				return "";
			}

			const cls = row.motionCode === 0 ? "rapid-direction" : "cut-direction";
			const marker = row.motionCode === 0 ? "url(#rapid-arrow)" : "url(#cut-arrow)";
			const toolColor = useToolColors && row.toolColor ? boostToolColor(row.toolColor) : "";
			const strokeStyle = toolColor ? ' style="stroke:' + escapeAttribute(toolColor) + '"' : "";

			return '<line class="direction-arrow ' + cls + '"' + strokeStyle + ' marker-end="' + marker + '" x1="' + round(arrowSegment.start.x) + '" y1="' + round(arrowSegment.start.y) + '" x2="' + round(arrowSegment.end.x) + '" y2="' + round(arrowSegment.end.y) + '" />';
		}

		function makeDirectionArrowSegment(points, endpointSize, arrowSize, unitsPerPixel) {
			if (!points || points.length < 2) {
				return undefined;
			}

			const endpointInset = endpointSize + unitsPerPixel * 0.5;
			const arrowLength = Math.max(arrowSize * 0.5, unitsPerPixel * 4);
			const minimumLength = endpointInset + arrowLength;

			if (getPolylineLength(points) < minimumLength) {
				return undefined;
			}

			const arrowEnd = getPointBeforePolylineEnd(points, endpointInset);
			const arrowStart = getPointBeforePolylineEnd(points, endpointInset + arrowLength);

			return arrowStart && arrowEnd ? { start: arrowStart, end: arrowEnd } : undefined;
		}

		function getPointBeforePolylineEnd(points, distanceFromEnd) {
			let remaining = distanceFromEnd;

			for (let index = points.length - 1; index > 0; index--) {
				const end = points[index];
				const start = points[index - 1];
				const dx = end.x - start.x;
				const dy = end.y - start.y;
				const length = Math.hypot(dx, dy);

				if (!Number.isFinite(length) || length <= 0) {
					continue;
				}

				if (remaining <= length) {
					return interpolateSegmentPoint(start, end, length - remaining, length);
				}

				remaining -= length;
			}

			return undefined;
		}

		function interpolateSegmentPoint(start, end, distanceFromStart, length) {
			const fraction = Math.max(0, Math.min(1, distanceFromStart / length));

			return {
				x: start.x + (end.x - start.x) * fraction,
				y: start.y + (end.y - start.y) * fraction
			};
		}

		function getPolylineLength(points) {
			let length = 0;

			for (let index = 1; index < points.length; index++) {
				length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
			}

			return length;
		}
		function renderCycleStroke(cycle, useToolColors) {
			if (!cycle.projectedPoints || cycle.projectedPoints.length < 2) {
				return "";
			}

			const toolColor = useToolColors && cycle.toolColor ? boostToolColor(cycle.toolColor) : "";
			const strokeStyle = toolColor ? ' style="stroke:' + escapeAttribute(toolColor) + '"' : "";

			return '<polyline class="cycle-stroke"' + strokeStyle + ' points="' + formatPointList(cycle.projectedPoints) + '" />';
		}


		function renderCompass(bounds, plane, compassSize, offsetX, offsetY) {
			const x = bounds.minX + offsetX + compassSize * 0.55;
			const y = bounds.minY + offsetY + compassSize * 0.55;
			const arm = compassSize * 0.42;
			const text = compassSize * 0.16;
			const stroke = 0.85;

			return [
				'<g class="compass">',
				'<line x1="' + x + '" y1="' + y + '" x2="' + (x + arm) + '" y2="' + y + '" stroke="#d4d4d4" stroke-width="' + stroke + '" vector-effect="non-scaling-stroke" />',
				'<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (y - arm) + '" stroke="#d4d4d4" stroke-width="' + stroke + '" vector-effect="non-scaling-stroke" />',
				'<text x="' + (x + arm + text * 0.4) + '" y="' + (y + text * 0.35) + '">' + axisDirectionLabel(plane.hLabel, plane.hSign) + '</text>',
				'<text x="' + (x - text * 3.2) + '" y="' + (y + text * 0.35) + '">' + axisDirectionLabel(plane.hLabel, -plane.hSign) + '</text>',
				'<text x="' + (x - text * 0.45) + '" y="' + (y - arm - text * 0.35) + '">' + axisDirectionLabel(plane.vLabel, plane.vSign) + '</text>',
				'<text x="' + (x - text * 0.45) + '" y="' + (y + text * 2.2) + '">' + axisDirectionLabel(plane.vLabel, -plane.vSign) + '</text>',
				'</g>'
			].join("");
		}

		function axisDirectionLabel(axis, sign) {
			return (sign >= 0 ? "+" : "-") + axis;
		}

		function renderZeroAxes(bounds) {
			const lines = [];

			if (bounds.minY <= 0 && bounds.minY + bounds.height >= 0) {
				lines.push('<line class="zero-line" x1="' + bounds.minX + '" y1="0" x2="' + (bounds.minX + bounds.width) + '" y2="0" />');
			}

			if (bounds.minX <= 0 && bounds.minX + bounds.width >= 0) {
				lines.push('<line class="zero-line" x1="0" y1="' + bounds.minY + '" x2="0" y2="' + (bounds.minY + bounds.height) + '" />');
			}

			return lines.join("");
		}

		function escapeAttribute(value) {
			return String(value || "")
				.replace(/&/g, "&amp;")
				.replace(/"/g, "&quot;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		}

		function boostToolColor(color) {
			const match = String(color || "").match(/^#([0-9a-f]{6})$/i);

			if (!match) {
				return color;
			}

			const red = parseInt(match[1].slice(0, 2), 16) / 255;
			const green = parseInt(match[1].slice(2, 4), 16) / 255;
			const blue = parseInt(match[1].slice(4, 6), 16) / 255;
			const max = Math.max(red, green, blue);
			const min = Math.min(red, green, blue);
			const lightness = (max + min) / 2;
			const delta = max - min;
			let hue = 0;
			let saturation = 0;

			if (delta !== 0) {
				saturation = delta / (1 - Math.abs(2 * lightness - 1));

				if (max === red) {
					hue = 60 * (((green - blue) / delta) % 6);
				} else if (max === green) {
					hue = 60 * ((blue - red) / delta + 2);
				} else {
					hue = 60 * ((red - green) / delta + 4);
				}
			}

			if (hue < 0) {
				hue += 360;
			}

			const boostedSaturation = Math.min(100, Math.round((saturation * 1.55 + 0.22) * 100));
			const boostedLightness = Math.min(66, Math.max(48, Math.round((lightness * 1.12 + 0.1) * 100)));

			return "hsl(" + Math.round(hue) + " " + boostedSaturation + "% " + boostedLightness + "%)";
		}

		planeSelect.addEventListener("change", () => {
			resetView();
		});
		labelsInput.addEventListener("change", render);
		zeroLinesInput.addEventListener("change", render);
		toolColorsInput.addEventListener("change", render);
		function updateTooltip(event) {
			if (!tooltip || dragState) {
				hideTooltip();
				return;
			}

			const target = event.target && event.target.closest ? event.target.closest(".point-label-hit") : undefined;
			const html = target && target.getAttribute("data-tooltip");

			if (!html) {
				hideTooltip();
				return;
			}

			tooltip.innerHTML = html;
			tooltip.style.display = "block";
			positionTooltip(event);
		}

		function positionTooltip(event) {
			const slotRect = viewerSlot.getBoundingClientRect();
			const tooltipRect = tooltip.getBoundingClientRect();
			let left = event.clientX - slotRect.left + 12;
			let top = event.clientY - slotRect.top + 12;

			if (left + tooltipRect.width > slotRect.width) {
				left = event.clientX - slotRect.left - tooltipRect.width - 12;
			}

			if (top + tooltipRect.height > slotRect.height) {
				top = event.clientY - slotRect.top - tooltipRect.height - 12;
			}

			tooltip.style.left = Math.max(4, left) + "px";
			tooltip.style.top = Math.max(4, top) + "px";
		}

		function hideTooltip() {
			if (tooltip) {
				tooltip.style.display = "none";
			}
		}
		document.getElementById("fit").addEventListener("click", () => {
			resetView();
		});
		document.getElementById("zoomOut").addEventListener("click", () => {
			setZoom(zoom / zoomStep);
		});
		document.getElementById("zoomIn").addEventListener("click", () => {
			setZoom(zoom * zoomStep);
		});
		viewer.addEventListener("mousemove", updateTooltip);
		viewer.addEventListener("mouseleave", hideTooltip);
		viewer.addEventListener("wheel", event => {
			event.preventDefault();
			setZoom(zoom * (event.deltaY < 0 ? wheelZoomStep : 1 / wheelZoomStep), event);
		}, { passive: false });
		viewer.addEventListener("pointerdown", event => {
			if (!currentBounds || event.button !== 0) {
				return;
			}

			viewer.setPointerCapture(event.pointerId);
			hideTooltip();
			viewer.classList.add("dragging");
			dragState = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				startPan: { x: pan.x, y: pan.y },
				bounds: currentBounds
			};
		});
		viewer.addEventListener("pointermove", event => {
			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			const rect = viewer.getBoundingClientRect();
			const dx = event.clientX - dragState.startX;
			const dy = event.clientY - dragState.startY;

			pan = {
				x: dragState.startPan.x - dx / Math.max(1, rect.width) * dragState.bounds.width,
				y: dragState.startPan.y - dy / Math.max(1, rect.height) * dragState.bounds.height
			};
			render();
		});
		viewer.addEventListener("pointerup", event => {
			if (dragState && dragState.pointerId === event.pointerId) {
				dragState = undefined;
				viewer.classList.remove("dragging");
			}
		});
		viewer.addEventListener("pointercancel", () => {
			dragState = undefined;
			viewer.classList.remove("dragging");
		});
		document.getElementById("save").addEventListener("click", () => {
			const svg = document.getElementById("vision-svg");

			if (!svg) {
				return;
			}

			vscode.postMessage({ type: "saveSvg", plane: planeSelect.value, svg: svg.outerHTML });
		});
		document.getElementById("whole").addEventListener("click", () => {
			vscode.postMessage({ type: "whole", options: { plane: planeSelect.value, useToolColors: toolColorsInput.checked } });
		});
		document.getElementById("selection").addEventListener("click", () => {
			vscode.postMessage({ type: "selection", options: { plane: planeSelect.value, useToolColors: toolColorsInput.checked } });
		});
		window.addEventListener("resize", render);

		render();
	</script>
</body>
</html>`;
}

function renderRows(rows, humanFormat) {
	if (!rows.length) {
		return "<p class=\"empty\">No motion rows found.</p>";
	}

	const body = rows.map(row => {
		if (row.type === "label") {
			const comment = row.comment ? ` ${row.comment}` : "";

			return `<tr class="label-row">
				${renderToolMarkerCell(row)}
				<td class="tool-marker-gap"></td>
				<td>${escapeHtml(row.lineNumber)}</td>
				<td colspan="5"><code>${escapeHtml(row.instruction)}</code>${escapeHtml(comment)}</td>
			</tr>`;
		}

		return `<tr>
			${renderToolMarkerCell(row)}
			<td class="tool-marker-gap"></td>
			<td>${escapeHtml(row.lineNumber)}</td>
			<td><code>${escapeHtml(row.instruction)}</code></td>
			<td>${escapeHtml(row.startLabel || "-")}</td>
			<td>${escapeHtml(row.endLabel || "-")}</td>
			<td>${escapeHtml(formatDistance(row, humanFormat))}</td>
			<td class="notes">${escapeHtml((row.warnings || []).join(" ")) || "-"}</td>
		</tr>`;
	}).join("");

	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="tool-marker-header"></th>
					<th class="tool-marker-gap"></th>
					<th>Line</th>
					<th>Move</th>
					<th>Start</th>
					<th>End</th>
					<th>Distance</th>
					<th>Notes</th>
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
	registerKaijuVisionWebview
};
