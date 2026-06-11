const path = require("path");
const vscode = require("vscode");
const {
	analyzeVisionRange,
	formatNumber,
	summarizeVisionRows
} = require("./motionEngine");
const {
	getConfiguredValue,
	getMachineModeProfile
} = require("./machineMode");

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

function getVisionOptions(document, rawOptions = {}) {
	const config = vscode.workspace.getConfiguration("kaijuNC.vision", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const profile = getMachineModeProfile(chronobladeConfig.get("machineMode", "latheDiameter"));

	return {
		plane: ["xy", "xz", "zy"].includes(rawOptions.plane) ? rawOptions.plane : config.get("plane", "xz"),
		useToolColors: rawOptions.useToolColors === true,
		machineMode: profile.id,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: getConfiguredValue(config, "xAxisMode", getConfiguredValue(chronobladeConfig, "xAxisMode", profile.xAxisMode)),
		xzOrientation: config.get("xzOrientation", "zRightXUp"),
		xyOrientation: config.get("xyOrientation", "xRightYUp"),
		zyOrientation: config.get("zyOrientation", "zRightYUp"),
		cssSurfaceSpeedUnit: config.get("cssSurfaceSpeedUnit", chronobladeConfig.get("cssSurfaceSpeedUnit", "mPerMin")),
		samples: clampNumber(config.get("samples", chronobladeConfig.get("samples", 96)), 12, 500),
		compactPanelWidth: clampNumber(config.get("compactPanelWidth", 0.55), 0.25, 0.8),
		rapidRate: clampNumber(config.get("rapidRate", chronobladeConfig.get("rapidRate", 10000)), 0, Number.POSITIVE_INFINITY),
		lineThickness: clampNumber(config.get("lineThickness", 1), 0.1, 5),
		arrowSize: clampNumber(config.get("arrowSize", 1), 0.1, 5),
		endpointSize: clampNumber(config.get("endpointSize", 3), 1, 24),
		startPointSize: clampNumber(config.get("startPointSize", 4), 1, 24),
		labelFontSize: clampNumber(config.get("labelFontSize", 9), 5, 32),
		labelOffset: clampNumber(config.get("labelOffset", 10), 0, 80),
		compassSize: clampNumber(config.get("compassSize", 78), 24, 220),
		compassOffsetX: clampNumber(config.get("compassOffsetX", 14), 0, 240),
		compassOffsetY: clampNumber(config.get("compassOffsetY", 14), 0, 240),
		g53Position: {
			x: Number(config.get("g53.x", 0)),
			y: Number(config.get("g53.y", 0)),
			z: Number(config.get("g53.z", 0))
		}
	};
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
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
				<option value="xz"${options.plane === "xz" ? " selected" : ""}>X-Z</option>
				<option value="xy"${options.plane === "xy" ? " selected" : ""}>X-Y</option>
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
		<span>${escapeHtml(formatNumber(summary.totalDistance))} total distance</span>
		${summary.unknownRows ? `<span>${escapeHtml(summary.unknownRows)} row(s) have incomplete path data</span>` : ""}
		<span class="legend"><span><span class="swatch" style="background: var(--rapid)"></span>G0</span><span><span class="swatch" style="background: var(--cut)"></span>G1/G2/G3</span></span>
	</section>

	<div id="viewerSlot" class="viewer-slot">
		<div id="viewer" class="viewer"></div>
	</div>
	${renderRows(result.rows)}

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
		const zoomLabel = document.getElementById("zoomLabel");
		let zoom = 1;
		let pan = { x: 0, y: 0 };
		let currentFitBounds;
		let currentBounds;
		let dragState;
		const planes = {
			xy: makePlane("X-Y", data.options.xyOrientation || "xRightYUp", "x", "y"),
			xz: makePlane("X-Z", data.options.xzOrientation || "zRightXUp", "x", "z"),
			zy: makePlane("Z-Y", data.options.zyOrientation || "zRightYUp", "z", "y")
		};

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
				const points = (row.points || [])
					.map(point => project(point, plane))
					.filter(Boolean);
				const end = points[points.length - 1];

				return Object.assign({}, row, { projectedPoints: points, projectedEnd: end });
			}).filter(row => row.projectedPoints.length >= 2);
		}

		function makeBounds(rows) {
			const points = [];

			for (const row of rows) {
				points.push(...row.projectedPoints);
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
			const viewerRect = viewer.getBoundingClientRect();
			const fitBounds = makeBounds(rows);
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
			const arrowSize = unitsPerPixel * 8 * data.options.arrowSize;
			const lineScale = data.options.lineThickness;

			if (!rows.length) {
				viewer.innerHTML = '<p class="empty" style="padding: 16px;">No drawable moves found for the selected plane.</p>';
				return;
			}

			const paths = rows.map(row => {
				const cls = row.motionCode === 0 ? "rapid" : "cut";
				const marker = row.motionCode === 0 ? "url(#rapid-arrow)" : "url(#cut-arrow)";
				const strokeStyle = useToolColors && row.toolColor ? ' style="stroke:' + escapeAttribute(row.toolColor) + '"' : "";
				return '<polyline class="' + cls + '"' + strokeStyle + ' marker-end="' + marker + '" points="' + formatPointList(row.projectedPoints) + '" />';
			}).join("");
			const firstRow = rows[0];
			const firstPoint = firstRow && firstRow.projectedPoints[0];
			const startPoint = firstPoint
				? renderPointLabel(firstPoint, startPointSize, labelSize, labelOffset, "start-point", "start-label", showLabels ? "START" : "", showLabels ? firstRow.startLabel : "", 1)
				: "";
			const endpoints = rows.map(row => {
				const end = row.projectedEnd || row.projectedPoints[row.projectedPoints.length - 1];

				if (!end) {
					return "";
				}

				return renderPointLabel(end, endpointSize, labelSize, labelOffset, "endpoint", "endpoint-label", showLabels ? "L" + row.lineNumber : "", showLabels ? row.endLabel : "", 1);
			}).join("");
			const zeroAxes = showZeroLines ? renderZeroAxes(bounds) : "";
			const compass = renderCompass(bounds, plane, compassSize, compassOffsetX, compassOffsetY);
			const svg = '<svg id="vision-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' + [bounds.minX, bounds.minY, bounds.width, bounds.height].map(round).join(" ") + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="KAIJU Vision ' + plane.label + ' path">' +
				'<style>' +
					'.zero-line{stroke:#6f6f6f;stroke-width:' + 0.8 * lineScale + ';stroke-dasharray:6 5;vector-effect:non-scaling-stroke;}.compass{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + compassTextSize + 'px;font-weight:600;}.endpoint-label,.start-label{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + labelSize + 'px;}.point-label{text-anchor:middle;}.rapid{fill:none;stroke:#ff8800;stroke-width:' + 1.1 * lineScale + ';stroke-dasharray:8 6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}.cut{fill:none;stroke:#ffd500;stroke-width:' + 1.4 * lineScale + ';stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}.endpoint{fill:var(--vscode-foreground,#d4d4d4);stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.75 * lineScale + ';vector-effect:non-scaling-stroke;}.start-point{fill:#6A9955;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.arrow-rapid{fill:#ff8800;}.arrow-cut{fill:#ffd500;}' +
				'</style>' +
				'<defs>' +
					'<marker id="rapid-arrow" markerWidth="' + arrowSize + '" markerHeight="' + arrowSize + '" refX="' + arrowSize + '" refY="' + arrowSize / 2 + '" orient="auto" markerUnits="userSpaceOnUse"><path class="arrow-rapid" d="M0,0 L' + arrowSize + ',' + arrowSize / 2 + ' L0,' + arrowSize + ' Z" /></marker>' +
					'<marker id="cut-arrow" markerWidth="' + arrowSize + '" markerHeight="' + arrowSize + '" refX="' + arrowSize + '" refY="' + arrowSize / 2 + '" orient="auto" markerUnits="userSpaceOnUse"><path class="arrow-cut" d="M0,0 L' + arrowSize + ',' + arrowSize / 2 + ' L0,' + arrowSize + ' Z" /></marker>' +
				'</defs>' +
				zeroAxes +
				compass +
				paths +
				startPoint +
				endpoints +
				'</svg>';

			viewer.innerHTML = svg;
		}

		function renderPointLabel(point, pointSize, labelSize, labelOffset, pointClass, labelClass, labelLine, coordinateLine, verticalDirection) {
			const x = round(point.x);
			const y = round(point.y);
			const marker = '<circle class="' + pointClass + '" cx="' + x + '" cy="' + y + '" r="' + pointSize + '" />';

			if (!labelLine && !coordinateLine) {
				return marker;
			}

			const textY = verticalDirection < 0
				? -(pointSize + labelOffset + labelSize * 0.35)
				: pointSize + labelOffset + labelSize;

			return marker +
				'<text class="point-label ' + labelClass + '" transform="translate(' + x + ' ' + y + ')" y="' + round(textY) + '">' +
					'<tspan x="0">' + svgEscape(labelLine) + '</tspan>' +
					'<tspan x="0" dy="' + round(labelSize * 1.15) + '">' + svgEscape(coordinateLine) + '</tspan>' +
				'</text>';
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

		planeSelect.addEventListener("change", () => {
			resetView();
		});
		labelsInput.addEventListener("change", render);
		zeroLinesInput.addEventListener("change", render);
		toolColorsInput.addEventListener("change", render);
		document.getElementById("fit").addEventListener("click", () => {
			resetView();
		});
		document.getElementById("zoomOut").addEventListener("click", () => {
			setZoom(zoom / 1.25);
		});
		document.getElementById("zoomIn").addEventListener("click", () => {
			setZoom(zoom * 1.25);
		});
		viewer.addEventListener("wheel", event => {
			event.preventDefault();
			setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event);
		}, { passive: false });
		viewer.addEventListener("pointerdown", event => {
			if (!currentBounds || event.button !== 0) {
				return;
			}

			viewer.setPointerCapture(event.pointerId);
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

function renderRows(rows) {
	if (!rows.length) {
		return "<p class=\"empty\">No motion rows found.</p>";
	}

	const body = rows.map(row => {
		return `<tr>
			<td>${escapeHtml(row.lineNumber)}</td>
			<td><code>${escapeHtml(row.instruction)}</code></td>
			<td>${escapeHtml(row.startLabel || "-")}</td>
			<td>${escapeHtml(row.endLabel || "-")}</td>
			<td>${escapeHtml(formatNumber(row.distance))}</td>
			<td class="notes">${escapeHtml((row.warnings || []).join(" ")) || "-"}</td>
		</tr>`;
	}).join("");

	return `<div class="table-wrap">
		<table>
			<thead>
				<tr>
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

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeScriptJson(value) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

module.exports = {
	registerKaijuVisionWebview
};
