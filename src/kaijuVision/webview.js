// Role: render and run KAIJU Vision motion-table reports. Keep shared motion
// interpretation in MetaMotionEngine.js and machine defaults in
// MetaMachineMode.js.
const vscode = require("vscode");
const {
	analyzeVisionRange,
	formatNumber,
	summarizeVisionRows
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
const { MACRO_REGEX, buildAliasEntries, buildMacroAliasMap, normalizeMacro, resolveMacroAlias } = require("../MetaMacroEngine");
const { maskProtectedRanges } = require("../MetaTextRanges");
const {
	VISION_WORK_OFFSET_CODES,
	getVisionOptions,
	normalizeVisionWorkOffsets
} = require("./options");

let visionPanel;
let visionState;
let visionContext;

function registerKaijuVisionWebview(context) {
	visionContext = context;
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.vision", async () => {
			await runKaijuVision();
		}),
		onDidChangeExecutionTrace(document => {
			void refreshLiveVision(document);
		}),
		onDidChangeMachineMode(document => {
			void resetVisionPlaneForMachineMode(document);
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.chronoblade.machineMode") || event.affectsConfiguration("kaijuNC.chronoblade.gCodeDialect")) {
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.languageId === "gcode") {
					void resetVisionPlaneForMachineMode(editor.document);
				}
			}
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
	const options = makeVisionOptions(editor.document);

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

			if (message.type === "saveOffsets") {
				await saveOffsetsFromWebview(message.offsets, message.options || {});
				return;
			}
			if (message.type === "resetOffsets") {
				await resetOffsetsFromWebview(message.options || {});
				return;
			}
			if (message.type === "revealVisionSourceLine") {
				await revealVisionSourceLine(message.lineNumber);
				return;
			}
			if (message.type === "setVisionAnalysis") {
				const editor = getVisionSourceEditor();
				if (editor) {
					await saveDocumentVisionSettings(editor.document, message.options || {});
					const options = makeVisionOptions(editor.document, message.options || {});
					visionState = { documentUriText: editor.document.uri.toString(), mode: visionState.mode, options };
					await renderVisionPanel(editor, visionState.mode, options);
				}
			}
			if (message.type === "startVisionPlayback") {
				const editor = getVisionSourceEditor();
				if (editor) {
					const options = makeVisionOptions(editor.document, Object.assign({}, visionState.options, {
						analysisMode: "trace",
						playbackAutoStart: true
					}));
					options.playbackAutoStart = true;
					visionState = {
						documentUriText: editor.document.uri.toString(),
						mode: visionState.mode,
						options,
						playbackLocked: true
					};
					await renderVisionPanel(editor, visionState.mode, options);
				}
				return;
			}
			if (message.type === "stopVisionPlayback") {
				const editor = getVisionSourceEditor();
				if (editor) {
					const options = makeVisionOptions(editor.document, Object.assign({}, visionState.options, { playbackAutoStart: false }));
					visionState = {
						documentUriText: editor.document.uri.toString(),
						mode: visionState.mode,
						options,
						playbackLocked: false
					};
					await renderVisionPanel(editor, visionState.mode, options);
				}
				return;
			}
			if (message.type === "setVisionLive") {
				const editor = getVisionSourceEditor();
				if (editor) {
					await saveDocumentVisionSettings(editor.document, message.options || {});
					const options = makeVisionOptions(editor.document, message.options || {});
					visionState = { documentUriText: editor.document.uri.toString(), mode: visionState.mode, options };
					if (options.live) scheduleExecutionTrace(editor.document);
				}
			}
			if (message.type === "saveVisionSettings") {
				const editor = getVisionSourceEditor();
				if (editor) {
					await saveDocumentVisionSettings(editor.document, message.options || {});
					visionState = {
						documentUriText: editor.document.uri.toString(),
						mode: visionState.mode,
						options: makeVisionOptions(editor.document, message.options || {})
					};
				}
			}
			if (message.type === "saveMacroInputs") {
				await saveMacroInputsFromWebview(message.macroInputs || {}, message.overrideProgramInitialValues === true, message.options || {});
			}
			if (message.type === "resetMacroInputs") {
				await resetMacroInputsFromWebview(message.options || {});
			}

		});
	} else {
		visionPanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderVisionPanel(editor, mode, options);
}

async function saveOffsetsFromWebview(offsets, rawOptions) {
	const editor = getVisionSourceEditor();

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Focus a G-code document before saving Vision offsets.");
		return;
	}

	const normalizedOffsets = normalizeVisionWorkOffsets(offsets);
	await saveDocumentVisionWorkOffsets(editor.document, normalizedOffsets);

	const options = makeVisionOptions(editor.document, Object.assign({}, rawOptions, {
		workOffsets: normalizedOffsets
	}));
	const mode = visionState && visionState.mode ? visionState.mode : "whole";

	visionState = {
		documentUriText: editor.document.uri.toString(),
		mode,
		options
	};

	await renderVisionPanel(editor, mode, options);
}

async function resetOffsetsFromWebview(rawOptions) {
	const editor = getVisionSourceEditor();

	if (!editor || editor.document.languageId !== "gcode" || !visionContext || !visionContext.workspaceState) {
		return;
	}

	const documentKey = getVisionDocumentKey(editor.document);
	const allOffsets = getStoredVisionWorkOffsets();
	delete allOffsets[documentKey];
	await visionContext.workspaceState.update("kaijuVision.workOffsetsByDocument", allOffsets);

	const settings = Object.assign({}, rawOptions);
	delete settings.workOffsets;
	const options = makeVisionOptions(editor.document, settings);
	const mode = visionState && visionState.mode ? visionState.mode : "whole";
	visionState = { documentUriText: editor.document.uri.toString(), mode, options };
	await renderVisionPanel(editor, mode, options);
}

function makeVisionOptions(document, rawOptions = {}) {
	const savedOffsets = getDocumentVisionWorkOffsets(document);
	const savedSettings = getDocumentVisionSettings(document);
	const options = getVisionOptions(document, Object.assign({}, savedSettings, rawOptions, {
		workOffsets: rawOptions.workOffsets || savedOffsets
	}));
	const panelSettings = normalizeVisionPanelSettings(Object.assign({}, savedSettings, rawOptions));

	// getVisionOptions resolves the selected plane from the machine profile when
	// this document has no saved plane. Do not replace that resolved value with
	// the panel normalizer's undefined placeholder, or the select falls back to
	// its first (X-Y) option.
	return Object.assign(options, panelSettings, { plane: options.plane });
}

async function resetVisionPlaneForMachineMode(document) {
	if (!document || document.languageId !== "gcode") return;
	const plane = getVisionOptions(document).plane;
	const settings = Object.assign({}, getDocumentVisionSettings(document), { plane });
	await saveDocumentVisionSettings(document, settings);

	if (!visionState || visionState.documentUriText !== document.uri.toString()) return;
	const options = makeVisionOptions(document, Object.assign({}, visionState.options, { plane }));
	visionState = Object.assign({}, visionState, { options });
	if (!visionState.playbackLocked) {
		const editor = getVisionSourceEditor();
		if (editor && editor.document.uri.toString() === document.uri.toString()) {
			await renderVisionPanel(editor, visionState.mode, options);
		}
	}
}

function normalizeVisionPanelSettings(value = {}) {
	return {
		analysisMode: value.analysisMode === "asWritten" ? "asWritten" : "trace",
		showTraceLine: value.showTraceLine !== false,
		plane: value.plane,
		useToolColors: value.useToolColors === true,
		showLabels: value.showLabels !== false,
		showEndpoints: value.showEndpoints !== false,
		showZeroLines: value.showZeroLines === true,
		showMarkerLegend: value.showMarkerLegend === true,
		overrideProgramInitialValues: value.overrideProgramInitialValues === true,
		live: value.live === true
	};
}

function getDocumentVisionSettings(document) {
	const all = visionContext && visionContext.workspaceState ? visionContext.workspaceState.get("kaijuVision.settingsByDocument", {}) : {};
	return Object.assign({}, all[getVisionDocumentKey(document)] || {});
}

async function saveDocumentVisionSettings(document, settings) {
	if (!visionContext || !visionContext.workspaceState) return;
	const all = Object.assign({}, visionContext.workspaceState.get("kaijuVision.settingsByDocument", {}));
	all[getVisionDocumentKey(document)] = normalizeVisionPanelSettings(settings);
	await visionContext.workspaceState.update("kaijuVision.settingsByDocument", all);
}

function getDocumentVisionWorkOffsets(document) {
	const allOffsets = getStoredVisionWorkOffsets();
	const documentKey = getVisionDocumentKey(document);

	return normalizeVisionWorkOffsets(documentKey ? allOffsets[documentKey] : undefined);
}

async function saveDocumentVisionWorkOffsets(document, offsets) {
	if (!visionContext || !visionContext.workspaceState) {
		return;
	}

	const documentKey = getVisionDocumentKey(document);
	const allOffsets = getStoredVisionWorkOffsets();

	if (documentKey) {
		allOffsets[documentKey] = normalizeVisionWorkOffsets(offsets);
		await visionContext.workspaceState.update("kaijuVision.workOffsetsByDocument", allOffsets);
	}
}

function getStoredVisionWorkOffsets() {
	return visionContext && visionContext.workspaceState
		? Object.assign({}, visionContext.workspaceState.get("kaijuVision.workOffsetsByDocument", {}))
		: {};
}

function getVisionDocumentKey(document) {
	return document && document.uri ? document.uri.toString() : "";
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

async function revealVisionSourceLine(rawLineNumber) {
	const editor = getVisionSourceEditor();
	const lineNumber = Math.floor(Number(rawLineNumber));

	if (!editor || editor.document.languageId !== "gcode" || !Number.isFinite(lineNumber)) {
		return;
	}

	const targetLine = Math.max(0, Math.min(editor.document.lineCount - 1, lineNumber));
	const position = new vscode.Position(targetLine, 0);
	const sourceEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
	sourceEditor.selection = new vscode.Selection(position, position);
	sourceEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function renderVisionPanel(editor, mode, options) {
	const range = getRangeForMode(editor, mode);

	if (mode === "selection" && !range) {
		vscode.window.showWarningMessage("Select a G-code section before sending the selection to KAIJU Vision.");
		return;
	}

	const traceResult = options.analysisMode === "trace" ? await getVisionTrace(editor.document, options.playbackAutoStart === true) : undefined;
	if (options.preserveOnUnusableTrace && traceResult && !isUsableVisionTrace(traceResult.trace)) {
		showLiveTraceWarning(makeLiveTraceWarning(traceResult.trace));
		return false;
	}
	if (traceResult && traceResult.trace && traceResult.decomposition) {
		attachTraceOutputLines(traceResult.trace, traceResult.decomposition.decompositionLines);
	}
	const analysisOptions = traceResult && traceResult.trace && isUsableVisionTrace(traceResult.trace)
		? Object.assign({}, options, { executionTrace: traceResult.trace })
		: options;
	const result = analyzeVisionRange(editor.document, range, analysisOptions);
	result.executionTrace = options.playbackAutoStart === true && traceResult && traceResult.trace && isUsableVisionTrace(traceResult.trace)
		? traceResult.trace
		: undefined;
	result.traceWarning = traceResult && traceResult.warning;

	visionPanel.title = "KAIJU Vision";
	visionPanel.webview.html = renderVisionHtml(editor.document, mode, options, result);
	await compactVisionPanelEditorGroup(options);
	return true;
}

async function refreshLiveVision(document) {
	if (!visionPanel || !visionState || visionState.playbackLocked || !document || document.uri.toString() !== visionState.documentUriText || !visionState.options.live) {
		return;
	}

	const trace = getExecutionTrace(document);
	if (!trace || trace.status === "running") {
		return;
	}
	if (!isUsableVisionTrace(trace) && visionState.options.analysisMode === "trace") {
		showLiveTraceWarning(makeLiveTraceWarning(trace));
		return;
	}

	const editor = getVisionSourceEditor();
	if (!editor || editor.document.uri.toString() !== visionState.documentUriText) {
		return;
	}

	const options = makeVisionOptions(editor.document, visionState.options);
	visionState = { documentUriText: editor.document.uri.toString(), mode: visionState.mode, options };
	try {
		await renderVisionPanel(editor, visionState.mode, Object.assign({}, options, { preserveOnUnusableTrace: true }));
	} catch (error) {
		showLiveTraceWarning(makeLiveTraceWarning(error));
	}
}

function showLiveTraceWarning(warning) {
	if (!visionPanel || !warning) return;
	void visionPanel.webview.postMessage({ type: "liveTraceWarning", warning });
}

function makeLiveTraceWarning(traceOrError) {
	const isTrace = traceOrError && typeof traceOrError === "object" && typeof traceOrError.status === "string";
	const details = [];
	if (isTrace) {
		details.push(`The newest trace is ${traceOrError.status}.`);
		for (const problem of traceOrError.problems || []) {
			details.push(`Line ${Number(problem.lineNumber) + 1}: ${problem.message}`);
		}
	} else if (traceOrError) {
		details.push(`The newest trace could not be read: ${traceOrError.message || String(traceOrError)}`);
	}
	return [
		"Vision is still showing the last usable trace, not the current document version.",
		...details
	].join("\n");
}

async function getVisionTrace(document, includePlaybackData = false) {
	const inputs = getDocumentVisionTraceInputs(document);
	const trace = buildExecutionTrace(document, {
		initialMacroValues: inputs.initialValues,
		initialMacroOverrides: inputs.overrides,
		includeExecutionEntries: true,
		includePlaybackData,
		includeDecompositionData: true
	});
	const decomposition = isUsableVisionTrace(trace)
		? await decomposeDocument(document, { initialMacroValues: inputs.initialValues, initialMacroOverrides: inputs.overrides, promptForUnknownMacros: false, executionTrace: trace })
		: undefined;
	const warningItems = [];
	if (trace.status === "assumed") {
		warningItems.push("Trace used assumed-zero macro values.");
		const assumedMacros = [...trace.assumptions.keys()];
		if (assumedMacros.length) warningItems.push(`Assumed zero: ${assumedMacros.join(", ")}.`);
		warningItems.push("Set values in Macro values to inspect a specific result.");
	}
	if (decomposition && decomposition.warnings.length) {
		warningItems.push(`Decomposition line data has ${decomposition.warnings.length} warning${decomposition.warnings.length === 1 ? "" : "s"}.`);
	}
	if (!isUsableVisionTrace(trace)) {
		warningItems.push(`Trace is ${trace.status}.`);
		warningItems.push("Vision is showing as-written motion.");
	}
	return {
		trace,
		decomposition,
		warning: warningItems.length ? `• ${warningItems.join("\n• ")}` : ""
	};
}

function isUsableVisionTrace(trace) {
	return trace && (trace.status === "ready" || trace.status === "assumed");
}

function getDocumentVisionTraceInputs(document) {
	const all = visionContext && visionContext.workspaceState ? visionContext.workspaceState.get("kaijuVision.macroInputsByDocument", {}) : {};
	const saved = Object.assign({}, all[getVisionDocumentKey(document)] || {});
	const initialValues = {};
	const overrides = {};
	for (const [macro, entry] of Object.entries(saved)) {
		if (!entry || !Number.isFinite(Number(entry.value))) continue;
		(entry.override ? overrides : initialValues)[macro] = Number(entry.value);
	}
	return { initialValues, overrides };
}

function getVisionMacroVariables(document) {
	const macros = new Set();
	const initialized = new Set();
	const aliases = buildMacroAliasMap(document);
	const aliasEntries = buildAliasEntries(document);
	const aliasLabels = new Map(aliasEntries.filter(entry => entry.alias).map(entry => [normalizeMacro(entry.macro), `#${entry.alias}`]));
	let firstExecutableLine = document.lineCount;
	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const code = maskVisionMacroText(document.lineAt(lineNumber).text);
		if (firstExecutableLine === document.lineCount && /(^|[^A-Za-z0-9_])[GgMm]\d+/.test(code)) firstExecutableLine = lineNumber;
		for (const match of code.matchAll(MACRO_REGEX)) macros.add(resolveMacroAlias(normalizeMacro(match[0]), aliases));
		if (lineNumber < firstExecutableLine) {
			for (const match of code.matchAll(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g)) initialized.add(resolveMacroAlias(normalizeMacro(match[0].match(MACRO_REGEX)[0]), aliases));
		}
	}
	for (const entry of buildAliasEntries(document)) {
		if (/\{\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*\}\s*$/.test(String(entry.comment || ""))) {
			initialized.add(resolveMacroAlias(normalizeMacro(entry.macro), aliases));
		}
	}
	return [...macros].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).map(macro => ({ macro, label: aliasLabels.get(macro) || macro, initialized: initialized.has(macro) }));
}

function getVisionProgramAxes(document) {
	const axes = [];
	const axisPatterns = {
		x: /X(?=[-+#.\d\[])/i,
		y: /Y(?=[-+#.\d\[])/i,
		z: /Z(?=[-+#.\d\[])/i
	};

	for (const axis of ["x", "y", "z"]) {
		for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
			if (axisPatterns[axis].test(maskVisionMacroText(document.lineAt(lineNumber).text))) {
				axes.push(axis);
				break;
			}
		}
	}

	return axes;
}

function maskVisionMacroText(line) {
	return maskProtectedRanges(line);
}

async function saveMacroInputsFromWebview(inputs, overrideProgramInitialValues, rawOptions) {
	const editor = getVisionSourceEditor();
	if (!editor || editor.document.languageId !== "gcode") return;
	if (!visionContext || !visionContext.workspaceState) return;
	const all = Object.assign({}, visionContext.workspaceState.get("kaijuVision.macroInputsByDocument", {}));
	const valid = {};
	for (const [macro, value] of Object.entries(inputs)) {
		if (Number.isFinite(Number(value))) valid[normalizeMacro(macro)] = { value: Number(value), override: overrideProgramInitialValues };
	}
	all[getVisionDocumentKey(editor.document)] = valid;
	await visionContext.workspaceState.update("kaijuVision.macroInputsByDocument", all);
	await saveDocumentVisionSettings(editor.document, Object.assign({}, rawOptions, { overrideProgramInitialValues }));
	const options = makeVisionOptions(editor.document, Object.assign({}, rawOptions, { overrideProgramInitialValues }));
	visionState = { documentUriText: editor.document.uri.toString(), mode: visionState.mode, options };
	await renderVisionPanel(editor, visionState.mode, options);
}

async function resetMacroInputsFromWebview(rawOptions) {
	const editor = getVisionSourceEditor();
	if (!editor || editor.document.languageId !== "gcode" || !visionContext || !visionContext.workspaceState) return;
	const all = Object.assign({}, visionContext.workspaceState.get("kaijuVision.macroInputsByDocument", {}));
	delete all[getVisionDocumentKey(editor.document)];
	await visionContext.workspaceState.update("kaijuVision.macroInputsByDocument", all);
	const settings = Object.assign({}, rawOptions, { overrideProgramInitialValues: false });
	await saveDocumentVisionSettings(editor.document, settings);
	const options = makeVisionOptions(editor.document, settings);
	visionState = { documentUriText: editor.document.uri.toString(), mode: visionState.mode, options };
	await renderVisionPanel(editor, visionState.mode, options);
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

function renderVisionHtml(document, mode, options, result) {
	const rangeText = result.range.startLine === 0 && result.range.endLine === document.lineCount - 1
		? "Whole program"
		: `Lines ${result.range.startLine + 1}-${result.range.endLine + 1}`;
	const summary = summarizeVisionRows(result.rows);
	const rapidMotionLabel = result.motionDisplayWords && result.motionDisplayWords.rapid || "Rapid";
	const cuttingMotionLabel = result.motionDisplayWords && result.motionDisplayWords.cutting.length
		? result.motionDisplayWords.cutting.join("/")
		: "Cutting";
	const macroVariables = getVisionMacroVariables(document);
	const programAxes = getVisionProgramAxes(document);
	const savedMacroInputs = visionContext && visionContext.workspaceState
		? Object.assign({}, visionContext.workspaceState.get("kaijuVision.macroInputsByDocument", {})[getVisionDocumentKey(document)] || {})
		: {};
	const payload = {
		rows: result.rows,
		options,
		rangeText,
		sourceName: document.fileName || document.uri.toString(),
		summary,
		macroVariables,
		programAxes,
		playback: result.executionTrace && Array.isArray(result.executionTrace.executionEntries)
			? {
				entries: result.executionTrace.executionEntries,
				initialMacroValues: result.executionTrace.initialMacroValues || {},
				autoStart: options.playbackAutoStart === true
			}
			: undefined
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
			padding: 6px 16px 16px;
			box-sizing: border-box;
			height: 100vh;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}

		body.playback-macros-open { padding-right: 414px; }

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

		.playback-button {
			display: inline-grid;
			place-items: center;
			margin-left: auto;
			min-width: 32px;
			height: 28px;
			padding: 0 9px;
			font-size: 15px;
			line-height: 1;
			font-family: var(--vscode-font-family);
		}

		.playback-button.stop {
			background: var(--vscode-inputValidation-errorBackground, #a1260d);
			color: var(--vscode-inputValidation-errorForeground, #ffffff);
		}

		.playback-button.stop:hover {
			background: var(--vscode-inputValidation-errorBorder, #f14c4c);
		}

		.playback-button:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		.playback-panel {
			display: none;
			flex: 0 0 auto;
			gap: 8px;
			margin: 0 0 10px;
			padding: 8px 10px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
		}

		.playback-panel.open { display: grid; }
		.playback-actions { display: flex; align-items: center; gap: 6px; }
		.playback-actions button { min-width: 30px; padding: 5px 8px; }
		.playback-scrubber { flex: 1 1 160px; min-width: 100px; }
		.playback-position { color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; }
		.playback-code { cursor: pointer; outline: none; }
		.playback-code:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 3px; }
		.playback-line { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.playback-context { display: grid; gap: 1px; font: 12px/1.45 var(--vscode-editor-font-family, monospace); }
		.playback-context-line { display: grid; grid-template-columns: 6ch minmax(0, 1fr); gap: 8px; padding: 1px 5px; border-radius: 2px; color: var(--vscode-descriptionForeground); }
		.playback-context-line code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.playback-context-line.current { color: var(--vscode-editor-foreground); background: var(--vscode-list-activeSelectionBackground); }
		.playback-macro-panel { display: none; position: fixed; z-index: 8; top: 8px; right: 8px; bottom: 16px; box-sizing: border-box; width: 390px; overflow: auto; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
		.playback-macro-panel.open { display: block; animation: playback-macro-slide-in .12s ease-out; }
		.playback-macro-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 12px; }
		.playback-macro-header strong { margin-right: auto; }
		.playback-macro-header select { min-width: 0; padding: 3px 5px; font-size: 11px; }
		.playback-macro-close { min-width: 24px; padding: 3px 7px; }
		.playback-macro-panel table { width: 100%; min-width: max-content; font-size: 11px; }
		.playback-macro-panel th { position: static; }
		.playback-macro-panel td, .playback-macro-panel th { padding: 2px 5px; white-space: nowrap; }
		.playback-macro-panel th:last-child, .playback-macro-panel td:last-child { width: 14ch; min-width: 14ch; text-align: right; }
		@keyframes playback-macro-slide-in { from { transform: translateX(12px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
		@media (max-width: 700px) { body.playback-macros-open { padding-right: 294px; } .playback-macro-panel { width: 278px; } }
		tr[data-playback-index] { cursor: pointer; }

		.offset-panel {
			display: none;
			border-top: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 10px 0;
			margin: 0 0 12px;
		}

		.offset-panel.open {
			display: block;
		}

		.offset-panel table {
			font-size: 12px;
		}

		.offset-panel th {
			position: static;
		}

		.offset-panel input[type="number"],
		.offset-panel input[type="text"] {
			width: 100%;
			box-sizing: border-box;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			padding: 3px 5px;
		}

		.offset-actions {
			display: flex;
			gap: 8px;
			margin-top: 8px;
		}

		.visibility-panel {
			display: none;
			border-top: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 10px 0;
			margin: 0 0 12px;
		}

		.visibility-panel.open {
			display: block;
		}

		.control-panel {
			display: none;
			border-top: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 10px 0;
			margin: 0 0 12px;
		}

		.control-panel.open { display: block; }
		.control-panel .offset-actions { margin-top: 0; }

		.macro-panel {
			display: none;
			border-top: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 10px 0;
			margin: 0 0 12px;
			max-height: 45vh;
			overflow: auto;
		}

		.macro-panel.open { display: block; }
		.macro-panel input[type="number"] { width: 12ch; }
		.macro-panel th { position: static; }

		.visibility-groups {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
			gap: 12px;
		}

		.visibility-group-title {
			font-size: 12px;
			font-weight: 600;
			margin: 0 0 6px;
		}

		.visibility-options {
			display: flex;
			flex-wrap: wrap;
			gap: 6px 12px;
		}

		.visibility-options label {
			min-height: 22px;
		}		.summary {
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

		.zoom-readout {
			color: var(--vscode-descriptionForeground);
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}

		.trace-warning {
			color: var(--vscode-editorWarning-foreground);
			cursor: help;
			font-weight: 600;
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
			position: relative;
			cursor: grab;
			user-select: none;
			touch-action: none;
		}

		.viewer-slot {
			flex: 1 1 auto;
			min-height: 0;
			position: relative;
			overflow: hidden;
		}

		.viewer.dragging {
			cursor: grabbing;
		}

		.viewer canvas,
		.viewer svg {
			display: block;
			width: 100%;
			height: 100%;
		}

		.viewer canvas,
		.viewer svg {
			position: absolute;
			inset: 0;
		}

		.viewer canvas {
			pointer-events: none;
		}

		.viewer svg {
			pointer-events: auto;
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

		.vision-marker-legend {
			position: absolute;
			display: none;
			right: 10px;
			bottom: 10px;
			z-index: 9;
			min-width: 170px;
			padding: 8px 10px;
			border: 1px solid var(--vscode-panel-border,#3c3c3c);
			background: var(--vscode-editorHoverWidget-background,#252526);
			color: var(--vscode-editorHoverWidget-foreground,#d4d4d4);
			box-shadow: 0 4px 12px rgba(0,0,0,0.35);
			font-size: 12px;
			line-height: 1.4;
			pointer-events: none;
		}

		.playback-position-readout {
			position: absolute;
			display: none;
			left: 10px;
			bottom: 10px;
			z-index: 9;
			gap: 10px;
			align-items: center;
			padding: 6px 8px;
			border: 1px solid var(--vscode-panel-border, #3c3c3c);
			border-radius: 3px;
			background: var(--vscode-editorHoverWidget-background, #252526);
			color: var(--vscode-editorHoverWidget-foreground, #d4d4d4);
			font: 12px var(--vscode-editor-font-family, monospace);
			font-variant-numeric: tabular-nums;
			pointer-events: none;
		}

		.playback-position-readout.open { display: flex; }
		.playback-position-axis { white-space: nowrap; }

		.marker-legend-row {
			display: flex;
			align-items: center;
			gap: 7px;
			white-space: nowrap;
		}

		.marker-legend-row + .marker-legend-row {
			margin-top: 4px;
		}

		.marker-legend-swatch {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			border: 1px solid var(--vscode-editor-background,#1e1e1e);
			flex: 0 0 auto;
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
			display: none;
			flex: 0 0 calc(var(--vision-row-height) * 9);
			overflow: auto;
			max-height: calc(var(--vision-row-height) * 9);
			border-top: 1px solid var(--vscode-panel-border);
			margin-top: 10px;
			position: relative;
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

		tr.table-spacer td {
			border-bottom: 0;
			height: 0;
			line-height: 0;
			padding: 0;
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
		<label>Motion data
			<select id="analysisMode">
				<option value="trace"${options.analysisMode === "trace" ? " selected" : ""}>Trace</option>
				<option value="asWritten"${options.analysisMode === "asWritten" ? " selected" : ""}>As written</option>
			</select>
		</label>
		<label>Node line
			<select id="lineData"${options.analysisMode === "asWritten" ? " disabled" : ""}>
				<option value="source"${options.analysisMode !== "trace" || !options.showTraceLine ? " selected" : ""}>Source program</option>
				<option value="trace"${options.analysisMode === "trace" && options.showTraceLine ? " selected" : ""}>Trace output</option>
			</select>
		</label>
		<label class="checkbox"><input type="checkbox" id="live"${options.live ? " checked" : ""}> Live</label>
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
		<button id="viewToggle">View</button>
		<button id="dataToggle">Data</button>
		<button id="fit">Fit View</button>
		<button id="zoomOut">Zoom -</button>
		<button id="zoomIn">Zoom +</button>
		<button id="playbackToggle" class="playback-button" type="button" title="Play program" aria-label="Play program">&#9654;</button>
	</section>

	<section id="playbackPanel" class="playback-panel" aria-label="Program playback">
		<div class="playback-actions">
			<button id="playbackBack" type="button" title="Previous event" aria-label="Previous event">&#9664;</button>
			<button id="playbackForward" type="button" title="Next event" aria-label="Next event">&#9654;</button>
			<input id="playbackScrubber" class="playback-scrubber" type="range" min="1" value="1" aria-label="Playback position">
			<span id="playbackPosition" class="playback-position"></span>
			<button id="playbackMacrosToggle" type="button" title="Show macro values" aria-expanded="false" aria-controls="playbackMacroPanel">Macros</button>
		</div>
		<div id="playbackCode" class="playback-code" tabindex="0" title="Use arrows, Page Up/Down, Home/End, Space, or mouse wheel to navigate playback.">
			<div id="playbackContext" class="playback-context"></div>
		</div>
		<aside id="playbackMacroPanel" class="playback-macro-panel" aria-label="Playback macro values"><div class="playback-macro-header"><strong>Macro values</strong><select id="playbackMacroSort" aria-label="Macro sort order"><option value="number">Number</option><option value="recent">Recently updated</option></select><button id="playbackMacroClose" class="playback-macro-close" type="button" title="Close macro values" aria-label="Close macro values">&#215;</button></div><table><thead><tr><th>Macro</th><th>Alias</th><th>Value</th></tr></thead><tbody id="playbackMacroValues"></tbody></table></aside>
	</section>

	${renderVisionViewPanel(options)}
	${renderVisionDataPanel()}
	${renderVisionOffsetPanel(options.workOffsets)}
	${renderVisionVisibilityPanel(result.rows)}
	${renderVisionMacroPanel(macroVariables, savedMacroInputs, options.overrideProgramInitialValues)}
	<section class="summary">
		<span>${escapeHtml(summary.moveCount)} move(s)</span>
		<span>${escapeHtml(formatNumber(summary.totalDistance, options.humanFormat))} total distance</span>
		${summary.unknownRows ? `<span>${escapeHtml(summary.unknownRows)} row(s) have incomplete path data</span>` : ""}
		<span class="legend"><span><span class="swatch" style="background: var(--rapid)"></span>${escapeHtml(rapidMotionLabel)}</span><span><span class="swatch" style="background: var(--cut)"></span>${escapeHtml(cuttingMotionLabel)}</span><span id="zoomLabel" class="zoom-readout" title="View zoom">100%</span></span>
		${result.traceWarning ? `<span class="trace-warning" title="${escapeAttribute(result.traceWarning)}">⚠ TRACE WARNING</span>` : ""}
		<span id="liveWarning" class="trace-warning" hidden></span>
	</section>

	<div id="viewerSlot" class="viewer-slot">
		<div id="viewer" class="viewer"></div>
		<div id="visionTooltip" class="vision-tooltip"></div>
		<div id="markerLegend" class="vision-marker-legend"></div>
		<div id="playbackPositionReadout" class="playback-position-readout" aria-live="polite"></div>
	</div>
	${renderRows(result.rows, options.humanFormat)}

	<script type="application/json" id="vision-data">${escapeScriptJson(payload)}</script>
	<script>
		const vscode = acquireVsCodeApi();
		const data = JSON.parse(document.getElementById("vision-data").textContent);
		const planeSelect = document.getElementById("plane");
		const analysisModeSelect = document.getElementById("analysisMode");
		const lineDataSelect = document.getElementById("lineData");
		const liveInput = document.getElementById("live");
		const playbackToggle = document.getElementById("playbackToggle");
		const playbackPanel = document.getElementById("playbackPanel");
		const playbackBack = document.getElementById("playbackBack");
		const playbackForward = document.getElementById("playbackForward");
		const playbackScrubber = document.getElementById("playbackScrubber");
		const playbackPosition = document.getElementById("playbackPosition");
		const playbackCode = document.getElementById("playbackCode");
		const playbackContext = document.getElementById("playbackContext");
		const playbackMacrosToggle = document.getElementById("playbackMacrosToggle");
		const playbackMacroPanel = document.getElementById("playbackMacroPanel");
		const playbackMacroSort = document.getElementById("playbackMacroSort");
		const playbackMacroClose = document.getElementById("playbackMacroClose");
		const playbackMacroValues = document.getElementById("playbackMacroValues");
		const labelsInput = document.getElementById("labels");
		const endpointsInput = document.getElementById("endpoints");
		const zeroLinesInput = document.getElementById("zeroLines");
		const toolColorsInput = document.getElementById("toolColors");
		const markerLegendToggle = document.getElementById("markerLegendToggle");
		const viewToggle = document.getElementById("viewToggle");
		const viewPanel = document.getElementById("viewPanel");
		const dataToggle = document.getElementById("dataToggle");
		const dataPanel = document.getElementById("dataPanel");
		const offsetsToggle = document.getElementById("offsetsToggle");
		const offsetPanel = document.getElementById("offsetPanel");
		const visibilityToggle = document.getElementById("visibilityToggle");
		const visibilityPanel = document.getElementById("visibilityPanel");
		const macrosToggle = document.getElementById("macrosToggle");
		const macroPanel = document.getElementById("macroPanel");
		const overrideProgramInitialValues = document.getElementById("overrideProgramInitialValues");
		const viewerSlot = document.getElementById("viewerSlot");
		const viewer = document.getElementById("viewer");
		const tooltip = document.getElementById("visionTooltip");
		const markerLegend = document.getElementById("markerLegend");
		const playbackPositionReadout = document.getElementById("playbackPositionReadout");
		const tableWrap = document.getElementById("visionTableWrap");
		const tableBody = document.getElementById("visionTableBody");
		const zoomLabel = document.getElementById("zoomLabel");
		const zoomStep = Math.max(1.01, Number(data.options.zoomStep) || 1.75);
		const wheelZoomStep = Math.max(1.01, Number(data.options.wheelZoomStep) || 1.36);
		const tableRowHeight = 26;
		const labelCacheLimitBytes = Math.max(0, Number(data.options.labelCacheMB) || 0) * 1024 * 1024;
		const labelCache = new Map();
		let labelCacheBytes = 0;
		let labelCacheRunId = 0;
		let lastPrewarmKey = "";
		let zoom = 1;
		let pan = { x: 0, y: 0 };
		let currentFitBounds;
		let currentBounds;
		let currentTableRows = [];
		let currentTableVisibilityKey = "";
		let currentLabelEntry;
		const projectedPlaneCache = new Map();
		let dragState;
		let playbackMacroSortMode = "number";
		function makePlaybackMotionState(rows) {
			const motionExecutionIndexes = [];
			const motionIndexByExecutionIndex = new Map();
			for (const row of rows || []) {
				if ((row.type === "motion" || row.type === "cycle") && Number.isFinite(row.executionIndex) && !motionIndexByExecutionIndex.has(row.executionIndex)) {
					motionIndexByExecutionIndex.set(row.executionIndex, motionExecutionIndexes.length);
					motionExecutionIndexes.push(row.executionIndex);
				}
			}
			return { motionExecutionIndexes, motionIndexByExecutionIndex };
		}

		const playback = data.playback && Array.isArray(data.playback.entries) && data.playback.entries.length
			? Object.assign({ entries: data.playback.entries, initialMacroValues: data.playback.initialMacroValues || {}, cursor: 0, active: false, playing: false, timer: undefined, macroValues: new Map(Object.entries(data.playback.initialMacroValues || {})), usedAxes: Array.isArray(data.programAxes) ? data.programAxes : getPlaybackUsedAxes(data.playback.entries) }, makePlaybackMotionState(data.rows))
			: undefined;

		function getPlaybackUsedAxes(entries) {
			const axisPatterns = {
				x: /X(?=[-+#.\\d\\[])/i,
				y: /Y(?=[-+#.\\d\\[])/i,
				z: /Z(?=[-+#.\\d\\[])/i
			};
			return Object.keys(axisPatterns).filter(axis => entries.some(entry => axisPatterns[axis].test(String(entry.sourceLine || ""))));
		}
		const planes = {
			xy: makePlane("X-Y", getOrderedOrientation(data.options.xyOrientation, "xRightYUp", "x", "y"), "x", "y"),
			yx: makePlane("Y-X", getOrderedOrientation(data.options.xyOrientation, "yRightXUp", "y", "x"), "y", "x"),
			xz: makePlane("X-Z", getOrderedOrientation(data.options.xzOrientation, "xRightZUp", "x", "z"), "x", "z"),
			zx: makePlane("Z-X", getOrderedOrientation(data.options.xzOrientation, "zRightXUp", "z", "x"), "z", "x"),
			yz: makePlane("Y-Z", getOrderedOrientation(data.options.zyOrientation, "yRightZUp", "y", "z"), "y", "z"),
			zy: makePlane("Z-Y", getOrderedOrientation(data.options.zyOrientation, "zRightYUp", "z", "y"), "z", "y")
		};


		function collectVisionOptions() {
			return {
				analysisMode: analysisModeSelect.value,
				showTraceLine: lineDataSelect.value === "trace",
				plane: planeSelect.value,
				useToolColors: toolColorsInput.checked,
				workOffsets: collectWorkOffsets(),
				showLabels: labelsInput.checked,
				showEndpoints: endpointsInput.checked,
				showZeroLines: zeroLinesInput.checked,
				showMarkerLegend: markerLegendToggle.checked,
				overrideProgramInitialValues: overrideProgramInitialValues.checked,
				live: liveInput.checked
			};
		}

		function saveVisionSettings() {
			vscode.postMessage({ type: "saveVisionSettings", options: collectVisionOptions() });
		}

		function collectMacroInputs() {
			const values = {};
			document.querySelectorAll("[data-macro-value]").forEach(input => {
				if (input.value.trim() !== "" && Number.isFinite(Number(input.value))) values[input.getAttribute("data-macro-value")] = Number(input.value);
			});
			return values;
		}

		function collectWorkOffsets() {
			const offsets = {};

			document.querySelectorAll("[data-offset-code]").forEach(row => {
				const code = row.getAttribute("data-offset-code");
				offsets[code] = {
					enabled: row.querySelector("[data-offset-enabled]").checked,
					x: Number(row.querySelector("[data-offset-axis='x']").value) || 0,
					y: Number(row.querySelector("[data-offset-axis='y']").value) || 0,
					z: Number(row.querySelector("[data-offset-axis='z']").value) || 0,
					note: row.querySelector("[data-offset-note]").value || ""
				};
			});

			return offsets;
		}

		function getVisibilityState() {
			return {
				tools: new Set([...document.querySelectorAll("[data-visibility-tool]")].filter(input => input.checked).map(input => input.value)),
				wcs: new Set([...document.querySelectorAll("[data-visibility-wcs]")].filter(input => input.checked).map(input => input.value))
			};
		}

		function isRowVisible(row, visibility) {
			if (!row || row.type === "label") {
				return true;
			}

			return visibility.tools.has(getRowToolKey(row)) && visibility.wcs.has(getRowWcsKey(row));
		}

		function getVisibilityKey(visibility) {
			return [...visibility.tools].sort().join("|") + "::" + [...visibility.wcs].sort().join("|");
		}

		function getRowToolKey(row) {
			return row && row.tool ? row.tool : "__none";
		}

		function getRowWcsKey(row) {
			if (row && row.instruction && row.instruction.indexOf("G53") === 0) {
				return "G53";
			}

			if (row && row.coordinateSystem) {
				return row.coordinateSystem;
			}

			return "__none";
		}

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

		function getProjectedPlaneData(planeKey, plane) {
			if (projectedPlaneCache.has(planeKey)) {
				return projectedPlaneCache.get(planeKey);
			}

			const projected = {
				rows: [],
				cycles: [],
				toolChanges: [],
				events: []
			};

			for (const row of data.rows) {
				if (row.type === "cycle") {
					const points = (row.points || [])
						.map(point => project(point, plane))
						.filter(Boolean);
					const projectedPoint = project(row.point || row.end || {}, plane) || points[points.length - 1];

					if (projectedPoint) {
						projected.cycles.push(Object.assign({}, row, {
							projectedPoints: points,
							projectedPoint,
							projectedBounds: makePointSetBounds(points.length ? points : [projectedPoint]),
							labelCoordinateLine: makeVisiblePositionLine(row.end, data.options.humanFormat),
							labelHoverHtml: makePointHoverHtml(row.end, row)
						}));
					}
				} else if (row.type === "tool") {
					const projectedPoint = project(row.point || {}, plane);

					if (projectedPoint) {
						projected.toolChanges.push(Object.assign({}, row, {
							projectedPoint,
							labelCoordinateLine: makePlaneCoordinateLine(row.point, plane, data.options.humanFormat, data.options.trimLabelTrailingZeros !== false),
							labelHoverHtml: makeToolChangeHoverHtml(row)
						}));
					}
				} else if (row.type === "event") {
					const projectedPoint = project(row.point || {}, plane);

					if (projectedPoint) {
						projected.events.push(Object.assign({}, row, {
							projectedPoint,
							labelCoordinateLine: makePlaneCoordinateLine(row.position || row.point, plane, data.options.humanFormat, data.options.trimLabelTrailingZeros !== false),
							labelHoverHtml: makePointHoverHtml(row.position || row.point, row)
						}));
					}
				} else if (row.type !== "label") {
					const points = (row.points || [])
						.map(point => project(point, plane))
						.filter(Boolean);
					const end = points[points.length - 1];

					if (points.length >= 2) {
						projected.rows.push(Object.assign({}, row, {
							projectedPoints: points,
							projectedEnd: end,
							projectedBounds: makePointSetBounds(points),
							startCoordinateLine: makeVisiblePositionLine(row.start, data.options.humanFormat),
							startHoverHtml: makePointHoverHtml(row.start, Object.assign({}, row, { instruction: "START" })),
							endCoordinateLine: makeVisiblePositionLine(row.end, data.options.humanFormat),
							endHoverHtml: makePointHoverHtml(row.end, row)
						}));
					}
				}
			}

			projectedPlaneCache.set(planeKey, projected);
			return projected;
		}

		function getVisibleProjectedData(projected, visibility) {
			return {
				rows: projected.rows.filter(row => isRowVisible(row, visibility)),
				cycles: projected.cycles.filter(row => isRowVisible(row, visibility)),
				toolChanges: projected.toolChanges.filter(row => isRowVisible(row, visibility)),
				events: projected.events.filter(row => isRowVisible(row, visibility))
			};
		}

		function makePointSetBounds(points) {
			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;

			for (const point of points || []) {
				if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
					continue;
				}

				minX = Math.min(minX, point.x);
				maxX = Math.max(maxX, point.x);
				minY = Math.min(minY, point.y);
				maxY = Math.max(maxY, point.y);
			}

			return minX === Infinity
				? undefined
				: { minX, maxX, minY, maxY };
		}

		function expandBounds(bounds, padding) {
			return {
				minX: bounds.minX - padding,
				minY: bounds.minY - padding,
				width: bounds.width + padding * 2,
				height: bounds.height + padding * 2
			};
		}

		function rowBoundsIntersect(rowBounds, bounds) {
			if (!rowBounds) {
				return true;
			}

			return rowBounds.maxX >= bounds.minX
				&& rowBounds.minX <= bounds.minX + bounds.width
				&& rowBounds.maxY >= bounds.minY
				&& rowBounds.minY <= bounds.minY + bounds.height;
		}

		function makeBounds(rows, cycles, toolChanges, events) {
			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;
			let hasPoint = false;

			const includePoint = point => {
				if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
					return;
				}

				hasPoint = true;
				minX = Math.min(minX, point.x);
				maxX = Math.max(maxX, point.x);
				minY = Math.min(minY, point.y);
				maxY = Math.max(maxY, point.y);
			};

			for (const row of rows) {
				for (const point of row.projectedPoints) {
					includePoint(point);
				}
			}

			for (const cycle of cycles) {
				if (cycle.projectedPoints && cycle.projectedPoints.length) {
					for (const point of cycle.projectedPoints) {
						includePoint(point);
					}
				} else {
					includePoint(cycle.projectedPoint);
				}
			}

			for (const toolChange of toolChanges) {
				includePoint(toolChange.projectedPoint);
			}

			for (const event of events) {
				includePoint(event.projectedPoint);
			}

			if (!hasPoint) {
				return { minX: -10, minY: -10, width: 20, height: 20 };
			}

			const spanX = Math.max(0.001, maxX - minX);
			const spanY = Math.max(0.001, maxY - minY);
			const pad = Math.max(spanX, spanY) * 0.08 || 1;

			minX -= pad;
			maxX += pad;
			minY -= pad;
			maxY += pad;

			const centerX = minX + (maxX - minX) / 2;
			const centerY = minY + (maxY - minY) / 2;

			return {
				minX: centerX - Math.max(1, maxX - minX) / 2,
				minY: centerY - Math.max(1, maxY - minY) / 2,
				width: Math.max(1, maxX - minX),
				height: Math.max(1, maxY - minY)
			};
		}

		function zoomBounds(bounds, viewportAspect = 1) {
			const centerX = bounds.minX + bounds.width / 2;
			const centerY = bounds.minY + bounds.height / 2;
			const aspect = Math.max(0.000001, Number(viewportAspect) || 1);
			const fitHeight = Math.max(bounds.height, bounds.width / aspect);
			const fitWidth = fitHeight * aspect;
			const width = fitWidth / zoom;
			const height = fitHeight / zoom;

			return {
				minX: centerX + pan.x - width / 2,
				minY: centerY + pan.y - height / 2,
				width,
				height
			};
		}

		function isPointNearBounds(point, bounds, padding) {
			return point
				&& point.x >= bounds.minX - padding
				&& point.x <= bounds.minX + bounds.width + padding
				&& point.y >= bounds.minY - padding
				&& point.y <= bounds.minY + bounds.height + padding;
		}

		function setZoom(nextZoom, event) {
			if (!currentFitBounds) {
				zoom = Math.max(1, nextZoom);
				zoomLabel.textContent = Math.round(zoom * 100) + "%";
				render();
				return;
			}

			const rect = viewer.getBoundingClientRect();
			const viewportAspect = Math.max(1, rect.width) / Math.max(1, rect.height);
			const oldBounds = currentBounds || zoomBounds(currentFitBounds, viewportAspect);
			const oldZoom = zoom;
			zoom = Math.max(1, nextZoom);

			if (event && oldZoom !== zoom) {
				const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
				const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
				const anchorX = oldBounds.minX + ratioX * oldBounds.width;
				const anchorY = oldBounds.minY + ratioY * oldBounds.height;
				const fitHeight = Math.max(currentFitBounds.height, currentFitBounds.width / viewportAspect);
				const fitWidth = fitHeight * viewportAspect;
				const newWidth = fitWidth / zoom;
				const newHeight = fitHeight / zoom;
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

			viewer.style.width = Math.max(1, Math.floor(rect.width)) + "px";
			viewer.style.height = Math.max(1, Math.floor(rect.height)) + "px";
		}

		function makePlaybackCheckpoints() {
			if (!playback) return new Map();
			const checkpoints = new Map([[0, new Map(Object.entries(playback.initialMacroValues))]]);
			const values = new Map(Object.entries(playback.initialMacroValues));
			for (let index = 0; index < playback.entries.length; index++) {
				applyPlaybackChanges(values, playback.entries[index].macroChanges);
				if ((index + 1) % 200 === 0) checkpoints.set(index + 1, new Map(values));
			}
			return checkpoints;
		}

		function applyPlaybackChanges(values, changes, reverse = false) {
			for (const change of changes || []) {
				const value = reverse ? change.previous : change.current;
				if (Number.isFinite(value)) values.set(change.macro, value);
				else values.delete(change.macro);
			}
		}

		function makePlaybackPrecisionCheckpoints() {
			if (!playback) return new Map();
			const checkpoints = new Map([[0, new Map()]]);
			const precisions = new Map();
			for (let index = 0; index < playback.entries.length; index++) {
				applyPlaybackDisplayPrecisionChanges(precisions, playback.entries[index].macroDisplayPrecisionChanges);
				if ((index + 1) % 200 === 0) checkpoints.set(index + 1, new Map(precisions));
			}
			return checkpoints;
		}

		function applyPlaybackDisplayPrecisionChanges(precisions, changes) {
			for (const change of changes || []) {
				precisions.set(change.macro, Math.max(0, Math.min(6, Number(change.precision) || 0)));
			}
		}

		const playbackCheckpoints = makePlaybackCheckpoints();
		const playbackPrecisionCheckpoints = makePlaybackPrecisionCheckpoints();

		function restorePlaybackMacroValues(cursor) {
			if (!playback) return;
			const completedEntries = cursor + 1;
			const checkpointIndex = Math.floor(completedEntries / 200) * 200;
			const checkpoint = playbackCheckpoints.get(checkpointIndex) || playbackCheckpoints.get(0);
			const precisionCheckpoint = playbackPrecisionCheckpoints.get(checkpointIndex) || playbackPrecisionCheckpoints.get(0);
			playback.macroValues = new Map(checkpoint);
			playback.macroDisplayPrecisions = new Map(precisionCheckpoint);
			for (let index = checkpointIndex; index < completedEntries; index++) {
				applyPlaybackChanges(playback.macroValues, playback.entries[index].macroChanges);
				applyPlaybackDisplayPrecisionChanges(playback.macroDisplayPrecisions, playback.entries[index].macroDisplayPrecisionChanges);
			}
		}

		function updatePlaybackPanel() {
			if (!playback || !playback.active) return;
			const entry = playback.entries[playback.cursor];
			const showTrace = analysisModeSelect.value === "trace" && lineDataSelect.value === "trace";
			playbackPosition.textContent = "Event " + (playback.cursor + 1) + " / " + playback.entries.length;
			playbackScrubber.value = String(playback.cursor + 1);
			const start = Math.max(0, playback.cursor - 2);
			const end = Math.min(playback.entries.length, playback.cursor + 3);
			playbackContext.innerHTML = playback.entries.slice(start, end).map((contextEntry, offset) => {
				const index = start + offset;
				const lineNumber = showTrace && Number.isFinite(contextEntry.decompositionLineNumber)
					? contextEntry.decompositionLineNumber
					: Number(contextEntry.lineNumber) + 1;
				const code = showTrace ? (contextEntry.traceLine || contextEntry.sourceLine) : contextEntry.sourceLine;
				return '<div class="playback-context-line' + (index === playback.cursor ? ' current' : '') + '" data-source-line="' + contextEntry.lineNumber + '" title="Open source line ' + (Number(contextEntry.lineNumber) + 1) + '"><span>' + (showTrace ? 'T' : 'S') + lineNumber + '</span><code>' + svgEscape(code || '') + '</code></div>';
			}).join("");
			const aliases = new Map((data.macroVariables || []).map(variable => [variable.macro, variable.label]));
			const macroLastUpdates = getPlaybackMacroLastUpdates();
			const values = [...playback.macroValues.entries()].filter(([, value]) => Number.isFinite(value)).sort(([left], [right]) => {
				if (playbackMacroSortMode === "recent") {
					const updateDifference = (macroLastUpdates.get(right) ?? -1) - (macroLastUpdates.get(left) ?? -1);
					if (updateDifference) return updateDifference;
				}
				return left.localeCompare(right, undefined, { numeric: true });
			});
			playbackMacroValues.innerHTML = values.length
				? values.map(([macro, value]) => '<tr><td><code>' + svgEscape(macro) + '</code></td><td>' + svgEscape(aliases.get(macro) || '—') + '</td><td><code>' + svgEscape(formatPlaybackMacroValue(value, playback.macroDisplayPrecisions.get(macro))) + '</code></td></tr>').join("")
				: '<tr><td class="note" colspan="3">No resolved macro values yet.</td></tr>';
		}

		function formatPlaybackMacroValue(value, explicitPrecision) {
			const numericValue = Number(value);
			if (!Number.isFinite(numericValue)) return String(value);
			const decimalPlaces = Math.max(3, Math.min(6, Number(explicitPrecision) || 0));
			let formatted = numericValue.toFixed(decimalPlaces);
			if (!data.options.playbackMacroSignificantFiguresOnly) return numericValue === 0 ? (0).toFixed(decimalPlaces) : formatted;
			while (formatted.includes(".") && formatted.endsWith("0")) formatted = formatted.slice(0, -1);
			if (formatted.endsWith(".")) formatted = formatted.slice(0, -1);
			return formatted === "-0" ? "0" : formatted;
		}

		function getPlaybackMacroLastUpdates() {
			const lastUpdates = new Map();
			for (let index = 0; index <= playback.cursor; index++) {
				for (const change of playback.entries[index].macroChanges || []) lastUpdates.set(change.macro, index);
			}
			return lastUpdates;
		}

		function setPlaybackMacroDockOpen(isOpen) {
			playbackMacroPanel.classList.toggle("open", isOpen);
			document.body.classList.toggle("playback-macros-open", isOpen);
			playbackMacrosToggle.setAttribute("aria-expanded", String(isOpen));
			render();
		}

		function setPlaybackCursor(nextCursor) {
			if (!playback) return;
			const next = Math.max(0, Math.min(playback.entries.length - 1, Math.round(nextCursor)));
			if (next === playback.cursor) return;
			playback.cursor = next;
			restorePlaybackMacroValues(next);
			updatePlaybackPanel();
			updateVirtualTable(false);
			render();
		}

		function setPlaybackPlaying(playing) {
			if (!playback || !playback.active) return;
			playback.playing = playing;
			if (playback.timer) window.clearInterval(playback.timer);
			playback.timer = undefined;
			if (playing) {
				playback.timer = window.setInterval(() => {
					if (playback.cursor >= playback.entries.length - 1) {
						setPlaybackPlaying(false);
						return;
					}
					setPlaybackCursor(playback.cursor + 1);
				}, 350);
			}
		}

		function startPlayback() {
			if (!playback) {
				vscode.postMessage({ type: "startVisionPlayback" });
				return;
			}
			playback.active = true;
			playbackPanel.classList.add("open");
			playbackToggle.textContent = "■";
			playbackToggle.classList.add("stop");
			playbackToggle.title = "Exit playback";
			playbackToggle.setAttribute("aria-label", "Exit playback");
			playbackScrubber.max = String(playback.entries.length);
			restorePlaybackMacroValues(playback.cursor);
			updatePlaybackPanel();
			playbackCode.focus();
			render();
			setPlaybackPlaying(false);
		}

		function render() {
			sizeViewer();
			const planeKey = planeSelect.value;
			const plane = planes[planeKey] || planes.xz;
			const visibility = getVisibilityState();
			const visibilityKey = getVisibilityKey(visibility);
			const projected = getProjectedPlaneData(planeKey, plane);
			const visible = getVisibleProjectedData(projected, visibility);
			const rows = visible.rows;
			const cycles = visible.cycles;
			const toolChanges = visible.toolChanges;
			const events = visible.events;
			const viewerRect = viewer.getBoundingClientRect();
			const fitBounds = makeBounds(rows, cycles, toolChanges, events);
			currentFitBounds = fitBounds;
			const viewportAspect = Math.max(1, viewerRect.width) / Math.max(1, viewerRect.height);
			const bounds = zoomBounds(fitBounds, viewportAspect);
			currentBounds = bounds;
			const playbackActive = playback && playback.active;
			const showLabels = labelsInput.checked && !playbackActive;
			const showEndpoints = endpointsInput.checked && !playbackActive;
			const showZeroLines = zeroLinesInput.checked;
			const useToolColors = toolColorsInput.checked;
			const unitsPerPixel = bounds.height / Math.max(1, viewerRect.height);
			const labelSize = unitsPerPixel * data.options.labelFontSize;
			const compassSize = unitsPerPixel * data.options.compassSize;
			const compassOffsetX = unitsPerPixel * data.options.compassOffsetX;
			const compassOffsetY = unitsPerPixel * data.options.compassOffsetY;
			const compassTextSize = compassSize * 0.16;
			const endpointSize = unitsPerPixel * data.options.endpointSize;
			const arrowSize = unitsPerPixel * 8 * data.options.arrowSize;
			const endpointLabelOutline = unitsPerPixel * 1.5;
			const lineScale = data.options.lineThickness;

			if (visibilityKey !== currentTableVisibilityKey) {
				currentTableVisibilityKey = visibilityKey;
				currentTableRows = data.rows.filter(row => row.type === "label" || isRowVisible(row, visibility));
				updateVirtualTable(true);
			}

			if (!rows.length && !cycles.length && !toolChanges.length && !events.length) {
				viewer.innerHTML = '<p class="empty" style="padding: 16px;">No drawable moves found for the selected plane.</p>';
				return;
			}

			const zoomBucket = getZoomBucket(zoom);
			const labelEntry = getLabelCacheEntry({
				planeKey,
				plane,
				visibilityKey,
				showLabels,
				showEndpoints,
				zoomBucket,
				viewportAspect,
				fitBounds,
				viewerSize: Math.max(1, viewerRect.height),
				rows,
				cycles,
				toolChanges,
				events
			});
			currentLabelEntry = labelEntry;
			scheduleLabelCachePrewarm({
				planeKey,
				plane,
				visibilityKey,
				showLabels,
				showEndpoints,
				zoomBucket,
				viewportAspect,
				fitBounds,
				viewerSize: Math.max(1, viewerRect.height),
				rows,
				cycles,
				toolChanges,
				events
			});
			const visibleLabelTargets = queryLabelCacheEntry(labelEntry, bounds, Math.max(labelEntry.mergeDistance, labelEntry.labelSize * 8));
			const drawBounds = expandBounds(bounds, Math.max(unitsPerPixel * 48, labelEntry.mergeDistance));
			const canvasRows = rows.filter(row => rowBoundsIntersect(row.projectedBounds, drawBounds));
			const canvasCycles = cycles.filter(cycle => rowBoundsIntersect(cycle.projectedBounds, drawBounds));
			const currentPlaybackDot = getCurrentPlaybackDot(projected);
			updatePlaybackPositionReadout(getCurrentPlaybackPosition(projected));
			const labelsAndMarkers = layoutPointLabels(visibleLabelTargets, {
				labelSize: labelEntry.labelSize,
				labelOffset: labelEntry.labelOffset,
				labelHitboxPadding: labelEntry.labelHitboxPadding
			}).map(renderPointLabel).join("");
			const zeroAxes = showZeroLines ? renderZeroAxes(bounds) : "";
			const compass = renderCompass(bounds, plane, compassSize, compassOffsetX, compassOffsetY);
			const overlaySvg = '<svg id="vision-svg" class="vision-overlay" xmlns="http://www.w3.org/2000/svg" viewBox="' + [bounds.minX, bounds.minY, bounds.width, bounds.height].map(round).join(" ") + '" preserveAspectRatio="none" role="img" aria-label="KAIJU Vision ' + plane.label + ' path">' +
				'<style>' +
					'.zero-line{stroke:#6f6f6f;stroke-width:' + 0.8 * lineScale + ';stroke-dasharray:6 5;vector-effect:non-scaling-stroke;}.compass{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + compassTextSize + 'px;font-weight:600;}.endpoint-label,.start-label{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + labelSize + 'px;}.endpoint-label{stroke:#000;stroke-width:' + endpointLabelOutline + ';stroke-linejoin:round;paint-order:stroke fill;}.tool-change-label{font-family:Consolas,monospace;font-size:' + labelSize + 'px;font-weight:600;stroke:#000;stroke-width:' + endpointLabelOutline + ';stroke-linejoin:round;paint-order:stroke fill;}.point-label{text-anchor:middle;}.cycle-point{fill:#4fc3ff;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.tool-change-dot{fill:#88ff00;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.endpoint{fill:var(--vscode-foreground,#d4d4d4);stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.75 * lineScale + ';vector-effect:non-scaling-stroke;}.endpoint-program-end{fill:#7f1d1d;}.endpoint-optional-stop{fill:#dcdc6b;}.endpoint-speed-change{fill:#ff2b2b;}.endpoint-compensation{fill:#1f7a3a;}.endpoint-compensation-cancel{fill:#8e44ad;}.start-point{fill:#6A9955;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.arrow-rapid{fill:#ff8800;}.arrow-cut{fill:#ffd500;}' +
				'</style>' +
				zeroAxes +
				compass +
				labelsAndMarkers +
				'</svg>';

			hideTooltip();
			viewer.innerHTML = '<canvas id="vision-canvas" class="vision-canvas"></canvas>' + overlaySvg;
			drawCanvasLayer({
				rows: canvasRows,
				cycles: canvasCycles,
				bounds,
				useToolColors,
				endpointSize,
				arrowSize,
				unitsPerPixel,
				lineScale,
				playback: playback && playback.active ? playback : undefined,
				currentPlaybackDot
			});
		}

		function getZoomBucket(value) {
			const base = Math.max(1.01, wheelZoomStep);

			return Math.round(Math.log(Math.max(1, value)) / Math.log(base));
		}

		function getZoomForBucket(bucket) {
			return Math.pow(Math.max(1.01, wheelZoomStep), bucket);
		}

		function getLabelCacheEntry(context) {
			const key = makeLabelCacheKey(context);

			if (labelCacheLimitBytes > 0 && labelCache.has(key)) {
				const cached = labelCache.get(key);
				cached.lastUsed = Date.now();
				cached.currentDistance = Math.abs(cached.zoomBucket - getZoomBucket(zoom));
				return cached;
			}

			const entry = buildLabelCacheEntry(context, key);

			if (labelCacheLimitBytes > 0) {
				labelCache.set(key, entry);
				labelCacheBytes += entry.bytes;
				evictLabelCache(context.zoomBucket);
			}

			return entry;
		}

		function makeLabelCacheKey(context) {
			return [
				context.planeKey,
				context.visibilityKey,
				context.showLabels ? "labels" : "markers",
				context.showEndpoints ? "endpoints" : "no-endpoints",
				Math.round((Number(context.viewportAspect) || 1) * 1000) / 1000,
				context.zoomBucket
			].join("::");
		}

		function buildLabelCacheEntry(context, key) {
			const bucketZoom = getZoomForBucket(context.zoomBucket);
			const aspect = Math.max(0.000001, Number(context.viewportAspect) || 1);
			const fitHeight = Math.max(context.fitBounds.height, context.fitBounds.width / aspect);
			const bucketUnitsPerPixel = fitHeight / Math.max(1, bucketZoom) / Math.max(1, context.viewerSize);
			const metrics = makeLabelMetrics(bucketUnitsPerPixel);
			const entry = {
				key,
				zoomBucket: context.zoomBucket,
				lastUsed: Date.now(),
				currentDistance: Math.abs(context.zoomBucket - getZoomBucket(zoom)),
				labelSize: metrics.labelSize,
				labelOffset: metrics.labelOffset,
				labelHitboxPadding: metrics.labelHitboxPadding,
				mergeDistance: bucketUnitsPerPixel * data.options.pointMergeDistance,
				targets: [],
				spatialCells: new Map(),
				hoverItemsById: new Map(),
				hoverHtmlById: new Map(),
				bytes: 0
			};
			const targets = makeLabelTargetsForCache(context, metrics);
			const collapsedTargets = collapseCoincidentLabelTargets(targets, context.plane, data.options.humanFormat, entry.mergeDistance, context.showLabels);

			assignHoverIds(entry, collapsedTargets);
			entry.targets = collapsedTargets;
			entry.spatialCellSize = Math.max(entry.mergeDistance, entry.labelSize * 8, 0.000001);
			indexLabelTargets(entry);
			entry.bytes = estimateLabelCacheEntryBytes(entry);
			return entry;
		}

		function makeLabelMetrics(unitsPerPixel) {
			return {
				labelSize: unitsPerPixel * data.options.labelFontSize,
				labelOffset: unitsPerPixel * data.options.labelOffset,
				labelHitboxPadding: unitsPerPixel * 8,
				endpointSize: unitsPerPixel * data.options.endpointSize,
				startPointSize: unitsPerPixel * data.options.startPointSize,
				toolChangeSize: unitsPerPixel * 4,
				cyclePointSize: unitsPerPixel * 4
			};
		}

		function makeLabelTargetsForCache(context, metrics) {
			const targets = [];
			const cycleTargets = context.cycles.map(cycle => makePointLabelTarget(cycle.projectedPoint, metrics.cyclePointSize, "cycle-point", "endpoint-label", context.showLabels ? "L" + cycle.lineNumber + " " + cycle.instruction : "", context.showLabels ? cycle.labelCoordinateLine : "", { kind: "cycle", position: cycle.end, hoverItems: [cycle.labelHoverHtml], showMarker: context.showEndpoints }));
			const toolTargets = context.toolChanges.map(toolChange => makeToolChangeLabelTarget(toolChange, context.showLabels, metrics.toolChangeSize, context.showEndpoints));
			const eventTargets = context.events.map(event => makePointLabelTarget(event.projectedPoint, metrics.endpointSize, event.markerClass || "endpoint endpoint-stop", "endpoint-label", context.showLabels ? event.instruction : "", context.showLabels ? event.labelCoordinateLine : "", { kind: event.markerKind || "event", position: event.position, hoverItems: [event.labelHoverHtml], showMarker: context.showEndpoints }));
			const firstRow = context.rows[0];
			const firstPoint = firstRow && firstRow.projectedPoints[0];

			if (firstPoint) {
				targets.push(makePointLabelTarget(firstPoint, metrics.startPointSize, "start-point", "start-label", context.showLabels ? "START" : "", context.showLabels ? firstRow.startCoordinateLine : "", { kind: "start", position: firstRow.start, hoverItems: [firstRow.startHoverHtml], showMarker: context.showEndpoints }));
			}

			targets.push(...cycleTargets);
			targets.push(...toolTargets);
			targets.push(...eventTargets);

			for (const row of context.rows) {
				const end = row.projectedEnd || row.projectedPoints[row.projectedPoints.length - 1];

				if (!end) {
					continue;
				}

				targets.push(makePointLabelTarget(end, metrics.endpointSize, row.markerClass || "endpoint", "endpoint-label", context.showLabels ? "L" + row.lineNumber : "", context.showLabels ? row.endCoordinateLine : "", { kind: row.markerKind || "endpoint", position: row.end, hoverItems: [row.endHoverHtml], showMarker: context.showEndpoints }));
			}

			return targets;
		}

		function assignHoverIds(entry, targets) {
			let nextId = 1;
			const idsByItems = new WeakMap();

			for (const target of targets) {
				if (!target.hoverItems || !target.hoverItems.length) {
					continue;
				}

				let hoverId = idsByItems.get(target.hoverItems);

				if (!hoverId) {
					hoverId = String(nextId++);
					idsByItems.set(target.hoverItems, hoverId);
					entry.hoverItemsById.set(hoverId, target.hoverItems);
				}

				target.hoverId = hoverId;
				delete target.hoverItems;
			}
		}

		function indexLabelTargets(entry) {
			for (const target of entry.targets) {
				const cell = makeLabelCacheCell(target.point, entry.spatialCellSize);
				const key = cell.x + "," + cell.y;
				const targets = entry.spatialCells.get(key) || [];
				targets.push(target);
				entry.spatialCells.set(key, targets);
			}
		}

		function queryLabelCacheEntry(entry, bounds, padding) {
			if (!entry) {
				return [];
			}

			const queryBounds = expandBounds(bounds, padding);
			const minCell = makeLabelCacheCell({ x: queryBounds.minX, y: queryBounds.minY }, entry.spatialCellSize);
			const maxCell = makeLabelCacheCell({ x: queryBounds.minX + queryBounds.width, y: queryBounds.minY + queryBounds.height }, entry.spatialCellSize);
			const targets = [];
			const seen = new Set();

			for (let x = minCell.x; x <= maxCell.x; x++) {
				for (let y = minCell.y; y <= maxCell.y; y++) {
					const cellTargets = entry.spatialCells.get(x + "," + y);

					if (!cellTargets) {
						continue;
					}

					for (const target of cellTargets) {
						if (seen.has(target)) {
							continue;
						}

						seen.add(target);

						if (isPointNearBounds(target.point, bounds, padding)) {
							targets.push(target);
						}
					}
				}
			}

			return targets;
		}

		function makeLabelCacheCell(point, cellSize) {
			const size = Math.max(cellSize, 0.000001);

			return {
				x: Math.floor(point.x / size),
				y: Math.floor(point.y / size)
			};
		}

		function getCachedTooltipHtml(entry, hoverId) {
			if (!entry || !hoverId) {
				return "";
			}

			if (entry.hoverHtmlById.has(hoverId)) {
				return entry.hoverHtmlById.get(hoverId);
			}

			const items = entry.hoverItemsById.get(hoverId) || [];
			const html = '<div class="tooltip-item">' + items.join("") + '</div>';
			entry.hoverHtmlById.set(hoverId, html);
			return html;
		}

		function estimateLabelCacheEntryBytes(entry) {
			let bytes = 2048 + entry.targets.length * 180 + entry.spatialCells.size * 80;

			for (const target of entry.targets) {
				bytes += String(target.labelLine || "").length * 2;
				bytes += String(target.coordinateLine || "").length * 2;
				bytes += String(target.hoverId || "").length * 2;
			}

			for (const items of entry.hoverItemsById.values()) {
				bytes += 64;
				for (const item of items) {
					bytes += String(item || "").length * 2;
				}
			}

			return bytes;
		}

		function evictLabelCache(currentBucket) {
			if (labelCacheBytes <= labelCacheLimitBytes) {
				return;
			}

			const entries = [...labelCache.values()].sort((a, b) => {
				const distance = Math.abs(b.zoomBucket - currentBucket) - Math.abs(a.zoomBucket - currentBucket);

				return distance || a.lastUsed - b.lastUsed;
			});

			for (const entry of entries) {
				if (labelCacheBytes <= labelCacheLimitBytes) {
					break;
				}

				labelCache.delete(entry.key);
				labelCacheBytes -= entry.bytes;
			}
		}

		function scheduleLabelCachePrewarm(context) {
			if (labelCacheLimitBytes <= 0) {
				return;
			}

			const prewarmKey = makeLabelCacheKey(context);

			if (prewarmKey === lastPrewarmKey) {
				return;
			}

			lastPrewarmKey = prewarmKey;
			const runId = ++labelCacheRunId;
			const buckets = [-1, 1, -2, 2].map(offset => context.zoomBucket + offset).filter(bucket => bucket >= 0);
			const schedule = window.requestIdleCallback || (callback => window.setTimeout(() => callback({ timeRemaining: () => 8 }), 80));
			let index = 0;
			const work = deadline => {
				while (index < buckets.length && deadline.timeRemaining() > 2) {
					if (runId !== labelCacheRunId) {
						return;
					}

					const zoomBucket = buckets[index++];
					const nextContext = Object.assign({}, context, { zoomBucket });
					const key = makeLabelCacheKey(nextContext);

					if (!labelCache.has(key)) {
						getLabelCacheEntry(nextContext);
					}
				}

				if (index < buckets.length && runId === labelCacheRunId) {
					schedule(work);
				}
			};

			schedule(work);
		}

		function updateVirtualTable(resetScroll = false) {
			if (!tableWrap || !tableBody) {
				return;
			}

			if (resetScroll) {
				tableWrap.scrollTop = 0;
			}

			const totalRows = currentTableRows.length;
			const overscan = 6;
			const visibleCount = Math.max(1, Math.ceil(tableWrap.clientHeight / tableRowHeight) + overscan * 2);
			const startIndex = Math.max(0, Math.floor(tableWrap.scrollTop / tableRowHeight) - overscan);
			const endIndex = Math.min(totalRows, startIndex + visibleCount);
			const topHeight = startIndex * tableRowHeight;
			const bottomHeight = Math.max(0, (totalRows - endIndex) * tableRowHeight);
			const rows = [];

			if (topHeight > 0) {
				rows.push(makeTableSpacerRow(topHeight));
			}

			for (let index = startIndex; index < endIndex; index++) {
				rows.push(renderVirtualTableRow(currentTableRows[index]));
			}

			if (bottomHeight > 0) {
				rows.push(makeTableSpacerRow(bottomHeight));
			}

			tableBody.innerHTML = rows.join("");
		}

		function makeTableSpacerRow(height) {
			return '<tr class="table-spacer"><td colspan="9" style="height:' + Math.max(0, Math.round(height)) + 'px"></td></tr>';
		}

		function renderVirtualTableRow(row) {
			const playbackAttribute = Number.isFinite(row.executionIndex) ? ' data-playback-index="' + row.executionIndex + '"' : "";
			if (row.type === "label") {
				const comment = row.comment ? " " + row.comment : "";

				return '<tr class="label-row"' + playbackAttribute + '>' +
					renderTableToolMarkerCell(row) +
					'<td class="tool-marker-gap"></td>' +
					'<td>' + svgEscape(row.lineNumber) + '</td>' +
					'<td colspan="6"><code>' + svgEscape(row.instruction) + '</code>' + svgEscape(comment) + '</td>' +
				'</tr>';
			}

			return '<tr' + playbackAttribute + '>' +
				renderTableToolMarkerCell(row) +
				'<td class="tool-marker-gap"></td>' +
				'<td>' + svgEscape(row.lineNumber) + '</td>' +
				'<td><code>' + svgEscape(row.instruction) + '</code></td>' +
				'<td>' + svgEscape(getRowWcsLabel(row)) + '</td>' +
				'<td>' + svgEscape(row.startLabel || "-") + '</td>' +
				'<td>' + svgEscape(row.endLabel || "-") + '</td>' +
				'<td>' + svgEscape(formatTableDistance(row)) + '</td>' +
				'<td class="notes">' + (svgEscape((row.warnings || []).join(" ")) || "-") + '</td>' +
			'</tr>';
		}

		function renderTableToolMarkerCell(row) {
			const style = row.toolColor ? ' style="background:' + escapeAttribute(row.toolColor) + '"' : "";

			return '<td class="tool-marker-cell"' + style + '></td>';
		}

		function getRowWcsLabel(row) {
			const key = getRowWcsKey(row);

			return key === "__none" ? "No WCS" : key;
		}

		function formatTableDistance(row) {
			if (row.type === "tool") {
				return "Tool change";
			}

			if (Number.isFinite(row.distance) && Math.abs(row.distance) < 0.000000001) {
				return "0.00";
			}

			return Number.isFinite(row.distance)
				? formatAxisNumber(row.distance, data.options.humanFormat)
				: "-";
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
				showMarker: details.showMarker !== false,
				hoverItems: details.hoverItems || (details.hoverHtml ? [details.hoverHtml] : [])
			};
		}

		function makeToolChangeLabelTarget(toolChange, showLabels, toolChangeSize, showMarker) {
			return makePointLabelTarget(
				toolChange.projectedPoint,
				toolChangeSize,
				"tool-change-dot",
				"endpoint-label",
				showLabels ? "T[1]" : "",
				showLabels ? toolChange.labelCoordinateLine : "",
				{ kind: "tool", position: toolChange.point, hoverItems: [toolChange.labelHoverHtml], showMarker }
			);
		}

		function makePointHoverHtml(position, row) {
			const showTraceLine = analysisModeSelect.value === "trace" && lineDataSelect.value === "trace" && row && row.traceLine && Number.isFinite(row.decompositionLineNumber);
			const displayedLineNumber = showTraceLine && Number.isFinite(row.decompositionLineNumber)
				? row.decompositionLineNumber
				: row && Number.isFinite(row.lineNumber) ? row.lineNumber : undefined;
			const lineLabel = Number.isFinite(displayedLineNumber) ? "L" + displayedLineNumber : "";
			const instruction = row && row.instruction ? row.instruction : "";
			const lines = ['<div class="tooltip-line">' + svgEscape((lineLabel + " " + instruction).trim()) + '</div>'];
			const codeLine = showTraceLine ? row.traceLine : row && row.sourceLine;
			if (codeLine) lines.push('<div class="tooltip-line">' + svgEscape(codeLine.trim()) + '</div>');

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
		function collapseCoincidentLabelTargets(targets, plane, humanFormat, mergeDistance, showLabels) {
			const tolerance = Math.max(0, Number(mergeDistance) || 0);
			const groups = [];
			const exactGroups = new Map();
			const spatialCells = new Map();

			for (const target of targets) {
				let group;

				if (tolerance <= 0) {
					const key = makePointKey(target.point);
					group = exactGroups.get(key);

					if (!group) {
						group = [];
						exactGroups.set(key, group);
						groups.push(group);
					}
				} else {
					group = findNearbyLabelGroup(target, spatialCells, tolerance);

					if (!group) {
						group = [];
						groups.push(group);
					}

					addLabelTargetToSpatialCells(target, group, spatialCells, tolerance);
				}

				group.push(target);
			}

			return groups.flatMap(group => group.length > 1 ? makeCollapsedLabelTargets(group, plane, humanFormat, showLabels) : group[0]);
		}

		function findNearbyLabelGroup(target, spatialCells, tolerance) {
			const cell = makeMergeCell(target.point, tolerance);

			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const entries = spatialCells.get((cell.x + dx) + "," + (cell.y + dy));

					if (!entries) {
						continue;
					}

					for (const entry of entries) {
						if (getPointDistance(entry.target.point, target.point) <= tolerance) {
							return entry.group;
						}
					}
				}
			}

			return undefined;
		}

		function addLabelTargetToSpatialCells(target, group, spatialCells, tolerance) {
			const cell = makeMergeCell(target.point, tolerance);
			const key = cell.x + "," + cell.y;
			const entries = spatialCells.get(key) || [];
			entries.push({ target, group });
			spatialCells.set(key, entries);
		}

		function makeMergeCell(point, tolerance) {
			const size = Math.max(tolerance, 0.000001);

			return {
				x: Math.floor(point.x / size),
				y: Math.floor(point.y / size)
			};
		}

		function makeCollapsedLabelTargets(group, plane, humanFormat, showLabels) {
			const representative = chooseRepresentativeTarget(group);
			const sourcePosition = representative.sourcePosition || (group.find(target => target.sourcePosition) || {}).sourcePosition;
			const toolCount = group.filter(target => target.kind === "tool").length;
			const hoverItems = group.flatMap(target => target.hoverItems && target.hoverItems.length
				? target.hoverItems
				: ['<div class="tooltip-row"><div class="tooltip-line">' + svgEscape([target.labelLine, target.coordinateLine].filter(Boolean).join(" ")) + '</div></div>']);
			const markerSlices = makeMergedMarkerSlices(group);
			const mergedSemanticEndpointScale = Math.max(1, Number(data.options.mergedSemanticEndpointScale) || 1.5);
			const mergedPointSize = Math.max(...group.map(target => target.pointSize || 0)) * (markerSlices && markerSlices.length > 1 ? mergedSemanticEndpointScale : 1);

			const collapsedTarget = Object.assign({}, representative, {
				pointSize: mergedPointSize,
				labelLine: showLabels ? makeCollapsedLabelText(group.length, toolCount, sourcePosition, plane, humanFormat, data.options.trimLabelTrailingZeros !== false) : "",
				coordinateLine: "",
				markerSlices,
				showMarker: representative.showMarker,
				hoverItems
			});
			const markerTargets = group
				.filter(target => target !== representative)
				.map(target => Object.assign({}, target, {
					labelLine: "",
					coordinateLine: "",
					// A normal endpoint carries no additional semantic meaning. Once a
					// merged point has a semantic marker, do not let its separate grey
					// endpoint circle paint over that marker.
					showMarker: markerSlices && markerSlices.length ? false : target.showMarker,
					hoverItems
				}));

			return [collapsedTarget, ...markerTargets];
		}

		function makeMergedMarkerSlices(group) {
			const slices = [];
			const seen = new Set();

			for (const target of group) {
				const slice = getMarkerSlice(target);

				if (!slice || seen.has(slice.key)) {
					continue;
				}

				seen.add(slice.key);
				slices.push(slice);
			}

			return slices.length ? slices : undefined;
		}

		function getMarkerSlice(target) {
			if (target.kind === "programEnd" || hasClassName(target.pointClass, "endpoint-program-end")) {
				return { key: "programEnd", color: "#7f1d1d" };
			}

			if (target.kind === "optionalStop" || hasClassName(target.pointClass, "endpoint-optional-stop")) {
				return { key: "optionalStop", color: "#dcdc6b" };
			}

			if (target.kind === "speedChange" || hasClassName(target.pointClass, "endpoint-speed-change")) {
				return { key: "speedChange", color: "#ff2b2b" };
			}

			if (target.kind === "tool" || hasClassName(target.pointClass, "tool-change-dot")) {
				return { key: "tool", color: "#88ff00" };
			}

			if (target.kind === "compensation" || hasClassName(target.pointClass, "endpoint-compensation")) {
				return { key: "compensation", color: "#1f7a3a" };
			}

			if (target.kind === "compensationCancel" || hasClassName(target.pointClass, "endpoint-compensation-cancel")) {
				return { key: "compensationCancel", color: "#8e44ad" };
			}

			return undefined;
		}

		function hasClassName(classText, className) {
			return (" " + String(classText || "") + " ").includes(" " + className + " ");
		}

		function chooseRepresentativeTarget(group) {
			const priority = { programEnd: 8, optionalStop: 7, speedChange: 6, tool: 5, start: 4, compensation: 3, compensationCancel: 3, cycle: 2, endpoint: 1 };

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

					return Object.assign({}, target, {
						labelX: stacked.labelX,
						firstBaselineY: stacked.firstBaselineY
					});
				}

				const chosen = makeSimpleLabelPlacement(target, options);

				return Object.assign({}, target, {
					labelX: chosen.labelX,
					firstBaselineY: chosen.firstBaselineY
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

		function makeSimpleLabelPlacement(target, options) {
			const metrics = measurePointLabel(target, options.labelSize, options.labelHitboxPadding);
			const yDistance = target.pointSize + options.labelOffset + metrics.height / 2;

			return {
				labelX: target.point.x,
				firstBaselineY: target.point.y + yDistance - metrics.height / 2 + metrics.firstBaselineOffset
			};
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

		function renderPointLabel(target) {
			const x = round(target.point.x);
			const y = round(target.point.y);
			const tooltipAttribute = target.hoverId ? ' data-tooltip-id="' + escapeAttribute(target.hoverId) + '"' : "";
			const markerKeys = getMarkerLegendKeys(target);
			const markerKeysAttribute = markerKeys.length ? ' data-marker-keys="' + escapeAttribute(markerKeys.join(",")) + '"' : "";
			const marker = target.showMarker === false ? "" : renderPointMarker(target, x, y);

			if (!target.labelLine && !target.coordinateLine) {
				return marker ? '<g class="point-label-hit"' + tooltipAttribute + markerKeysAttribute + '>' + marker + '</g>' : "";
			}

			return '<g class="point-label-hit"' + tooltipAttribute + markerKeysAttribute + '>' + marker +
				'<text class="point-label ' + target.labelClass + '" x="' + round(target.labelX) + '" y="' + round(target.firstBaselineY) + '">' +
					'<tspan x="' + round(target.labelX) + '">' + svgEscape(target.labelLine) + '</tspan>' +
					(target.coordinateLine ? '<tspan x="' + round(target.labelX) + '" dy="1.15em">' + svgEscape(target.coordinateLine) + '</tspan>' : "") +
				'</text>' +
				'</g>';
		}

		function getMarkerLegendKeys(target) {
			if (target.markerSlices && target.markerSlices.length) {
				return target.markerSlices.map(slice => slice.key);
			}

			const slice = getMarkerSlice(target);

			return slice ? [slice.key] : [];
		}

		function renderPointMarker(target, x, y) {
			if (!target.markerSlices || !target.markerSlices.length) {
				return '<circle class="' + target.pointClass + '" cx="' + x + '" cy="' + y + '" r="' + target.pointSize + '" />';
			}

			if (target.markerSlices.length === 1) {
				return '<circle class="' + target.pointClass + '" cx="' + x + '" cy="' + y + '" r="' + target.pointSize + '" style="fill:' + escapeAttribute(target.markerSlices[0].color) + '" />';
			}

			const radius = Number(target.pointSize) || 0;
			const angleStep = Math.PI * 2 / target.markerSlices.length;
			const slices = target.markerSlices.map((slice, index) => {
				const startAngle = -Math.PI / 2 + index * angleStep;
				const endAngle = startAngle + angleStep;
				const start = makePiePoint(x, y, radius, startAngle);
				const end = makePiePoint(x, y, radius, endAngle);
				const largeArc = angleStep > Math.PI ? 1 : 0;

				return '<path d="M ' + x + ' ' + y + ' L ' + round(start.x) + ' ' + round(start.y) + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + round(end.x) + ' ' + round(end.y) + ' Z" fill="' + escapeAttribute(slice.color) + '" />';
			}).join("");

			return '<g>' + slices +
				'<circle class="' + target.pointClass + '" cx="' + x + '" cy="' + y + '" r="' + radius + '" style="fill:none" />' +
				'</g>';
		}

		function makePiePoint(x, y, radius, angle) {
			return {
				x: x + Math.cos(angle) * radius,
				y: y + Math.sin(angle) * radius
			};
		}

		function drawCanvasLayer(state) {
			const canvas = document.getElementById("vision-canvas");

			if (!canvas || !state) {
				return;
			}

			const rect = canvas.getBoundingClientRect();
			const scale = window.devicePixelRatio || 1;
			const width = Math.max(1, Math.floor(rect.width * scale));
			const height = Math.max(1, Math.floor(rect.height * scale));

			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}

			const context = canvas.getContext("2d");

			if (!context) {
				return;
			}

			context.clearRect(0, 0, width, height);
			context.save();
			context.scale(scale, scale);
			const transform = makeCanvasTransform(state.bounds, rect.width, rect.height);

			drawMotionRows(context, state.rows, state, transform);
			drawCycleRows(context, state.cycles, state, transform);
			drawDirectionArrows(context, state.rows, state, transform);
			drawCurrentPlaybackDot(context, state.currentPlaybackDot, transform);
			context.restore();
		}

		function getCurrentPlaybackDot(projected) {
			if (!playback || !playback.active) return undefined;
			const currentEntry = playback.entries[playback.cursor];
			const candidates = [
				...(projected.rows || []),
				...(projected.cycles || []),
				...(projected.toolChanges || []),
				...(projected.events || [])
			].filter(row => Number.isFinite(row.executionIndex) && row.executionIndex <= playback.cursor)
				.sort((left, right) => left.executionIndex - right.executionIndex);
			let point;
			for (const candidate of candidates) {
				point = candidate.projectedEnd || candidate.projectedPoint || (candidate.projectedPoints && candidate.projectedPoints[candidate.projectedPoints.length - 1]) || point;
			}
			if (!point) return undefined;
			const currentMotion = [...(projected.rows || []), ...(projected.cycles || [])].find(row => row.executionIndex === playback.cursor);
			return { point, color: getPlaybackDotColor(currentEntry, currentMotion) };
		}

		function getCurrentPlaybackPosition(projected) {
			if (!playback || !playback.active) return undefined;
			const candidates = [
				...(projected.rows || []),
				...(projected.cycles || []),
				...(projected.toolChanges || []),
				...(projected.events || [])
			].filter(row => Number.isFinite(row.executionIndex) && row.executionIndex <= playback.cursor)
				.sort((left, right) => left.executionIndex - right.executionIndex);
			let position;
			for (const candidate of candidates) {
				position = candidate.end || candidate.position || candidate.point || position;
			}
			return position;
		}

		function updatePlaybackPositionReadout(position) {
			if (!playbackPositionReadout) return;
			const axes = playback && playback.active ? playback.usedAxes : [];
			if (!position || !axes.length) {
				playbackPositionReadout.classList.remove("open");
				playbackPositionReadout.textContent = "";
				return;
			}
			playbackPositionReadout.innerHTML = axes.map(axis => {
				const value = position[axis];
				const text = Number.isFinite(value) ? formatAxisNumber(value, data.options.humanFormat) : "—";
				return '<span class="playback-position-axis axis-' + axis + '"><span class="axis-letter">' + axis.toUpperCase() + '</span> ' + svgEscape(text) + '</span>';
			}).join("");
			playbackPositionReadout.classList.add("open");
		}

		function getPlaybackDotColor(entry, motionRow) {
			const code = String(entry && entry.sourceLine || "");
			if (/\\bT\\d+/i.test(code)) return "#88ff00";
			if (motionRow) return motionRow.motionCode === 0 ? "#ff8800" : "#ffd500";
			if (/#(?:\\d+|[A-Za-z_][A-Za-z0-9_]*)\\s*=/i.test(code)) return "#eb17e4";
			if (/\\bS[-+]?\\d/i.test(code)) return "#ff2b2b";
			if (/\\bM\\d+/i.test(code)) return "#9CDCFE";
			if (/\\bG4[12]\\b/i.test(code)) return "#1f7a3a";
			if (/\\bG40\\b/i.test(code)) return "#8e44ad";
			return "#2F6DA5";
		}

		function drawCurrentPlaybackDot(context, currentDot, transform) {
			if (!currentDot || !currentDot.point) return;
			context.save();
			context.beginPath();
			context.arc(transform.x(currentDot.point), transform.y(currentDot.point), 5, 0, Math.PI * 2);
			context.fillStyle = currentDot.color;
			context.strokeStyle = "#1e1e1e";
			context.lineWidth = 1.5;
			context.fill();
			context.stroke();
			context.restore();
		}

		function makeCanvasTransform(bounds, width, height) {
			return {
				x: point => (point.x - bounds.minX) / bounds.width * width,
				y: point => (point.y - bounds.minY) / bounds.height * height
			};
		}

		function drawMotionRows(context, rows, state, transform) {
			const buckets = new Map();

			for (const row of rows) {
				const alpha = getPlaybackRowAlpha(row, state.playback);
				if (alpha <= 0) continue;
				const color = getMotionStrokeColor(row, state.useToolColors);
				const width = (row.motionCode === 0 ? 1.1 : 1.4) * state.lineScale;
				const dash = row.motionCode === 0 ? "8,6" : "";
				const key = color + "|" + width + "|" + dash + "|" + alpha;
				const bucket = buckets.get(key) || {
					color,
					width,
					alpha,
					dash: row.motionCode === 0 ? [8, 6] : undefined,
					rows: []
				};
				bucket.rows.push(row.projectedPoints);
				buckets.set(key, bucket);
			}

			for (const bucket of buckets.values()) {
				drawPolylineBucket(context, bucket.rows, bucket, transform);
			}
		}

		function drawCycleRows(context, cycles, state, transform) {
			const buckets = new Map();

			for (const cycle of cycles) {
				const alpha = getPlaybackRowAlpha(cycle, state.playback);
				if (alpha <= 0) continue;
				const color = state.useToolColors && cycle.toolColor ? boostToolColor(cycle.toolColor) : "#4fc3ff";
				const width = 1.45 * state.lineScale;
				const key = color + "|" + width + "|" + alpha;
				const bucket = buckets.get(key) || {
					color,
					width,
					alpha,
					rows: []
				};
				bucket.rows.push(cycle.projectedPoints);
				buckets.set(key, bucket);
			}

			for (const bucket of buckets.values()) {
				drawPolylineBucket(context, bucket.rows, bucket, transform);
			}
		}

		function drawPolylineBucket(context, pointSets, style, transform) {
			context.save();
			context.globalAlpha = Number.isFinite(style.alpha) ? style.alpha : 1;
			context.beginPath();
			context.strokeStyle = style.color;
			context.lineWidth = Math.max(0.5, style.width || 1);
			context.lineCap = "round";
			context.lineJoin = "round";
			context.setLineDash(style.dash || []);

			for (const points of pointSets) {
				if (!points || points.length < 2) {
					continue;
				}

				context.moveTo(transform.x(points[0]), transform.y(points[0]));

				for (let index = 1; index < points.length; index++) {
					context.lineTo(transform.x(points[index]), transform.y(points[index]));
				}
			}

			context.stroke();
			context.restore();
		}

		function drawDirectionArrows(context, rows, state, transform) {
			const buckets = new Map();

			for (const row of rows) {
				const alpha = getPlaybackRowAlpha(row, state.playback);
				if (alpha <= 0) continue;
				const arrowSegment = makeDirectionArrowSegment(row.projectedPoints, state.endpointSize, state.arrowSize, state.unitsPerPixel);

				if (!arrowSegment) {
					continue;
				}

				const color = getDirectionStrokeColor(row, state.useToolColors);
				const width = 1.35 * state.lineScale;
				const size = Math.max(6, state.arrowSize / Math.max(state.unitsPerPixel, 0.000001));
				const key = color + "|" + width + "|" + size + "|" + alpha;
				const bucket = buckets.get(key) || {
					color,
					width,
					size,
					alpha,
					segments: []
				};
				bucket.segments.push(arrowSegment);
				buckets.set(key, bucket);
			}

			for (const bucket of buckets.values()) {
				drawArrowBucket(context, bucket, transform);
			}
		}

		function drawArrowBucket(context, bucket, transform) {
			context.save();
			context.globalAlpha = Number.isFinite(bucket.alpha) ? bucket.alpha : 1;
			context.strokeStyle = bucket.color;
			context.fillStyle = bucket.color;
			context.lineWidth = Math.max(0.5, bucket.width || 1);
			context.lineCap = "round";
			context.beginPath();

			const triangles = [];
			const size = Math.max(4, Math.min(28, bucket.size));
			const wing = size * 0.45;

			for (const segment of bucket.segments) {
				const start = {
					x: transform.x(segment.start),
					y: transform.y(segment.start)
				};
				const end = {
					x: transform.x(segment.end),
					y: transform.y(segment.end)
				};
				const dx = end.x - start.x;
				const dy = end.y - start.y;
				const length = Math.hypot(dx, dy);

				if (!Number.isFinite(length) || length <= 0) {
					continue;
				}

				const ux = dx / length;
				const uy = dy / length;
				context.moveTo(start.x, start.y);
				context.lineTo(end.x, end.y);
				triangles.push([
					end,
					{ x: end.x - ux * size - uy * wing, y: end.y - uy * size + ux * wing },
					{ x: end.x - ux * size + uy * wing, y: end.y - uy * size - ux * wing }
				]);
			}

			context.stroke();
			context.beginPath();

			for (const triangle of triangles) {
				context.moveTo(triangle[0].x, triangle[0].y);
				context.lineTo(triangle[1].x, triangle[1].y);
				context.lineTo(triangle[2].x, triangle[2].y);
				context.closePath();
			}

			context.fill();
			context.restore();
		}

		function getMotionStrokeColor(row, useToolColors) {
			if (useToolColors && row.toolColor) {
				return boostToolColor(row.toolColor);
			}

			return row.motionCode === 0 ? "#ff8800" : "#ffd500";
		}

		function getPlaybackRowAlpha(row, playbackState) {
			if (!playbackState || !Number.isFinite(row.executionIndex)) return 1;
			const motionIndex = playbackState.motionIndexByExecutionIndex.get(row.executionIndex);
			if (!Number.isFinite(motionIndex)) return 0;
			const currentMotionIndex = getCurrentPlaybackMotionIndex(playbackState);
			const age = currentMotionIndex - motionIndex;
			if (age < 0) return 0;
			if (age === 0) return 1;
			return Math.max(0.06, 1 - age / 24);
		}

		function getCurrentPlaybackMotionIndex(playbackState) {
			const indexes = playbackState.motionExecutionIndexes;
			let low = 0;
			let high = indexes.length - 1;
			let result = -1;
			while (low <= high) {
				const middle = Math.floor((low + high) / 2);
				if (indexes[middle] <= playbackState.cursor) {
					result = middle;
					low = middle + 1;
				} else {
					high = middle - 1;
				}
			}
			return result;
		}

		function getDirectionStrokeColor(row, useToolColors) {
			if (useToolColors && row.toolColor) {
				return boostToolColor(row.toolColor);
			}

			return row.motionCode === 0 ? "#ff8800" : "#ffd500";
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
			saveVisionSettings();
		});
		analysisModeSelect.addEventListener("change", () => {
			lineDataSelect.disabled = analysisModeSelect.value !== "trace";
			if (lineDataSelect.disabled) lineDataSelect.value = "source";
			vscode.postMessage({ type: "setVisionAnalysis", options: collectVisionOptions() });
		});
		liveInput.addEventListener("change", () => {
			vscode.postMessage({ type: "setVisionLive", options: collectVisionOptions() });
		});
		playbackToggle.addEventListener("click", () => {
			if (!playback || !playback.active) vscode.postMessage({ type: "startVisionPlayback" });
			else {
				setPlaybackPlaying(false);
				vscode.postMessage({ type: "stopVisionPlayback" });
			}
		});
		playbackBack.addEventListener("click", () => { if (playback && playback.active) setPlaybackCursor(playback.cursor - 1); });
		playbackForward.addEventListener("click", () => { if (playback && playback.active) setPlaybackCursor(playback.cursor + 1); });
		playbackScrubber.addEventListener("input", () => { if (playback && playback.active) setPlaybackCursor(Number(playbackScrubber.value) - 1); });
		playbackMacrosToggle.addEventListener("click", () => setPlaybackMacroDockOpen(!playbackMacroPanel.classList.contains("open")));
		playbackMacroClose.addEventListener("click", () => setPlaybackMacroDockOpen(false));
		playbackMacroSort.addEventListener("change", () => {
			playbackMacroSortMode = playbackMacroSort.value === "recent" ? "recent" : "number";
			updatePlaybackPanel();
		});
		playbackCode.addEventListener("wheel", event => {
			if (!playback || !playback.active) return;
			event.preventDefault();
			setPlaybackCursor(playback.cursor + (event.deltaY < 0 ? -1 : 1) * (event.shiftKey ? 10 : 1));
		}, { passive: false });
		playbackContext.addEventListener("click", event => {
			const line = event.target && event.target.closest ? event.target.closest("[data-source-line]") : undefined;
			if (line) vscode.postMessage({ type: "revealVisionSourceLine", lineNumber: Number(line.getAttribute("data-source-line")) });
		});
		document.addEventListener("keydown", event => {
			if (!playback || !playback.active || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(document.activeElement && document.activeElement.tagName)) return;
			const key = event.key;
			const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5, PageDown: 50, PageUp: -50 };
			if (key === " ") { event.preventDefault(); setPlaybackPlaying(!playback.playing); return; }
			if (key === "Home") { event.preventDefault(); setPlaybackCursor(0); return; }
			if (key === "End") { event.preventDefault(); setPlaybackCursor(playback.entries.length - 1); return; }
			if (Object.prototype.hasOwnProperty.call(steps, key)) { event.preventDefault(); setPlaybackCursor(playback.cursor + steps[key]); }
		});
		lineDataSelect.addEventListener("change", () => {
			projectedPlaneCache.clear();
			labelCache.clear();
			labelCacheBytes = 0;
			labelCacheRunId++;
			currentLabelEntry = undefined;
			render();
			saveVisionSettings();
		});
		labelsInput.addEventListener("change", () => { render(); saveVisionSettings(); });
		endpointsInput.addEventListener("change", () => { render(); saveVisionSettings(); });
		zeroLinesInput.addEventListener("change", () => { render(); saveVisionSettings(); });
		toolColorsInput.addEventListener("change", () => { render(); saveVisionSettings(); });
		document.querySelectorAll("[data-visibility-tool], [data-visibility-wcs]").forEach(input => input.addEventListener("change", render));
		if (tableWrap) {
			tableWrap.addEventListener("scroll", () => updateVirtualTable(false));
		}
		if (tableBody) {
			tableBody.addEventListener("click", event => {
				const row = event.target && event.target.closest ? event.target.closest("[data-playback-index]") : undefined;
				if (playback && playback.active && row) setPlaybackCursor(Number(row.getAttribute("data-playback-index")));
			});
		}
		function updateTooltip(event) {
			if (!tooltip || dragState) {
				hideTooltip();
				return;
			}

			const target = event.target && event.target.closest ? event.target.closest(".point-label-hit") : undefined;
			const hoverId = target && target.getAttribute("data-tooltip-id");
			const html = getCachedTooltipHtml(currentLabelEntry, hoverId);
			updateMarkerLegend(target);

			if (!html) {
				hideTooltipOnly();
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
			hideTooltipOnly();
			hideMarkerLegend();
		}

		function hideTooltipOnly() {
			if (tooltip) {
				tooltip.style.display = "none";
			}
		}

		function updateMarkerLegend(target) {
			if (!markerLegend) {
				return;
			}

			const keys = markerLegendToggle && markerLegendToggle.checked
				? getCompleteMarkerLegendKeys()
				: target && target.getAttribute("data-marker-keys")
				? target.getAttribute("data-marker-keys").split(",").filter(Boolean)
				: [];
			const entries = keys.map(getMarkerLegendEntry).filter(Boolean);

			if (!entries.length) {
				hideMarkerLegend();
				return;
			}

			markerLegend.innerHTML = entries.map(entry =>
				'<div class="marker-legend-row"><span class="marker-legend-swatch" style="background:' + escapeAttribute(entry.color) + '"></span><span>' + svgEscape(entry.label) + '</span></div>'
			).join("");
			markerLegend.style.display = "block";
		}

		function hideMarkerLegend() {
			if (markerLegendToggle && markerLegendToggle.checked) {
				updateMarkerLegend();
				return;
			}

			if (markerLegend) {
				markerLegend.style.display = "none";
			}
		}

		function getCompleteMarkerLegendKeys() {
			return ["programEnd", "optionalStop", "playbackRapid", "playbackCut", "tool", "playbackMacro", "playbackM", "speedChange", "compensation", "compensationCancel", "playbackFlow"];
		}

		function getMarkerLegendEntry(key) {
			const entries = {
				programEnd: { color: "#7f1d1d", label: "Program end" },
				optionalStop: { color: "#dcdc6b", label: "M00 / M01 stop" },
				playbackRapid: { color: "#ff8800", label: "Current G00 rapid" },
				playbackCut: { color: "#ffd500", label: "Current G01/G02/G03 cut" },
				speedChange: { color: "#ff2b2b", label: "Spindle speed change" },
				tool: { color: "#88ff00", label: "Tool change" },
				playbackMacro: { color: "#eb17e4", label: "Current macro maths" },
				playbackM: { color: "#9CDCFE", label: "Current M command" },
				compensation: { color: "#1f7a3a", label: "Compensation on" },
				compensationCancel: { color: "#8e44ad", label: "Compensation off" },
				playbackFlow: { color: "#2F6DA5", label: "Current flow / modal" }
			};

			return entries[key];
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
		markerLegendToggle.addEventListener("change", () => { updateMarkerLegend(); saveVisionSettings(); });
		viewToggle.addEventListener("click", () => viewPanel.classList.toggle("open"));
		dataToggle.addEventListener("click", () => dataPanel.classList.toggle("open"));
		offsetsToggle.addEventListener("click", () => {
			offsetPanel.classList.toggle("open");
		});
		visibilityToggle.addEventListener("click", () => {
			visibilityPanel.classList.toggle("open");
		});
		macrosToggle.addEventListener("click", () => macroPanel.classList.toggle("open"));
		overrideProgramInitialValues.addEventListener("change", () => {
			document.querySelectorAll("[data-macro-initialized='true']").forEach(row => row.hidden = !overrideProgramInitialValues.checked);
			saveVisionSettings();
		});
		document.getElementById("saveMacroInputs").addEventListener("click", () => {
			vscode.postMessage({ type: "saveMacroInputs", macroInputs: collectMacroInputs(), overrideProgramInitialValues: overrideProgramInitialValues.checked, options: collectVisionOptions() });
		});
		document.getElementById("resetMacroInputs").addEventListener("click", () => {
			vscode.postMessage({ type: "resetMacroInputs", options: collectVisionOptions() });
		});
		document.getElementById("saveOffsets").addEventListener("click", () => {
			vscode.postMessage({ type: "saveOffsets", offsets: collectWorkOffsets(), options: collectVisionOptions() });
		});
		document.getElementById("resetOffsets").addEventListener("click", () => {
			vscode.postMessage({ type: "resetOffsets", options: collectVisionOptions() });
		});
		window.addEventListener("resize", render);
		window.addEventListener("message", event => {
			const message = event.data;
			if (!message || message.type !== "liveTraceWarning") return;
			const warning = String(message.warning || "");
			const liveWarning = document.getElementById("liveWarning");
			if (!warning || !liveWarning) return;
			liveWarning.textContent = "⚠ LIVE WARNING";
			liveWarning.title = warning;
			liveWarning.hidden = false;
		});

		if (data.playback && data.playback.autoStart) startPlayback();
		else render();
	</script>
</body>
</html>`;
}

function renderVisionOffsetPanel(workOffsets) {
	const rows = VISION_WORK_OFFSET_CODES.map(code => {
		const offset = workOffsets && workOffsets[code] ? workOffsets[code] : {};

		return `<tr data-offset-code="${escapeAttribute(code)}">
			<td><code>${escapeHtml(code)}</code></td>
			<td><input data-offset-enabled type="checkbox"${offset.enabled ? " checked" : ""}></td>
			<td><input data-offset-axis="x" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(offset.x))}"></td>
			<td><input data-offset-axis="y" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(offset.y))}"></td>
			<td><input data-offset-axis="z" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(offset.z))}"></td>
			<td><input data-offset-note type="text" value="${escapeAttribute(offset.note || "")}"></td>
		</tr>`;
	}).join("");

	return `<section id="offsetPanel" class="offset-panel">
		<table>
			<thead>
				<tr>
					<th>WCS</th>
					<th>On</th>
					<th>X</th>
					<th>Y</th>
					<th>Z</th>
					<th>Note</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
		<div class="offset-actions"><button id="saveOffsets">Apply</button><button id="resetOffsets">Reset to defaults</button></div>
	</section>`;
}

function renderVisionViewPanel(options) {
	return `<section id="viewPanel" class="control-panel">
		<div class="visibility-options">
			<label class="checkbox"><input id="labels" type="checkbox"${options.showLabels ? " checked" : ""}> Labels</label>
			<label class="checkbox"><input id="endpoints" type="checkbox"${options.showEndpoints ? " checked" : ""}> Endpoints</label>
			<label class="checkbox"><input id="zeroLines" type="checkbox"${options.showZeroLines ? " checked" : ""}> Zero lines</label>
			<label class="checkbox"><input id="toolColors" type="checkbox"${options.useToolColors ? " checked" : ""}> Tool colors</label>
			<label class="checkbox"><input id="markerLegendToggle" type="checkbox"${options.showMarkerLegend ? " checked" : ""}> Legend</label>
			<button id="visibilityToggle">Visibility</button>
		</div>
	</section>`;
}

function renderVisionDataPanel() {
	return `<section id="dataPanel" class="control-panel"><div class="offset-actions">
		<button id="offsetsToggle">Offsets</button><button id="macrosToggle">Macro values</button>
	</div></section>`;
}

function formatOffsetInputValue(value) {
	return Number.isFinite(value) ? String(value) : "0";
}
function renderVisionVisibilityPanel(rows) {
	const toolEntries = getVisibilityEntries(rows, getVisionToolKey, getVisionToolLabel);
	const wcsEntries = getVisibilityEntries(rows, getVisionWcsKey, getVisionWcsLabel);

	return `<section id="visibilityPanel" class="visibility-panel">
		<div class="visibility-groups">
			${renderVisibilityGroup("Tools", toolEntries, "tool")}
			${renderVisibilityGroup("WCS", wcsEntries, "wcs")}
		</div>
	</section>`;
}

function renderVisionMacroPanel(macros, savedInputs, overrideProgramInitialValues) {
	const rows = macros.map(entry => {
		const saved = savedInputs[entry.macro];
		const value = saved && Number.isFinite(Number(saved.value)) ? String(saved.value) : "";
		const hidden = entry.initialized && !overrideProgramInitialValues ? " hidden" : "";
		return `<tr data-macro-initialized="${entry.initialized ? "true" : "false"}"${hidden}>
			<td><code>${escapeHtml(entry.label)}</code>${entry.label !== entry.macro ? ` <span class="note">${escapeHtml(entry.macro)}</span>` : ""}</td>
			<td>${entry.initialized ? "Program initial value" : "No initial value"}</td>
			<td><input data-macro-value="${escapeAttribute(entry.macro)}" type="number" step="any" value="${escapeAttribute(value)}"></td>
		</tr>`;
	}).join("");
	return `<section id="macroPanel" class="macro-panel">
		<div class="offset-actions"><button id="saveMacroInputs">Apply</button><button id="resetMacroInputs">Reset to defaults</button><label class="checkbox" title="Values replace header macro initialisations before the first executable G/M block. With override off, only macros without an initial value are shown."><input id="overrideProgramInitialValues" type="checkbox"${overrideProgramInitialValues ? " checked" : ""}> Override program initial values</label></div>
		<table><thead><tr><th>Macro</th><th>Program state</th><th>Initial value</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="note">No macro variables in this program.</td></tr>'}</tbody></table>
	</section>`;
}

function renderVisibilityGroup(title, entries, kind) {
	const options = entries.map(entry => `<label class="checkbox"><input data-visibility-${kind} type="checkbox" value="${escapeAttribute(entry.key)}" checked> ${escapeHtml(entry.label)}</label>`).join("");

	return `<div>
		<div class="visibility-group-title">${escapeHtml(title)}</div>
		<div class="visibility-options">${options || "<span class=\"note\">None</span>"}</div>
	</div>`;
}

function getVisibilityEntries(rows, getKey, getLabel) {
	const entries = new Map();

	for (const row of rows) {
		if (!row || row.type === "label") {
			continue;
		}

		const key = getKey(row);

		if (!entries.has(key)) {
			entries.set(key, {
				key,
				label: getLabel(row)
			});
		}
	}

	return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function getVisionToolKey(row) {
	return row && row.tool ? row.tool : "__none";
}

function getVisionToolLabel(row) {
	return row && row.tool ? row.tool : "No tool";
}

function getVisionWcsKey(row) {
	if (row && row.instruction && row.instruction.startsWith("G53")) {
		return "G53";
	}

	if (row && row.coordinateSystem) {
		return row.coordinateSystem;
	}

	return "__none";
}

function getVisionWcsLabel(row) {
	const key = getVisionWcsKey(row);

	return key === "__none" ? "No WCS" : key;
}
function renderRows(rows, humanFormat) {
	if (!rows.length) {
		return "<p class=\"empty\">No motion rows found.</p>";
	}

	return `<div id="visionTableWrap" class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="tool-marker-header"></th>
					<th class="tool-marker-gap"></th>
					<th>Line</th>
					<th>Move</th>
					<th>WCS</th>
					<th>Start</th>
					<th>End</th>
					<th>Distance</th>
					<th>Notes</th>
				</tr>
			</thead>
			<tbody id="visionTableBody"></tbody>
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
