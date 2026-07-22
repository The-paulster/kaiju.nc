// Role: own KAIJU Warpaint section painting, webview editing, and editor
// decorations. Keep generic N-label selection helpers in kaijuRangefinder.
const path = require("path");
const vscode = require("vscode");
const { TOOL_COLORS, getToolRanges } = require("../MetaToolModel");
const { buildLabelItems } = require("../kaijuRangefinder");
const { getWarpaintOptions } = require("./options");

const STORAGE_KEY = "kaijuWarpaint.sectionsByDocument";
const TOOL_MARKER_WIDTH = 4;
const SEEDED_COLOR_SATURATION = 0.72;
const SEEDED_COLOR_LIGHTNESS = 0.58;
let warpaintContext;
let warpaintPanel;
let pendingUpdate;
let warpaintDocumentUri;
const decorationTypeCache = new Map();

function registerKaijuWarpaint(context) {
	warpaintContext = context;

	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.warpaint", async () => {
			await openWarpaintPanel();
		}),
		vscode.commands.registerCommand("kaijuNC.warpaint.addSelection", async () => {
			await addActiveSelectionAsWarpaintSection();
		}),
		vscode.window.onDidChangeActiveTextEditor(scheduleUpdate),
		vscode.window.onDidChangeVisibleTextEditors(scheduleUpdate),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) {
				scheduleUpdate();
				refreshWarpaintPanel();
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (
				event.affectsConfiguration("kaijuNC.warpaint")
				|| event.affectsConfiguration("kaijuNC.syntax.toolDecorations.enabled")
			) {
				scheduleUpdate();
			}
		}),
		{
			dispose() {
				clearTimeout(pendingUpdate);
				for (const decorationType of decorationTypeCache.values()) {
					decorationType.dispose();
				}
				decorationTypeCache.clear();
			}
		}
	);

	updateVisibleWarpaintDecorations();
}

async function openWarpaintPanel() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before using KAIJU Warpaint.");
		return;
	}

	warpaintDocumentUri = editor.document.uri;

	if (warpaintPanel) {
		warpaintPanel.reveal(vscode.ViewColumn.Beside);
		refreshWarpaintPanel();
		return;
	}

	warpaintPanel = vscode.window.createWebviewPanel(
		"kaijuWarpaint",
		"KAIJU Warpaint",
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			retainContextWhenHidden: true
		}
	);

	warpaintPanel.onDidDispose(() => {
		warpaintPanel = undefined;
		warpaintDocumentUri = undefined;
	});

	warpaintPanel.webview.onDidReceiveMessage(async message => {
		if (!message) {
			return;
		}

		const targetDocument = getWarpaintDocument();

		if (!targetDocument) {
			vscode.window.showWarningMessage("KAIJU Warpaint could not find its target G-code document.");
			return;
		}

		if (message.type === "updateSections") {
			await setStoredSections(targetDocument, normalizeSections(message.sections));
			scheduleUpdate();
		} else if (message.type === "copySections") {
			await copyWarpaintSectionsFromDocument(targetDocument);
		} else if (message.type === "addSelectionAsSection") {
			await addSelectionAsWarpaintSection(targetDocument);
		} else if (message.type === "appendSelectionToSection") {
			await appendSelectionToWarpaintSection(targetDocument, message.sectionId);
		}
	});

	refreshWarpaintPanel();
}

async function addActiveSelectionAsWarpaintSection() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Select G-code before adding it to KAIJU Warpaint.");
		return;
	}

	await addSelectionAsWarpaintSection(editor.document, editor);
}

async function addSelectionAsWarpaintSection(targetDocument, sourceEditor) {
	const editor = sourceEditor || findVisibleEditorForDocument(targetDocument);

	if (!editor) {
		vscode.window.showWarningMessage("KAIJU Warpaint could not find the target editor selection.");
		return;
	}

	const rangeText = getWarpaintRangeTextFromSelection(editor);

	if (!rangeText) {
		vscode.window.showWarningMessage("KAIJU Warpaint needs an N-label before the selected area.");
		return;
	}

	const sections = getStoredSections(targetDocument);

	sections.unshift({
		id: `section-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		name: formatRangeName(rangeText),
		color: getSeededSectionColor(targetDocument, rangeText, sections.length),
		rangesText: rangeText,
		enabled: true,
		background: false
	});

	await setStoredSections(targetDocument, sections);
	scheduleUpdate();
	await revealOrRefreshWarpaintPanel(targetDocument);
	vscode.window.showInformationMessage(`KAIJU Warpaint added ${rangeText}.`);
}

async function revealOrRefreshWarpaintPanel(document) {
	warpaintDocumentUri = document.uri;

	if (warpaintPanel) {
		warpaintPanel.reveal(vscode.ViewColumn.Beside);
		refreshWarpaintPanel();
		return;
	}

	await openWarpaintPanel();
}

async function appendSelectionToWarpaintSection(targetDocument, sectionId) {
	const editor = findVisibleEditorForDocument(targetDocument);

	if (!editor) {
		vscode.window.showWarningMessage("KAIJU Warpaint could not find the target editor selection.");
		return;
	}

	const rangeText = getWarpaintRangeTextFromSelection(editor);

	if (!rangeText) {
		vscode.window.showWarningMessage("KAIJU Warpaint needs an N-label before the selected area.");
		return;
	}

	const sections = getStoredSections(targetDocument);
	const section = sections.find(item => item.id === sectionId);

	if (!section) {
		vscode.window.showWarningMessage("KAIJU Warpaint could not find that section.");
		return;
	}

	section.rangesText = appendRangeText(section.rangesText, rangeText);
	await setStoredSections(targetDocument, sections);
	scheduleUpdate();
	refreshWarpaintPanel();
	vscode.window.showInformationMessage(`KAIJU Warpaint added ${rangeText} to ${section.name}.`);
}

function findVisibleEditorForDocument(document) {
	return vscode.window.visibleTextEditors.find(editor =>
		editor.document.uri.toString() === document.uri.toString()
	);
}

function getWarpaintRangeTextFromSelection(editor) {
	const labels = buildLabelItems(editor.document);
	const lineSpan = getSelectionLineSpan(editor);
	const labelsInSelection = labels.filter(label =>
		label.lineNumber >= lineSpan.startLine && label.lineNumber <= lineSpan.endLine
	);
	const start = findNearestLabelAtOrBefore(labels, lineSpan.startLine) || labelsInSelection[0];
	const end = findNearestLabelAtOrBefore(labels, lineSpan.endLine);

	if (!start || !end) {
		return undefined;
	}

	return start.value === end.value
		? `${start.value}`
		: `${start.value}-${end.value}`;
}

function getSelectionLineSpan(editor) {
	const selection = editor.selection;
	const startLine = Math.min(selection.start.line, selection.end.line);
	let endLine = Math.max(selection.start.line, selection.end.line);

	if (!selection.isEmpty && selection.end.character === 0 && endLine > startLine) {
		endLine -= 1;
	}

	return {
		startLine,
		endLine
	};
}

function findNearestLabelAtOrBefore(labels, lineNumber) {
	let nearest;

	for (const label of labels) {
		if (label.lineNumber > lineNumber) {
			break;
		}

		nearest = label;
	}

	return nearest;
}

function appendRangeText(existingText, rangeText) {
	const parts = String(existingText || "")
		.split(",")
		.map(part => part.trim())
		.filter(Boolean);

	if (!parts.some(part => part.toLowerCase() === rangeText.toLowerCase())) {
		parts.push(rangeText);
	}

	return parts.join(", ");
}

function formatRangeName(rangeText) {
	const parts = String(rangeText || "")
		.split("-")
		.map(part => part.trim())
		.filter(Boolean);

	return parts.map(part => `N${part}`).join("-");
}

function getSeededSectionColor(document, rangeText, index) {
	const fileName = document && document.fileName ? path.basename(document.fileName) : "untitled";
	const seed = `${fileName}:${rangeText}:${index}`;
	const hue = hashString(seed) % 360;

	return hslToHex(hue / 360, SEEDED_COLOR_SATURATION, SEEDED_COLOR_LIGHTNESS);
}

function hashString(text) {
	let hash = 2166136261;

	for (const character of String(text || "")) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function hslToHex(hue, saturation, lightness) {
	const q = lightness < 0.5
		? lightness * (1 + saturation)
		: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	const red = hueToRgb(p, q, hue + 1 / 3);
	const green = hueToRgb(p, q, hue);
	const blue = hueToRgb(p, q, hue - 1 / 3);

	return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
}

function hueToRgb(p, q, hue) {
	let adjustedHue = hue;

	if (adjustedHue < 0) {
		adjustedHue += 1;
	}
	if (adjustedHue > 1) {
		adjustedHue -= 1;
	}
	if (adjustedHue < 1 / 6) {
		return p + (q - p) * 6 * adjustedHue;
	}
	if (adjustedHue < 1 / 2) {
		return q;
	}
	if (adjustedHue < 2 / 3) {
		return p + (q - p) * (2 / 3 - adjustedHue) * 6;
	}

	return p;
}

function toHexByte(value) {
	return Math.round(Math.max(0, Math.min(1, value)) * 255)
		.toString(16)
		.padStart(2, "0");
}

function refreshWarpaintPanel() {
	if (!warpaintPanel) {
		return;
	}

	const document = getWarpaintDocument();

	if (!document) {
		warpaintPanel.webview.html = renderWarpaintHtml([], "No active G-code document.");
		return;
	}

	const sections = getStoredSections(document);
	warpaintPanel.webview.html = renderWarpaintHtml(sections, path.basename(document.fileName));
}

function getWarpaintDocument() {
	if (!warpaintDocumentUri) {
		return undefined;
	}

	return vscode.workspace.textDocuments.find(document =>
		document.languageId === "gcode" && document.uri.toString() === warpaintDocumentUri.toString()
	);
}

function scheduleUpdate() {
	clearTimeout(pendingUpdate);
	pendingUpdate = setTimeout(updateVisibleWarpaintDecorations, 100);
}

function updateVisibleWarpaintDecorations() {
	for (const editor of vscode.window.visibleTextEditors) {
		updateWarpaintDecorations(editor);
	}
}

function updateWarpaintDecorations(editor) {
	clearEditorWarpaintDecorations(editor);

	if (editor.document.languageId !== "gcode") {
		return;
	}

	const options = getWarpaintOptions(editor.document);

	const toolRanges = areToolDecorationsEnabled(editor.document) && options.markerCompositorEnabled
		? getToolRanges(editor.document)
		: [];

	if (!options.enabled && !toolRanges.length) {
		return;
	}

	const sections = options.enabled ? getStoredSections(editor.document).filter(section => section.enabled) : [];

	if (!sections.length && !toolRanges.length) {
		return;
	}

	const labels = buildLabelItems(editor.document);
	const lineSections = resolveLineSections(sections, labels, editor.document.lineCount);
	const lineTools = resolveLineTools(toolRanges, editor.document.lineCount);
	const groupedDecorations = new Map();

	for (let lineNumber = 0; lineNumber < editor.document.lineCount; lineNumber++) {
		const matches = lineSections[lineNumber] || [];
		const tool = lineTools[lineNumber];

		if (!matches.length && !tool) {
			continue;
		}

		if (options.markerCompositorEnabled && (tool || matches.length)) {
			const decorationType = getMarkerDecorationType(tool, matches, options);
			pushDecoration(groupedDecorations, decorationType, lineNumber);
		}
		if (options.overviewRulerEnabled) {
			matches.forEach(section => {
				const decorationType = getOverviewRulerDecorationType(section.color);
				pushDecoration(groupedDecorations, decorationType, lineNumber);
			});
		}

		const topBackground = matches.find(section => section.background);

		if (topBackground) {
			const decorationType = getBackgroundDecorationType(
				topBackground.color,
				options.backgroundIntensity
			);
			pushDecoration(groupedDecorations, decorationType, lineNumber);
		}
	}

	for (const [decorationType, ranges] of groupedDecorations.entries()) {
		editor.setDecorations(decorationType, ranges);
	}
}

function clearEditorWarpaintDecorations(editor) {
	for (const decorationType of decorationTypeCache.values()) {
		editor.setDecorations(decorationType, []);
	}
}

function pushDecoration(groupedDecorations, decorationType, lineNumber) {
	const decorations = groupedDecorations.get(decorationType) || [];
	const decoration = { range: new vscode.Range(lineNumber, 0, lineNumber, 0) };

	decorations.push(decoration);
	groupedDecorations.set(decorationType, decorations);
}

function resolveLineTools(toolRanges, lineCount) {
	const lineTools = Array.from({ length: lineCount }, () => undefined);

	for (const toolRange of toolRanges) {
		const color = TOOL_COLORS[toolRange.colorIndex] || TOOL_COLORS[0];

		for (let lineNumber = toolRange.startLine; lineNumber <= toolRange.endLine && lineNumber < lineCount; lineNumber++) {
			if (lineNumber >= 0) {
				lineTools[lineNumber] = {
					name: toolRange.tool,
					color
				};
			}
		}
	}

	return lineTools;
}

function areToolDecorationsEnabled(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.syntax", document.uri);

	return config.get("toolDecorations.enabled", true);
}

function getMarkerDecorationType(tool, sections, options) {
	const visibleSections = sections.slice(0, options.markerMaxSections);
	const key = [
		"marker",
		tool ? normalizeColor(tool.color) : "none",
		options.markerMaxSections,
		options.markerSectionStripeWidth,
		options.markerToolGap,
		options.markerVerticalOverflow,
		...visibleSections.map(section => normalizeColor(section.color)),
	].join(":");
	const existing = decorationTypeCache.get(key);

	if (existing) {
		return existing;
	}

	const decorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeMarkerUri(tool, sections, options),
		gutterIconSize: "contain",
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
	});

	decorationTypeCache.set(key, decorationType);
	warpaintContext.subscriptions.push(decorationType);
	return decorationType;
}

function makeMarkerUri(tool, sections, options) {
	const size = getMarkerSize(sections, options);
	const visibleSections = sections.slice(0, options.markerMaxSections);
	const sectionWidth = options.markerSectionStripeWidth;
	const toolGap = options.markerMaxSections > 0 ? options.markerToolGap : 0;
	const height = 16;
	const overflow = options.markerVerticalOverflow;
	let x = 0;
	const rects = [
		makeMarkerRect(0, -overflow, size.width, height + overflow * 2, "#ffffff", "0.001")
	];

	if (tool) {
		rects.push(makeMarkerRect(x, -overflow, TOOL_MARKER_WIDTH, height + overflow * 2, normalizeColor(tool.color), "0.92"));
	}
	x += TOOL_MARKER_WIDTH + toolGap;

	for (const section of visibleSections) {
		rects.push(makeMarkerRect(x, -overflow, sectionWidth, height + overflow * 2, normalizeColor(section.color), "0.9"));
		x += sectionWidth;
	}

	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${roundMarkerNumber(size.width)}" height="${roundMarkerNumber(size.height)}" viewBox="0 ${roundMarkerNumber(-overflow)} ${roundMarkerNumber(size.width)} ${roundMarkerNumber(size.height)}" shape-rendering="crispEdges">`,
		...rects,
		"</svg>"
	].join("");

	return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function getMarkerSize(sections, options) {
	const sectionWidth = options.markerSectionStripeWidth;
	const toolGap = options.markerMaxSections > 0 ? options.markerToolGap : 0;
	const sectionTotal = options.markerMaxSections ? options.markerMaxSections * sectionWidth : 0;
	const width = Math.max(
		TOOL_MARKER_WIDTH + toolGap + sectionTotal,
		1
	);
	const height = 16 + options.markerVerticalOverflow * 2;

	return { width, height };
}

function makeMarkerRect(x, y, width, height, color, opacity) {
	return `<rect x="${roundMarkerNumber(x)}" y="${roundMarkerNumber(y)}" width="${roundMarkerNumber(width)}" height="${roundMarkerNumber(height)}" fill="${color}" fill-opacity="${opacity}"/>`;
}

function roundMarkerNumber(value) {
	return Math.round(Number(value) * 100) / 100;
}

function getOverviewRulerDecorationType(color) {
	const safeColor = normalizeColor(color);
	const key = `overview:${safeColor}`;
	const existing = decorationTypeCache.get(key);

	if (existing) {
		return existing;
	}

	const decorationType = vscode.window.createTextEditorDecorationType({
		overviewRulerColor: makeRgba(safeColor, 0.85),
		overviewRulerLane: vscode.OverviewRulerLane.Center,
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
	});

	decorationTypeCache.set(key, decorationType);
	warpaintContext.subscriptions.push(decorationType);
	return decorationType;
}

function getBackgroundDecorationType(color, intensity) {
	const safeColor = normalizeColor(color);
	const safeIntensity = Math.round(Math.max(0, Math.min(0.5, intensity)) * 1000) / 1000;
	const key = `background:${safeColor}:${safeIntensity}`;
	const existing = decorationTypeCache.get(key);

	if (existing) {
		return existing;
	}

	const backgroundColor = makeRgba(safeColor, safeIntensity);
	const decorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor,
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
	});

	decorationTypeCache.set(key, decorationType);
	warpaintContext.subscriptions.push(decorationType);
	return decorationType;
}

function getStoredSections(document) {
	const allSections = getAllStoredSections();
	const sections = allSections[getDocumentStorageKey(document)];

	return Array.isArray(sections) ? normalizeSections(sections) : [];
}

async function setStoredSections(document, sections) {
	const allSections = getAllStoredSections();
	allSections[getDocumentStorageKey(document)] = normalizeSections(sections);
	await warpaintContext.workspaceState.update(STORAGE_KEY, allSections);
}

async function copyWarpaintSectionsFromDocument(targetDocument) {
	const source = await pickWarpaintSourceDocument(targetDocument);

	if (!source) {
		return;
	}

	await setStoredSections(targetDocument, cloneSectionsForCopy(source.sections));
	scheduleUpdate();
	refreshWarpaintPanel();
	vscode.window.showInformationMessage(`KAIJU Warpaint copied ${source.sections.length} section${source.sections.length === 1 ? "" : "s"} from ${source.label}.`);
}

async function pickWarpaintSourceDocument(targetDocument) {
	const targetKey = getDocumentStorageKey(targetDocument);
	const targetDirectory = getUriDirectory(targetDocument.uri);
	const items = Object.entries(getAllStoredSections())
		.filter(([key, sections]) => key !== targetKey && Array.isArray(sections) && sections.length)
		.map(([key, sections]) => makeWarpaintSourceItem(key, sections, targetDirectory))
		.filter(Boolean)
		.sort((a, b) => Number(b.sameDirectory) - Number(a.sameDirectory) || a.label.localeCompare(b.label));

	if (!items.length) {
		vscode.window.showInformationMessage("KAIJU Warpaint does not have any saved sections in another file yet.");
		return undefined;
	}

	return vscode.window.showQuickPick(items, {
		placeHolder: "Copy KAIJU Warpaint from..."
	});
}

function makeWarpaintSourceItem(key, sections, targetDirectory) {
	const uri = parseStoredUri(key);
	const normalizedSections = normalizeSections(sections);

	if (!uri || !normalizedSections.length) {
		return undefined;
	}

	const sectionNames = normalizedSections
		.slice(0, 3)
		.map(section => section.name)
		.join(", ");
	const extraCount = normalizedSections.length > 3 ? `, +${normalizedSections.length - 3}` : "";
	const label = getUriDisplayName(uri);

	return {
		label,
		description: `${normalizedSections.length} section${normalizedSections.length === 1 ? "" : "s"}`,
		detail: `${sectionNames}${extraCount}`,
		sections: normalizedSections,
		sameDirectory: getUriDirectory(uri) === targetDirectory
	};
}

function parseStoredUri(key) {
	try {
		return vscode.Uri.parse(key);
	} catch (error) {
		return undefined;
	}
}

function getUriDisplayName(uri) {
	if (uri.scheme === "file" && uri.fsPath) {
		return path.basename(uri.fsPath);
	}

	return path.basename(uri.path || uri.toString()) || uri.toString();
}

function getUriDirectory(uri) {
	if (uri.scheme === "file" && uri.fsPath) {
		return path.dirname(uri.fsPath);
	}

	return path.dirname(uri.path || "");
}

function cloneSectionsForCopy(sections) {
	return normalizeSections(sections).map((section, index) => ({
		...section,
		id: `section-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`
	}));
}

function getAllStoredSections() {
	return Object.assign({}, warpaintContext.workspaceState.get(STORAGE_KEY, {}));
}

function getDocumentStorageKey(document) {
	return document.uri.toString();
}

function normalizeSections(sections) {
	return (Array.isArray(sections) ? sections : [])
		.map((section, index) => ({
			id: String(section.id || `section-${Date.now()}-${index}`),
			name: String(section.name || `Section ${index + 1}`).trim() || `Section ${index + 1}`,
			color: normalizeColor(section.color),
			rangesText: String(section.rangesText || "").trim(),
			enabled: section.enabled !== false,
			background: section.background === true
		}));
}

function resolveLineSections(sections, labels, lineCount) {
	const lineSections = Array.from({ length: lineCount }, () => []);

	for (const section of sections) {
		for (const span of resolveSectionSpans(section, labels, lineCount)) {
			for (let lineNumber = span.startLine; lineNumber <= span.endLine; lineNumber++) {
				lineSections[lineNumber].push(section);
			}
		}
	}

	return lineSections;
}

function resolveSectionSpans(section, labels, lineCount) {
	const spans = [];

	for (const range of parseNLabelRangeText(section.rangesText)) {
		const start = findLabelByValue(labels, range.start);
		const end = findLabelByValue(labels, range.end);

		if (!start || !end) {
			continue;
		}

		const startLine = Math.min(start.lineNumber, end.lineNumber);
		const endLabelLine = Math.max(start.lineNumber, end.lineNumber);
		const endLabel = labels.find(label => label.lineNumber === endLabelLine);
		const endIndex = labels.indexOf(endLabel);
		const nextLabel = endIndex === -1 ? undefined : labels[endIndex + 1];
		const endLine = Math.max(startLine, nextLabel ? nextLabel.lineNumber - 1 : lineCount - 1);

		spans.push({ startLine, endLine });
	}

	return mergeSpans(spans);
}

function parseNLabelRangeText(text) {
	const ranges = [];

	for (const token of String(text || "").split(",")) {
		const match = token.trim().match(/^N?(\d+)(?:\s*-\s*N?(\d+))?$/i);

		if (!match) {
			continue;
		}

		const start = Number.parseInt(match[1], 10);
		const end = Number.parseInt(match[2] || match[1], 10);

		if (Number.isFinite(start) && Number.isFinite(end)) {
			ranges.push({ start, end });
		}
	}

	return ranges;
}

function findLabelByValue(labels, value) {
	return labels.find(label => label.value === value);
}

function mergeSpans(spans) {
	const sortedSpans = spans
		.slice()
		.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
	const mergedSpans = [];

	for (const span of sortedSpans) {
		const previous = mergedSpans[mergedSpans.length - 1];

		if (previous && span.startLine <= previous.endLine + 1) {
			previous.endLine = Math.max(previous.endLine, span.endLine);
			continue;
		}

		mergedSpans.push({ ...span });
	}

	return mergedSpans;
}

function normalizeColor(color) {
	const text = String(color || "").trim();

	return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toLowerCase() : "#4fc3ff";
}

function makeRgba(color, alpha) {
	const normalized = normalizeColor(color);
	const red = Number.parseInt(normalized.slice(1, 3), 16);
	const green = Number.parseInt(normalized.slice(3, 5), 16);
	const blue = Number.parseInt(normalized.slice(5, 7), 16);

	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function renderWarpaintHtml(sections, documentName) {
	const payload = JSON.stringify({
		sections,
		documentName
	}).replace(/</g, "\\u003c");

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>KAIJU Warpaint</title>
	<style>
		:root {
			color-scheme: dark;
			--bg: var(--vscode-editor-background, #1e1e1e);
			--fg: var(--vscode-editor-foreground, #d4d4d4);
			--muted: var(--vscode-descriptionForeground, #9ca3af);
			--border: var(--vscode-panel-border, #3c3c3c);
			--input: var(--vscode-input-background, #252526);
			--button: var(--vscode-button-background, #0e639c);
			--button-fg: var(--vscode-button-foreground, #ffffff);
		}
		body {
			margin: 0;
			padding: 14px;
			background: var(--bg);
			color: var(--fg);
			font-family: var(--vscode-font-family, Segoe UI, sans-serif);
			font-size: var(--vscode-font-size, 13px);
		}
		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			margin-bottom: 12px;
		}
		h1 {
			font-size: 15px;
			font-weight: 650;
			margin: 0;
		}
		.document-name {
			color: var(--muted);
			font-size: 12px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.toolbar,
		.section-actions {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		button {
			border: 1px solid var(--button);
			border-radius: 3px;
			background: var(--button);
			color: var(--button-fg);
			padding: 4px 8px;
			font: inherit;
			cursor: pointer;
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground, #3a3d41);
			color: var(--vscode-button-secondaryForeground, var(--fg));
		}
		button.copy {
			background: var(--button);
			color: var(--button-fg);
		}
		button.selection {
			background: var(--button);
			color: var(--button-fg);
			white-space: nowrap;
		}
		button:disabled {
			cursor: default;
			opacity: 0.45;
		}
		.autosave {
			color: var(--muted);
			font-size: 12px;
			min-width: 58px;
			text-align: right;
		}
		.sections {
			display: grid;
			gap: 10px;
		}
		.section {
			border: 1px solid var(--border);
			border-radius: 6px;
			background: color-mix(in srgb, var(--bg) 88%, var(--fg) 12%);
			display: grid;
			grid-template-columns: 18px minmax(0, 1fr);
			overflow: hidden;
		}
		.paint-color {
			appearance: none;
			-webkit-appearance: none;
			width: 18px;
			height: 100%;
			min-height: 134px;
			border: 0;
			background: var(--paint-color, #4fc3ff);
			padding: 0;
			cursor: pointer;
		}
		.paint-color::-webkit-color-swatch-wrapper {
			padding: 0;
		}
		.paint-color::-webkit-color-swatch {
			border: 0;
		}
		.section-body {
			padding: 10px;
		}
		.section-head {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 8px;
			align-items: center;
			margin-bottom: 8px;
		}
		input[type="text"],
		textarea {
			box-sizing: border-box;
			width: 100%;
			border: 1px solid var(--border);
			border-radius: 3px;
			background: var(--input);
			color: var(--fg);
			font: inherit;
		}
		input[type="text"] {
			height: 26px;
			padding: 3px 6px;
		}
		textarea {
			min-height: 58px;
			resize: vertical;
			padding: 6px;
			font-family: var(--vscode-editor-font-family, Consolas, monospace);
		}
		label {
			color: var(--muted);
			display: block;
			font-size: 12px;
			margin-bottom: 4px;
		}
		.range-row {
			display: grid;
			gap: 4px;
			margin-bottom: 8px;
		}
		.toggle-row {
			display: flex;
			align-items: center;
			gap: 14px;
			flex-wrap: wrap;
			color: var(--fg);
			font-size: 12px;
		}
		.toggle-row label {
			align-items: center;
			display: flex;
			gap: 6px;
			margin: 0;
		}
		.empty {
			border: 1px dashed var(--border);
			border-radius: 6px;
			color: var(--muted);
			padding: 18px 12px;
			text-align: center;
		}
	</style>
</head>
<body>
	<header>
		<div>
			<h1>KAIJU Warpaint</h1>
			<div id="documentName" class="document-name"></div>
		</div>
		<div class="toolbar">
			<button id="add" title="Add a new KAIJU Warpaint section">New Paint</button>
			<button id="addSelection" class="selection" title="Add current editor selection as a new top-priority Warpaint section">New Paint from Selection</button>
			<button id="copy" class="copy" title="Copy saved paints from another file">Copy Paint from...</button>
			<span id="autosave" class="autosave">Live</span>
		</div>
	</header>
	<main id="sections" class="sections"></main>
	<script>
		const vscode = acquireVsCodeApi();
		const state = ${payload};
		const sectionsEl = document.getElementById("sections");
		const documentNameEl = document.getElementById("documentName");
		const autosaveEl = document.getElementById("autosave");
		let saveTimer;
		documentNameEl.textContent = state.documentName || "";

		function render() {
			sectionsEl.innerHTML = "";
			if (!state.sections.length) {
				const empty = document.createElement("div");
				empty.className = "empty";
				empty.textContent = "Add a section to start painting N-label ranges.";
				sectionsEl.appendChild(empty);
				return;
			}
			state.sections.forEach((section, index) => {
				const el = document.createElement("section");
				el.className = "section";
				el.style.setProperty("--paint-color", section.color || "#4fc3ff");
				el.innerHTML = [
					'<input class="paint-color" type="color" data-field="color" value="' + escapeAttribute(section.color || "#4fc3ff") + '" title="Paint color">',
					'<div class="section-body">',
					'<div class="section-head">',
					'<input type="text" data-field="name" value="' + escapeAttribute(section.name || "") + '" placeholder="Section name">',
					'<div class="section-actions">',
					'<button class="icon secondary" data-action="up" title="Move earlier" ' + (index === 0 ? "disabled" : "") + '>+</button>',
					'<button class="icon secondary" data-action="down" title="Move later" ' + (index === state.sections.length - 1 ? "disabled" : "") + '>-</button>',
					'<button class="secondary" data-action="remove" title="Remove section">Remove</button>',
					'</div>',
					'</div>',
					'<div class="range-row">',
					'<textarea data-field="rangesText" spellcheck="false" placeholder="Enter N ranges here eg 1-100">' + escapeHtml(section.rangesText || "") + '</textarea>',
					'</div>',
					'<div class="toggle-row">',
					'<label><input type="checkbox" data-field="enabled" ' + (section.enabled !== false ? "checked" : "") + '> Enabled</label>',
					'<label><input type="checkbox" data-field="background" ' + (section.background === true ? "checked" : "") + '> Background tint when highest priority</label>',
					'<button class="selection" data-action="appendSelection" title="Add current editor selection to this paint">Add Selection</button>',
					'</div>',
					'</div>',
				].join("");
				bindSection(el, section, index);
				sectionsEl.appendChild(el);
			});
		}

		function bindSection(el, section, index) {
			el.querySelectorAll("[data-field]").forEach(input => {
				input.addEventListener("input", () => {
					const field = input.getAttribute("data-field");
					section[field] = input.type === "checkbox" ? input.checked : input.value;
					if (field === "color") {
						el.style.setProperty("--paint-color", section.color || "#4fc3ff");
					}
					queueUpdate();
				});
				input.addEventListener("change", () => {
					const field = input.getAttribute("data-field");
					section[field] = input.type === "checkbox" ? input.checked : input.value;
					if (field === "color") {
						el.style.setProperty("--paint-color", section.color || "#4fc3ff");
					}
					queueUpdate();
				});
			});
			el.querySelectorAll("[data-action]").forEach(button => {
				button.addEventListener("click", () => {
					const action = button.getAttribute("data-action");
					if (action === "remove") {
						state.sections.splice(index, 1);
					} else if (action === "up" && index > 0) {
						const moved = state.sections.splice(index, 1)[0];
						state.sections.splice(index - 1, 0, moved);
					} else if (action === "down" && index < state.sections.length - 1) {
						const moved = state.sections.splice(index, 1)[0];
						state.sections.splice(index + 1, 0, moved);
					} else if (action === "appendSelection") {
						vscode.postMessage({
							type: "appendSelectionToSection",
							sectionId: section.id
						});
						return;
					}
					render();
					queueUpdate();
				});
			});
		}

		function addSection() {
			const id = "section-" + Date.now() + "-" + Math.random().toString(16).slice(2);
			state.sections.push({
				id,
				name: "New Section",
				color: getSeededColor((state.documentName || "untitled") + ":" + id + ":" + state.sections.length),
				rangesText: "",
				enabled: true,
				background: false
			});
			render();
			queueUpdate();
		}

		function queueUpdate() {
			window.clearTimeout(saveTimer);
			autosaveEl.textContent = "Editing";
			saveTimer = window.setTimeout(updateSections, 180);
		}

		function updateSections() {
			autosaveEl.textContent = "Live";
			vscode.postMessage({
				type: "updateSections",
				sections: state.sections
			});
		}

		function copySections() {
			vscode.postMessage({
				type: "copySections"
			});
		}

		function addSelectionAsSection() {
			vscode.postMessage({
				type: "addSelectionAsSection"
			});
		}

		function escapeHtml(value) {
			return String(value || "").replace(/[&<>"]/g, ch => ({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;"
			}[ch]));
		}

		function escapeAttribute(value) {
			return escapeHtml(value).replace(/'/g, "&#39;");
		}

		function getSeededColor(seed) {
			const hue = hashString(seed) % 360;
			return hslToHex(hue / 360, 0.72, 0.58);
		}

		function hashString(text) {
			let hash = 2166136261;
			for (let index = 0; index < String(text || "").length; index++) {
				hash ^= String(text || "").charCodeAt(index);
				hash = Math.imul(hash, 16777619);
			}
			return hash >>> 0;
		}

		function hslToHex(hue, saturation, lightness) {
			const q = lightness < 0.5
				? lightness * (1 + saturation)
				: lightness + saturation - lightness * saturation;
			const p = 2 * lightness - q;
			const red = hueToRgb(p, q, hue + 1 / 3);
			const green = hueToRgb(p, q, hue);
			const blue = hueToRgb(p, q, hue - 1 / 3);
			return "#" + toHexByte(red) + toHexByte(green) + toHexByte(blue);
		}

		function hueToRgb(p, q, hue) {
			let adjustedHue = hue;
			if (adjustedHue < 0) {
				adjustedHue += 1;
			}
			if (adjustedHue > 1) {
				adjustedHue -= 1;
			}
			if (adjustedHue < 1 / 6) {
				return p + (q - p) * 6 * adjustedHue;
			}
			if (adjustedHue < 1 / 2) {
				return q;
			}
			if (adjustedHue < 2 / 3) {
				return p + (q - p) * (2 / 3 - adjustedHue) * 6;
			}
			return p;
		}

		function toHexByte(value) {
			return Math.round(Math.max(0, Math.min(1, value)) * 255)
				.toString(16)
				.padStart(2, "0");
		}

		document.getElementById("add").addEventListener("click", addSection);
		document.getElementById("addSelection").addEventListener("click", addSelectionAsSection);
		document.getElementById("copy").addEventListener("click", copySections);
		render();
	</script>
</body>
</html>`;
}

module.exports = {
	registerKaijuWarpaint,
	parseNLabelRangeText,
	resolveSectionSpans
};
