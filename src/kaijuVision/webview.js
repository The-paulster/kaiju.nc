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
	VISION_COORDINATE_FRAME_CODES,
	getVisionOptions,
	normalizeVisionInitialPosition,
	normalizeVisionReferenceFrame,
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
				await saveOffsetsFromWebview(message.offsets, message.referenceFrame, message.options || {});
				return;
			}
			if (message.type === "previewOffsets") {
				await previewOffsetsFromWebview(message.offsets, message.referenceFrame, message.options || {});
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

async function saveOffsetsFromWebview(offsets, referenceFrame, rawOptions) {
	const editor = getVisionSourceEditor();

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Focus a G-code document before saving Vision offsets.");
		return;
	}

	const normalizedOffsets = normalizeVisionWorkOffsets(offsets);
	const normalizedReferenceFrame = normalizeVisionReferenceFrame(referenceFrame);
	await saveDocumentVisionWorkOffsets(editor.document, normalizedOffsets);
	await saveDocumentVisionReferenceFrame(editor.document, normalizedReferenceFrame);
	await saveDocumentVisionSettings(editor.document, rawOptions);

	const options = makeVisionOptions(editor.document, Object.assign({}, rawOptions, {
		workOffsets: normalizedOffsets,
		referenceFrame: normalizedReferenceFrame
	}));
	const mode = visionState && visionState.mode ? visionState.mode : "whole";

	visionState = {
		documentUriText: editor.document.uri.toString(),
		mode,
		options
	};

	await renderVisionPanel(editor, mode, options);
}

async function previewOffsetsFromWebview(offsets, referenceFrame, rawOptions) {
	const editor = getVisionSourceEditor();

	if (!editor || editor.document.languageId !== "gcode") return;
	const options = makeVisionOptions(editor.document, Object.assign({}, rawOptions, {
		workOffsets: normalizeVisionWorkOffsets(offsets),
		referenceFrame: normalizeVisionReferenceFrame(referenceFrame)
	}));
	options.offsetPanelOpen = true;
	const mode = visionState && visionState.mode ? visionState.mode : "whole";
	visionState = { documentUriText: editor.document.uri.toString(), mode, options };
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
	const allReferenceFrames = getStoredVisionReferenceFrames();
	delete allReferenceFrames[documentKey];
	await visionContext.workspaceState.update("kaijuVision.referenceFramesByDocument", allReferenceFrames);

	const settings = Object.assign({}, getDocumentVisionSettings(editor.document), rawOptions);
	delete settings.workOffsets;
	delete settings.referenceFrame;
	delete settings.initialPosition;
	await saveDocumentVisionSettings(editor.document, settings);
	const options = makeVisionOptions(editor.document, settings);
	const mode = visionState && visionState.mode ? visionState.mode : "whole";
	visionState = { documentUriText: editor.document.uri.toString(), mode, options };
	await renderVisionPanel(editor, mode, options);
}

function makeVisionOptions(document, rawOptions = {}) {
	const savedOffsets = getDocumentVisionWorkOffsets(document);
	const savedReferenceFrame = getDocumentVisionReferenceFrame(document);
	const savedSettings = getDocumentVisionSettings(document);
	const options = getVisionOptions(document, Object.assign({}, savedSettings, rawOptions, {
		workOffsets: rawOptions.workOffsets || savedOffsets,
		referenceFrame: rawOptions.referenceFrame || savedReferenceFrame
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
		initialPosition: normalizeVisionInitialPosition(value.initialPosition),
		showLabels: value.showLabels !== false,
		showEndpoints: value.showEndpoints !== false,
		showZeroLines: value.showZeroLines === true,
		showGrid: value.showGrid === true,
		gridSize: normalizeVisionGridSize(value.gridSize),
		showMarkerLegend: value.showMarkerLegend === true,
		overrideProgramInitialValues: value.overrideProgramInitialValues === true,
		live: value.live === true
	};
}

function normalizeVisionGridSize(value) {
	const size = Number(value);
	return Number.isFinite(size) && size > 0 ? Math.max(0.001, Math.min(size, 1000000)) : 10;
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

function getDocumentVisionReferenceFrame(document) {
	const allFrames = getStoredVisionReferenceFrames();
	const documentKey = getVisionDocumentKey(document);

	return documentKey ? allFrames[documentKey] : undefined;
}

async function saveDocumentVisionReferenceFrame(document, referenceFrame) {
	if (!visionContext || !visionContext.workspaceState) return;
	const documentKey = getVisionDocumentKey(document);
	const allFrames = getStoredVisionReferenceFrames();

	if (documentKey) {
		allFrames[documentKey] = normalizeVisionReferenceFrame(referenceFrame);
		await visionContext.workspaceState.update("kaijuVision.referenceFramesByDocument", allFrames);
	}
}

function getStoredVisionReferenceFrames() {
	return visionContext && visionContext.workspaceState
		? Object.assign({}, visionContext.workspaceState.get("kaijuVision.referenceFramesByDocument", {}))
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
		z: /Z(?=[-+#.\d\[])/i,
		c: /C(?=[-+#.\d\[])/i
	};

	for (const axis of ["x", "y", "z", "c"]) {
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
	const nonce = makeWebviewNonce();
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
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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

		.offset-panel input[type="number"]:disabled {
			color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
			background: var(--vscode-input-background);
			opacity: 0.55;
		}

		.offset-actions {
			display: flex;
			gap: 8px;
			margin-top: 8px;
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

		.view-panel-section + .view-panel-section {
			border-top: 1px solid var(--vscode-panel-border);
			margin-top: 10px;
			padding-top: 10px;
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
		}

		.grid-size {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}

		.grid-size input {
			width: 7ch;
			box-sizing: border-box;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			padding: 2px 4px;
			font: inherit;
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

		.viewer-grid {
			width: 100%;
			height: 100%;
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
		}

		.viewer-slot.dual-view .viewer-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 1px;
			background: var(--vscode-panel-border, #3c3c3c);
		}

		.secondary-viewer[hidden],
		.plane-control[hidden],
		.shared-axis-control[hidden] { display: none !important; }

		.viewer-slot.dual-view .viewer {
			background: var(--vscode-editor-background);
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

		.vision-tooltip.pinned {
			max-height: min(55vh, 390px);
			min-width: min(260px, 62vw);
			pointer-events: auto;
			overflow: hidden;
		}

		.pinned-tooltip-title {
			color: var(--vscode-descriptionForeground, #9ca3af);
			font: 600 11px var(--vscode-font-family, sans-serif);
			letter-spacing: .03em;
			margin: 0 0 6px;
		}

		.pinned-tooltip-list {
			max-height: min(45vh, 320px);
			overflow-y: auto;
			padding-right: 6px;
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
		.axis-c { color: #C678DD; }
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
		<label id="planeControl" class="plane-control">Plane
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
		<button id="dualViewToggle" type="button" aria-pressed="false" title="Toggle a synchronized second projection">Dual View</button>
		<label id="sharedAxisControl" class="shared-axis-control" hidden>Shared axis
			<select id="sharedAxis">
				<option value="x">X</option>
				<option value="y">Y</option>
				<option value="z">Z</option>
			</select>
		</label>
		<button id="offsetsToggle">Offsets</button>
		<button id="macrosToggle">Macro</button>
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

	${renderVisionViewPanel(options, result.rows)}
	${renderVisionOffsetPanel(options.workOffsets, options.referenceFrame, options.initialPosition, options.offsetPanelOpen)}
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
		<div id="viewerGrid" class="viewer-grid">
			<div id="viewer" class="viewer" data-view-key="primary"></div>
			<div id="secondaryViewer" class="viewer secondary-viewer" data-view-key="secondary" hidden></div>
		</div>
		<div id="visionTooltip" class="vision-tooltip"></div>
		<div id="markerLegend" class="vision-marker-legend"></div>
		<div id="playbackPositionReadout" class="playback-position-readout" aria-live="polite"></div>
	</div>
	${renderRows(result.rows, options.humanFormat)}

	<script nonce="${nonce}" type="application/json" id="vision-data">${escapeScriptJson(payload)}</script>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const data = JSON.parse(document.getElementById("vision-data").textContent);
		const savedWebviewState = vscode.getState() || {};
		const savedViewport = savedWebviewState.viewport && (savedWebviewState.dualView === true || savedWebviewState.viewport.plane === data.options.plane)
			? savedWebviewState.viewport
			: undefined;
		const planeSelect = document.getElementById("plane");
		const planeControl = document.getElementById("planeControl");
		const dualViewToggle = document.getElementById("dualViewToggle");
		const sharedAxisControl = document.getElementById("sharedAxisControl");
		const sharedAxisSelect = document.getElementById("sharedAxis");
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
		const gridInput = document.getElementById("grid");
		const gridSizeInput = document.getElementById("gridSize");
		const toolColorsInput = document.getElementById("toolColors");
		const markerLegendToggle = document.getElementById("markerLegendToggle");
		const viewToggle = document.getElementById("viewToggle");
		const viewPanel = document.getElementById("viewPanel");
		const offsetsToggle = document.getElementById("offsetsToggle");
		const offsetPanel = document.getElementById("offsetPanel");
		const macrosToggle = document.getElementById("macrosToggle");
		const macroPanel = document.getElementById("macroPanel");
		const overrideProgramInitialValues = document.getElementById("overrideProgramInitialValues");
		const viewerSlot = document.getElementById("viewerSlot");
		const viewerGrid = document.getElementById("viewerGrid");
		const viewer = document.getElementById("viewer");
		const secondaryViewer = document.getElementById("secondaryViewer");
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
		const prewarmJobs = new Map();
		let zoom = savedViewport && Number.isFinite(Number(savedViewport.zoom)) ? Math.max(1, Number(savedViewport.zoom)) : 1;
		const hasSavedWorldPan = savedWebviewState.worldPan
			&& ["x", "y", "z"].every(axis => Number.isFinite(Number(savedWebviewState.worldPan[axis])))
		let worldPan = hasSavedWorldPan
			? { x: Number(savedWebviewState.worldPan.x), y: Number(savedWebviewState.worldPan.y), z: Number(savedWebviewState.worldPan.z) }
			: { x: 0, y: 0, z: 0 };
		let dualView = savedWebviewState.dualView === true;
		let sharedAxis = ["x", "y", "z"].includes(savedWebviewState.sharedAxis)
			? savedWebviewState.sharedAxis
			: "";
		zoomLabel.textContent = Math.round(zoom * 100) + "%";
		let currentFitBounds;
		let currentBounds;
		const viewStateByKey = new Map();
		const currentLabelEntryByViewer = new WeakMap();
		let currentTableRows = [];
		let currentTableVisibilityKey = "";
		let currentLabelEntry;
		const projectedPlaneCache = new Map();
		const visibleSceneCache = new WeakMap();
		const playbackProjectionIndexes = new WeakMap();
		const canvasSceneKeys = new WeakMap();
		const webglRenderers = new WeakMap();
		const toolColorCache = new Map();
		const arrowGeometryCache = new WeakMap();
		let pathChunkCache = new WeakMap();
		let pathChunkBytes = 0;
		const pathChunkLimitBytes = 16 * 1024 * 1024;
		let renderPending = false;
		let dualFitUnitsPerPixel;
		let dragState;
		let pinnedTooltip;
		let playbackMacroSortMode = "number";

		function saveViewport() {
			vscode.setState(Object.assign({}, vscode.getState() || {}, {
				viewport: { plane: getPrimaryPlaneKey(), zoom, pan: getProjectedPan(planes[getPrimaryPlaneKey()] || planes.xz) },
				worldPan: { x: worldPan.x, y: worldPan.y, z: worldPan.z },
				dualView,
				sharedAxis
			}));
		}
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
		if (!hasSavedWorldPan && savedViewport && savedViewport.pan
			&& Number.isFinite(Number(savedViewport.pan.x)) && Number.isFinite(Number(savedViewport.pan.y))) {
			const savedPlane = planes[savedViewport.plane] || planes.xz;
			worldPan[savedPlane.h] = Number(savedViewport.pan.x) / savedPlane.hSign;
			worldPan[savedPlane.v] = -Number(savedViewport.pan.y) / savedPlane.vSign;
		}

		function getSharedAxisForPlane(planeKey) {
			return planes[planeKey] ? planes[planeKey].h : "x";
		}

		function getDualPlanePair(axis) {
			if (axis === "y") return ["yx", "yz"];
			if (axis === "z") return ["zx", "zy"];
			return ["xy", "xz"];
		}

		function getPrimaryPlaneKey() {
			return dualView ? getDualPlanePair(sharedAxis)[0] : planeSelect.value;
		}

		function getSecondaryPlaneKey() {
			return getDualPlanePair(sharedAxis)[1];
		}

		function updateDualViewControls() {
			planeControl.hidden = dualView;
			sharedAxisControl.hidden = !dualView;
			sharedAxisSelect.value = sharedAxis;
			viewerSlot.classList.toggle("dual-view", dualView);
			secondaryViewer.hidden = !dualView;
			dualViewToggle.setAttribute("aria-pressed", String(dualView));
			dualViewToggle.textContent = dualView ? "Single View" : "Dual View";
		}

		function getProjectedPan(plane, sourceWorldPan = worldPan) {
			return {
				x: (sourceWorldPan[plane.h] || 0) * plane.hSign,
				y: -(sourceWorldPan[plane.v] || 0) * plane.vSign
			};
		}

		function getWorldPanForProjectedPan(plane, projectedPan, baseWorldPan = worldPan) {
			const next = Object.assign({}, baseWorldPan || worldPan);
			next[plane.h] = projectedPan.x / plane.hSign;
			next[plane.v] = -projectedPan.y / plane.vSign;
			return next;
		}

		function setProjectedPan(plane, projectedPan, baseWorldPan) {
			worldPan = getWorldPanForProjectedPan(plane, projectedPan, baseWorldPan);
		}

		if (!sharedAxis) sharedAxis = getSharedAxisForPlane(planeSelect.value);
		updateDualViewControls();


		function collectVisionOptions() {
			return {
				analysisMode: analysisModeSelect.value,
				showTraceLine: lineDataSelect.value === "trace",
				plane: planeSelect.value,
				useToolColors: toolColorsInput.checked,
				workOffsets: collectWorkOffsets(),
				referenceFrame: collectReferenceFrame(),
				initialPosition: collectInitialPosition(),
				showLabels: labelsInput.checked,
				showEndpoints: endpointsInput.checked,
				showZeroLines: zeroLinesInput.checked,
				showGrid: gridInput.checked,
				gridSize: gridSizeInput.value,
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
					showZeroLines: row.querySelector("[data-offset-zero]").checked,
					x: Number(row.querySelector("[data-offset-axis='x']").value) || 0,
					y: Number(row.querySelector("[data-offset-axis='y']").value) || 0,
					z: Number(row.querySelector("[data-offset-axis='z']").value) || 0,
					note: row.querySelector("[data-offset-note]").value || ""
				};
			});

			return offsets;
		}

		function collectReferenceFrame() {
			const selected = document.querySelector("[data-offset-reference]:checked");
			return selected ? selected.value : "G53";
		}

		function collectInitialPosition() {
			return {
				coordinateSystem: document.querySelector("[data-start-frame]").value,
				x: Number(document.querySelector("[data-start-axis='x']").value) || 0,
				y: Number(document.querySelector("[data-start-axis='y']").value) || 0,
				z: Number(document.querySelector("[data-start-axis='z']").value) || 0
			};
		}

		function previewOffsets() {
			vscode.postMessage({ type: "previewOffsets", offsets: collectWorkOffsets(), referenceFrame: collectReferenceFrame(), options: collectVisionOptions() });
		}

		function selectOffsetReference(referenceInput) {
			const selectedRow = referenceInput.closest("[data-offset-code]");
			if (!selectedRow) return;
			const pivot = {};
			for (const axis of ["x", "y", "z", "c"]) {
				pivot[axis] = Number(selectedRow.querySelector("[data-offset-axis='" + axis + "']").value) || 0;
			}
			document.querySelectorAll("[data-offset-code]").forEach(row => {
				for (const axis of ["x", "y", "z"]) {
					const input = row.querySelector("[data-offset-axis='" + axis + "']");
					input.value = String((Number(input.value) || 0) - pivot[axis]);
					input.disabled = row === selectedRow;
				}
			});
			previewOffsets();
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
						projected.cycles.push(Object.assign(Object.create(row), {
							projectedPoints: points,
							projectedPoint,
							projectedBounds: makePointSetBounds(points.length ? points : [projectedPoint]),
							labelCoordinateLine: makeVisiblePositionLine(row.end, data.options.humanFormat),
							labelHoverHtml: { row, position: row.end }
						}));
					}
				} else if (row.type === "tool") {
					const projectedPoint = project(row.point || {}, plane);

					if (projectedPoint) {
						projected.toolChanges.push(Object.assign(Object.create(row), {
							projectedPoint,
							labelCoordinateLine: makePlaneCoordinateLine(row.position || row.point, plane, data.options.humanFormat, data.options.trimLabelTrailingZeros !== false),
							labelHoverHtml: { row, tool: true }
						}));
					}
				} else if (row.type === "event") {
					const projectedPoint = project(row.point || {}, plane);

					if (projectedPoint) {
						projected.events.push(Object.assign(Object.create(row), {
							projectedPoint,
							labelCoordinateLine: makePlaneCoordinateLine(row.position || row.point, plane, data.options.humanFormat, data.options.trimLabelTrailingZeros !== false),
							labelHoverHtml: { row, position: row.position || row.point }
						}));
					}
				} else if (row.type !== "label") {
					const points = (row.points || [])
						.map(point => project(point, plane))
						.filter(Boolean);
					const end = points[points.length - 1];

					if (points.length >= 2) {
						projected.rows.push(Object.assign(Object.create(row), {
							projectedPoints: points,
							projectedEnd: end,
							projectedBounds: makePointSetBounds(points),
							startCoordinateLine: makeVisiblePositionLine(row.start, data.options.humanFormat),
							startHoverHtml: { row, position: row.start, start: true },
							endCoordinateLine: makeVisiblePositionLine(row.end, data.options.humanFormat),
							endHoverHtml: { row, position: row.end }
						}));
					}
				}
			}

			projectedPlaneCache.set(planeKey, projected);
			return projected;
		}

		function getVisibleProjectedData(projected, visibility) {
			const key = getVisibilityKey(visibility);
			const cached = visibleSceneCache.get(projected);
			if (cached && cached.key === key) return cached;
			const visible = {
				key,
				rows: projected.rows.filter(row => isRowVisible(row, visibility)),
				cycles: projected.cycles.filter(row => isRowVisible(row, visibility)),
				toolChanges: projected.toolChanges.filter(row => isRowVisible(row, visibility)),
				events: projected.events.filter(row => isRowVisible(row, visibility))
			};
			visible.bounds = makeBounds(visible.rows, visible.cycles, visible.toolChanges, visible.events);
			try {
				visible.rowIndex = buildPathIndex(visible.rows);
				visible.cycleIndex = buildPathIndex(visible.cycles);
			} catch (error) {
				// Keep Vision usable and expose the original failure in Developer Tools.
				// queryPathIndex recognises these row-only fallback nodes.
				console.error("KAIJU Vision spatial index build failed; using the safe linear fallback.", error);
				visible.rowIndex = { rows: visible.rows };
				visible.cycleIndex = { rows: visible.cycles };
			}
			visibleSceneCache.set(projected, visible);
			return visible;
		}

		// A packed R-tree groups neighbouring path bounds rather than adjacent source
		// rows. Entries retain their original index and are re-sorted before drawing,
		// preserving the authored paint order after a spatial query.
		function buildPathIndex(rows) {
			if (!rows.length) return undefined;
			const maxChildren = 32;
			const entries = rows.map((row, index) => ({ row, index, bounds: row.projectedBounds }));
			const hasUsableBounds = entry => entry.bounds && ["minX", "minY", "maxX", "maxY"].every(key => Number.isFinite(entry.bounds[key]));
			const boundedEntries = entries.filter(hasUsableBounds);
			const unboundedEntries = entries.filter(entry => !hasUsableBounds(entry));

			const makeBounds = items => {
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				for (const item of items) {
					const itemBounds = item.bounds;
					minX = Math.min(minX, itemBounds.minX); minY = Math.min(minY, itemBounds.minY);
					maxX = Math.max(maxX, itemBounds.maxX); maxY = Math.max(maxY, itemBounds.maxY);
				}
				return { minX, minY, maxX, maxY };
			};
			const centre = (item, axis) => (item.bounds["min" + axis] + item.bounds["max" + axis]) / 2;
			const packLevel = (items, leaf) => {
				if (!items.length) return [];
				const nodeCount = Math.ceil(items.length / maxChildren);
				const sliceCount = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
				const sliceSize = Math.ceil(items.length / sliceCount);
				const xSorted = items.slice().sort((left, right) => centre(left, "X") - centre(right, "X"));
				const packed = [];

				for (let sliceStart = 0; sliceStart < xSorted.length; sliceStart += sliceSize) {
					const slice = xSorted.slice(sliceStart, sliceStart + sliceSize)
						.sort((left, right) => centre(left, "Y") - centre(right, "Y"));
					for (let start = 0; start < slice.length; start += maxChildren) {
						const children = slice.slice(start, start + maxChildren);
						packed.push(leaf
							? { entries: children, bounds: makeBounds(children) }
							: { children, bounds: makeBounds(children) });
					}
				}
				return packed;
			};

			let level = packLevel(boundedEntries, true);
			while (level.length > 1) level = packLevel(level, false);
			const tree = level[0];
			return { rows, tree, unboundedEntries, bounds: tree && tree.bounds };
		}

		function queryPathIndex(node, bounds, result = []) {
			if (!node) return result;
			try {
				const maxX = bounds.minX + bounds.width;
				const maxY = bounds.minY + bounds.height;
				const containsTree = node.bounds
					&& bounds.minX <= node.bounds.minX && maxX >= node.bounds.maxX
					&& bounds.minY <= node.bounds.minY && maxY >= node.bounds.maxY;
				if (containsTree) {
					result.push(...node.rows);
					return result;
				}

				const matches = node.unboundedEntries.slice();
				const visit = current => {
					if (!current || !rowBoundsIntersect(current.bounds, bounds)) return;
					if (current.entries) {
						for (const entry of current.entries) {
							if (rowBoundsIntersect(entry.bounds, bounds)) matches.push(entry);
						}
						return;
					}
					for (const child of current.children) visit(child);
				};
				visit(node.tree);
				matches.sort((left, right) => left.index - right.index);
				result.push(...matches.map(entry => entry.row));
				return result;
			} catch (error) {
				console.error("KAIJU Vision spatial index query failed; using the safe linear fallback.", error);
				for (const row of node.rows || []) {
					if (rowBoundsIntersect(row.projectedBounds, bounds)) result.push(row);
				}
				return result;
			}
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

		function getFitHeight(bounds, viewportAspect = 1) {
			const aspect = Math.max(0.000001, Number(viewportAspect) || 1);
			return Math.max(bounds.height, bounds.width / aspect);
		}

		function getDualViewFitHeight(viewportAspect = 1) {
			const visibility = getVisibilityState();
			return getDualPlanePair(sharedAxis).reduce((largestFitHeight, planeKey) => {
				const projected = getProjectedPlaneData(planeKey, planes[planeKey] || planes.xz);
				const visible = getVisibleProjectedData(projected, visibility);
				return Math.max(largestFitHeight, getFitHeight(visible.bounds, viewportAspect));
			}, 0);
		}

		function getZoomFitHeight(bounds, viewportAspect = 1) {
			return dualView ? getDualViewFitHeight(viewportAspect) : getFitHeight(bounds, viewportAspect);
		}

		function zoomBounds(bounds, viewportAspect = 1, plane = planes[getPrimaryPlaneKey()] || planes.xz, fitHeight = getZoomFitHeight(bounds, viewportAspect)) {
			const centerX = bounds.minX + bounds.width / 2;
			const centerY = bounds.minY + bounds.height / 2;
			const aspect = Math.max(0.000001, Number(viewportAspect) || 1);
			const fitWidth = fitHeight * aspect;
			const width = fitWidth / zoom;
			const height = fitHeight / zoom;
			const pan = getProjectedPan(plane);

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

		function setZoom(nextZoom, event, viewKey = "primary") {
			const state = viewStateByKey.get(viewKey);
			const targetViewer = viewKey === "secondary" ? secondaryViewer : viewer;
			const planeKey = viewKey === "secondary" ? getSecondaryPlaneKey() : getPrimaryPlaneKey();
			const plane = planes[planeKey] || planes.xz;
			if (!state || !state.fitBounds) {
				zoom = Math.max(1, nextZoom);
				zoomLabel.textContent = Math.round(zoom * 100) + "%";
				saveViewport();
				render();
				return;
			}

			const rect = targetViewer.getBoundingClientRect();
			const viewportAspect = Math.max(1, rect.width) / Math.max(1, rect.height);
			const fitHeight = state.fitHeight || getZoomFitHeight(state.fitBounds, viewportAspect);
			const oldBounds = zoomBounds(state.fitBounds, viewportAspect, plane, fitHeight);
			const oldZoom = zoom;
			zoom = Math.max(1, nextZoom);

			if (event && oldZoom !== zoom) {
				const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
				const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
				const anchorX = oldBounds.minX + ratioX * oldBounds.width;
				const anchorY = oldBounds.minY + ratioY * oldBounds.height;
				const fitWidth = fitHeight * viewportAspect;
				const newWidth = fitWidth / zoom;
				const newHeight = fitHeight / zoom;
				const newMinX = anchorX - ratioX * newWidth;
				const newMinY = anchorY - ratioY * newHeight;
				const fitCenterX = state.fitBounds.minX + state.fitBounds.width / 2;
				const fitCenterY = state.fitBounds.minY + state.fitBounds.height / 2;
				setProjectedPan(plane, {
					x: newMinX + newWidth / 2 - fitCenterX,
					y: newMinY + newHeight / 2 - fitCenterY
				});
			}

			zoomLabel.textContent = Math.round(zoom * 100) + "%";
			saveViewport();
			render();
		}

		function resetView() {
			zoom = 1;
			worldPan = { x: 0, y: 0, z: 0 };
			zoomLabel.textContent = "100%";
			saveViewport();
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
			viewerGrid.style.width = Math.max(1, Math.floor(rect.width)) + "px";
			viewerGrid.style.height = Math.max(1, Math.floor(rect.height)) + "px";
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
			if (cursor === playback.restoredCursor + 1) {
				applyPlaybackChanges(playback.macroValues, playback.entries[cursor].macroChanges);
				applyPlaybackDisplayPrecisionChanges(playback.macroDisplayPrecisions, playback.entries[cursor].macroDisplayPrecisionChanges);
				playback.restoredCursor = cursor;
				return;
			}
			playback.restoredCursor = cursor;
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
			if (!playbackMacroPanel.classList.contains("open")) return;
			const aliases = new Map((data.macroVariables || []).map(variable => [variable.macro, variable.label]));
			const macroLastUpdates = playbackMacroSortMode === "recent" ? getPlaybackMacroLastUpdates() : new Map();
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
			if (!playback.macroUpdateIndexes) {
				playback.macroUpdateIndexes = new Map();
				playback.entries.forEach((entry, index) => {
					for (const change of entry.macroChanges || []) {
						if (!playback.macroUpdateIndexes.has(change.macro)) playback.macroUpdateIndexes.set(change.macro, []);
						playback.macroUpdateIndexes.get(change.macro).push(index);
					}
				});
			}
			const lastUpdates = new Map();
			for (const [macro, indexes] of playback.macroUpdateIndexes) {
				let low = 0, high = indexes.length;
				while (low < high) {
					const middle = (low + high) >>> 1;
					if (indexes[middle] <= playback.cursor) low = middle + 1; else high = middle;
				}
				if (low) lastUpdates.set(macro, indexes[low - 1]);
			}
			return lastUpdates;
		}

		function setPlaybackMacroDockOpen(isOpen) {
			playbackMacroPanel.classList.toggle("open", isOpen);
			document.body.classList.toggle("playback-macros-open", isOpen);
			playbackMacrosToggle.setAttribute("aria-expanded", String(isOpen));
			if (isOpen) updatePlaybackPanel();
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
			if (renderPending) return;
			renderPending = true;
			window.requestAnimationFrame(() => {
				renderPending = false;
				renderFrame();
			});
		}

		function renderFrame() {
			if (playback && playback.active) playback.currentMotionIndex = getCurrentPlaybackMotionIndex(playback);
			sizeViewer();
			dualFitUnitsPerPixel = undefined;
			if (dualView) {
				const visibility = getVisibilityState();
				dualFitUnitsPerPixel = Math.max(...getDualPlanePair(sharedAxis).map((planeKey, i) => {
					const rect = (i ? secondaryViewer : viewer).getBoundingClientRect();
					const scene = getVisibleProjectedData(getProjectedPlaneData(planeKey, planes[planeKey]), visibility);
					return Math.max(scene.bounds.width / Math.max(1, rect.width), scene.bounds.height / Math.max(1, rect.height));
				}));
			}
			renderViewport(viewer, getPrimaryPlaneKey(), "primary");
			if (dualView) renderViewport(secondaryViewer, getSecondaryPlaneKey(), "secondary");
		}

		function renderViewport(viewerElement, planeKey, viewKey) {
			const plane = planes[planeKey] || planes.xz;
			const visibility = getVisibilityState();
			const visibilityKey = getVisibilityKey(visibility);
			const projected = getProjectedPlaneData(planeKey, plane);
			const visible = getVisibleProjectedData(projected, visibility);
			const rows = visible.rows;
			const cycles = visible.cycles;
			const toolChanges = visible.toolChanges;
			const events = visible.events;
			const viewerRect = viewerElement.getBoundingClientRect();
			const fitBounds = visible.bounds;
			const viewportAspect = Math.max(1, viewerRect.width) / Math.max(1, viewerRect.height);
			const fitHeight = dualView && dualFitUnitsPerPixel ? dualFitUnitsPerPixel * Math.max(1, viewerRect.height) : getZoomFitHeight(fitBounds, viewportAspect);
			const bounds = zoomBounds(fitBounds, viewportAspect, plane, fitHeight);
			viewStateByKey.set(viewKey, { fitBounds, fitHeight, bounds, planeKey });
			if (viewKey === "primary") { currentFitBounds = fitBounds; currentBounds = bounds; }
			const playbackActive = playback && playback.active;
			const showLabels = labelsInput.checked && !playbackActive;
			const showEndpoints = endpointsInput.checked && !playbackActive;
			const showZeroLines = zeroLinesInput.checked;
			const showGrid = gridInput.checked;
			const gridSize = normalizeGridSize(gridSizeInput.value);
			const useToolColors = toolColorsInput.checked;
			const unitsPerPixel = bounds.height / Math.max(1, viewerRect.height);
			const labelFontSize = data.options.labelFontSize;
			const compassSize = unitsPerPixel * data.options.compassSize;
			const compassOffsetX = unitsPerPixel * data.options.compassOffsetX;
			const compassOffsetY = unitsPerPixel * data.options.compassOffsetY;
			const compassTextSize = data.options.compassSize * 0.16;
			const endpointSize = unitsPerPixel * data.options.endpointSize;
			const arrowSize = unitsPerPixel * 8 * data.options.arrowSize;
			const endpointLabelOutline = unitsPerPixel * 1.5;
			const lineScale = data.options.lineThickness;

			if (viewKey === "primary" && visibilityKey !== currentTableVisibilityKey) {
				currentTableVisibilityKey = visibilityKey;
				currentTableRows = data.rows.filter(row => row.type === "label" || isRowVisible(row, visibility));
				updateVirtualTable(true);
			}

			if (!rows.length && !cycles.length && !toolChanges.length && !events.length) {
				viewerElement.innerHTML = '<p class="empty" style="padding: 16px;">No drawable moves found for the selected plane.</p>';
				return;
			}

			const zoomBucket = getZoomBucket(zoom);
			const labelEntry = playbackActive ? { mergeDistance: 0, labelSize: 0, targets: [], spatialCells: new Map(), spatialCellSize: 1 }
				: getLabelCacheEntry({ planeKey, plane, visibilityKey, showLabels, showEndpoints, zoomBucket, viewportAspect, fitBounds, fitHeight, viewerSize: Math.max(1, viewerRect.height), rows, cycles, toolChanges, events });
			currentLabelEntryByViewer.set(viewerElement, labelEntry);
			if (viewKey === "primary") currentLabelEntry = labelEntry;
			if (!playbackActive) scheduleLabelCachePrewarm({ planeKey, plane, visibilityKey, showLabels, showEndpoints, zoomBucket, viewportAspect, fitBounds, fitHeight, viewerSize: Math.max(1, viewerRect.height), rows, cycles, toolChanges, events });
			const visibleLabelTargets = playbackActive ? [] : queryLabelCacheEntry(labelEntry, bounds, Math.max(labelEntry.mergeDistance, labelEntry.labelSize * 8));
			const drawBounds = expandBounds(bounds, Math.max(unitsPerPixel * 48, labelEntry.mergeDistance));
			const canvasRows = queryPathIndex(visible.rowIndex, drawBounds);
			const canvasCycles = queryPathIndex(visible.cycleIndex, drawBounds);
			const currentPlaybackDot = getCurrentPlaybackDot(projected);
			if (viewKey === "primary") updatePlaybackPositionReadout(getCurrentPlaybackPosition(projected));
			const labelsAndMarkers = layoutPointLabels(visibleLabelTargets, { labelSize: labelEntry.labelSize, labelOffset: labelEntry.labelOffset, labelHitboxPadding: labelEntry.labelHitboxPadding }).map(renderPointLabel).join("");
			const zeroAxes = showZeroLines ? renderZeroAxes(bounds, plane) : "";
			const compass = renderCompass(bounds, plane, compassSize, compassOffsetX, compassOffsetY);
			const playbackDot = renderPlaybackDotSvg(currentPlaybackDot, unitsPerPixel);
			const svgId = viewKey === "primary" ? "vision-svg" : "vision-svg-secondary";
			const canvasId = viewKey === "primary" ? "vision-canvas" : "vision-canvas-secondary";
			const overlaySvg = '<svg id="' + svgId + '" class="vision-overlay" xmlns="http://www.w3.org/2000/svg" viewBox="' + [bounds.minX, bounds.minY, bounds.width, bounds.height].map(round).join(" ") + '" preserveAspectRatio="none" role="img" aria-label="KAIJU Vision ' + plane.label + ' path">' +
				'<style>' +
					'.zero-line{stroke:#6f6f6f;stroke-width:' + 0.8 * lineScale + ';stroke-dasharray:6 5;vector-effect:non-scaling-stroke;}.compass{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + compassTextSize + 'px;font-weight:600;}.endpoint-label,.start-label{fill:var(--vscode-foreground,#d4d4d4);font-family:Consolas,monospace;font-size:' + labelFontSize + 'px;}.endpoint-label{stroke:#000;stroke-width:' + endpointLabelOutline + ';stroke-linejoin:round;paint-order:stroke fill;}.tool-change-label{font-family:Consolas,monospace;font-size:' + labelFontSize + 'px;font-weight:600;stroke:#000;stroke-width:' + endpointLabelOutline + ';stroke-linejoin:round;paint-order:stroke fill;}.point-label{text-anchor:middle;}.cycle-point{fill:#4fc3ff;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.tool-change-dot{fill:#88ff00;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.endpoint{fill:var(--vscode-foreground,#d4d4d4);stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.75 * lineScale + ';vector-effect:non-scaling-stroke;}.endpoint-program-end{fill:#7f1d1d;}.endpoint-optional-stop{fill:#dcdc6b;}.endpoint-speed-change{fill:#ff2b2b;}.endpoint-compensation{fill:#1f7a3a;}.endpoint-compensation-cancel{fill:#8e44ad;}.start-point{fill:#6A9955;stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:' + 0.85 * lineScale + ';vector-effect:non-scaling-stroke;}.arrow-rapid{fill:#ff8800;}.arrow-cut{fill:#ffd500;}' +
				'</style>' + zeroAxes + compass + playbackDot + labelsAndMarkers + '</svg>';

			let canvas = document.getElementById(canvasId);
			if (!canvas) {
				viewerElement.innerHTML = '<canvas id="' + canvasId + '" class="vision-canvas"></canvas><div class="vision-overlay-host"></div>';
				canvas = document.getElementById(canvasId);
			}
			const overlayHost = viewerElement.querySelector(".vision-overlay-host");
			if (overlayHost._markup !== overlaySvg) {
				clearPinnedTooltip();
				overlayHost.innerHTML = overlaySvg;
				overlayHost._markup = overlaySvg;
			}
			drawCanvasLayer({ canvasId, sceneToken: visible, planeKey, rows: canvasRows, cycles: canvasCycles, sceneRows: rows, sceneCycles: cycles, bounds, showGrid, gridSize, useToolColors, endpointSize, arrowSize, unitsPerPixel, lineScale, playback, playbackActive, currentPlaybackDot });
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
				Number(context.fitHeight) || 0,
				context.viewerSize,
				context.zoomBucket
			].join("::");
		}

		function buildLabelCacheEntry(context, key) {
			const steps = buildLabelCacheEntrySteps(context, key);
			let step;
			do { step = steps.next(); } while (!step.done);
			return step.value;
		}

		function* buildLabelCacheEntrySteps(context, key) {
			const bucketZoom = getZoomForBucket(context.zoomBucket);
			const aspect = Math.max(0.000001, Number(context.viewportAspect) || 1);
			const fitHeight = Number(context.fitHeight) || getFitHeight(context.fitBounds, aspect);
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
			const targets = [];
			const chunkSize = 128;
			for (const kind of ["cycles", "toolChanges", "events", "rows"]) {
				for (let i = 0; i < context[kind].length; i += chunkSize) {
					const chunk = Object.assign({}, context, { rows: [], cycles: [], toolChanges: [], events: [], skipStart: i > 0 });
					chunk[kind] = context[kind].slice(i, i + chunkSize);
					targets.push(...makeLabelTargetsForCache(chunk, metrics));
					yield;
				}
			}
			const collapsedTargets = yield* collapseLabelTargetSteps(targets, context.plane, data.options.humanFormat, entry.mergeDistance, context.showLabels);

			entry.targets = [];
			entry.nextHoverId = 1;
			entry.spatialCellSize = Math.max(entry.mergeDistance, entry.labelSize * 8, 0.000001);
			for (let i = 0; i < collapsedTargets.length; i += 128) {
				const chunk = collapsedTargets.slice(i, i + 128);
				assignHoverIds(entry, chunk);
				entry.targets = chunk;
				indexLabelTargets(entry);
				yield;
			}
			entry.targets = collapsedTargets;
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
			const cycleTargets = context.cycles.map(cycle => makePointLabelTarget(cycle.projectedPoint, metrics.cyclePointSize, "cycle-point", "endpoint-label", context.showLabels ? "L" + getDisplayedVisionLineNumber(cycle) + " " + cycle.instruction : "", context.showLabels ? cycle.labelCoordinateLine : "", { kind: "cycle", position: cycle.end, hoverItems: [cycle.labelHoverHtml], showMarker: context.showEndpoints }));
			const toolTargets = context.toolChanges.map(toolChange => makeToolChangeLabelTarget(toolChange, context.showLabels, metrics.toolChangeSize, context.showEndpoints));
			const eventTargets = context.events.map(event => makePointLabelTarget(event.projectedPoint, metrics.endpointSize, event.markerClass || "endpoint endpoint-stop", "endpoint-label", context.showLabels ? event.instruction : "", context.showLabels ? event.labelCoordinateLine : "", { kind: event.markerKind || "event", position: event.position, hoverItems: [event.labelHoverHtml], showMarker: context.showEndpoints }));
			const firstRow = context.rows[0];
			const firstPoint = firstRow && firstRow.projectedPoints[0];

			if (firstPoint && !context.skipStart) {
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

				targets.push(makePointLabelTarget(end, metrics.endpointSize, row.markerClass || "endpoint", "endpoint-label", context.showLabels ? "L" + getDisplayedVisionLineNumber(row) : "", context.showLabels ? row.endCoordinateLine : "", { kind: row.markerKind || "endpoint", position: row.end, hoverItems: [row.endHoverHtml], showMarker: context.showEndpoints }));
			}

			return targets;
		}

		function assignHoverIds(entry, targets) {
			let nextId = entry.nextHoverId || 1;
			const idsByItems = entry.idsByItems || (entry.idsByItems = new WeakMap());

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
				target.hoverItemCount = target.hoverItems.length;
				delete target.hoverItems;
			}
			entry.nextHoverId = nextId;
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

			const items = getCachedTooltipItems(entry, hoverId);
			const html = '<div class="tooltip-item">' + items.join("") + '</div>';
			entry.hoverHtmlById.set(hoverId, html);
			const addedBytes = html.length * 2;
			entry.bytes += addedBytes;
			if (labelCache.get(entry.key) === entry) {
				labelCacheBytes += addedBytes;
				evictLabelCache(getZoomBucket(zoom));
			}
			return html;
		}

		function getCachedTooltipItems(entry, hoverId) {
			const items = entry && hoverId ? entry.hoverItemsById.get(hoverId) || [] : [];
			return items.map(item => typeof item === "string" ? item : item.tool
				? makeToolChangeHoverHtml(item.row)
				: makePointHoverHtml(item.position, item.start ? Object.assign({}, item.row, { instruction: "START" }) : item.row));
		}

		function estimateLabelCacheEntryBytes(entry) {
			// Conservative accounting for target objects, index cells and shared row references.
			return entry.targets.length * 768 + entry.spatialCells.size * 128 + entry.hoverItemsById.size * 128;
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
			if (labelCacheLimitBytes <= 0) return;
			const key = makeLabelCacheKey(context);
			if (prewarmJobs.get(context.planeKey)?.key === key) return;
			const job = { key, generation: labelCacheRunId };
			prewarmJobs.set(context.planeKey, job);
			const buckets = [-1, 1, -2, 2].map(offset => context.zoomBucket + offset).filter(bucket => bucket >= 0);
			const schedule = window.requestIdleCallback || (callback => window.setTimeout(() => callback({ timeRemaining: () => 4 }), 80));
			let builder;
			const work = deadline => {
				if (job.generation !== labelCacheRunId || prewarmJobs.get(context.planeKey) !== job ||
					(playback && playback.active) || ![getPrimaryPlaneKey(), ...(dualView ? [getSecondaryPlaneKey()] : [])].includes(context.planeKey)) return;
				const stop = performance.now() + 4;
				while (deadline.timeRemaining() > 1 && performance.now() < stop) {
					if (!builder) {
						if (!buckets.length) return;
						const nextContext = Object.assign({}, context, { zoomBucket: buckets.shift() });
						const nextKey = makeLabelCacheKey(nextContext);
						if (labelCache.has(nextKey)) continue;
						builder = buildLabelCacheEntrySteps(nextContext, nextKey);
					}
					const step = builder.next();
					if (step.done) {
						const entry = step.value;
						if (!labelCache.has(entry.key)) {
							labelCache.set(entry.key, entry);
							labelCacheBytes += entry.bytes;
							evictLabelCache(context.zoomBucket);
						}
						builder = undefined;
					}
				}
				schedule(work);
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
				{ kind: "tool", position: toolChange.position || toolChange.point, hoverItems: [toolChange.labelHoverHtml], showMarker }
			);
		}

		function makePointHoverHtml(position, row) {
			const showTraceLine = analysisModeSelect.value === "trace" && lineDataSelect.value === "trace" && row && row.traceLine && Number.isFinite(row.decompositionLineNumber);
			const displayedLineNumber = getDisplayedVisionLineNumber(row);
			const lineLabel = Number.isFinite(displayedLineNumber) ? "L" + displayedLineNumber : "";
			const instruction = row && row.instruction ? row.instruction : "";
			const lines = ['<div class="tooltip-line">' + svgEscape((lineLabel + " " + instruction).trim()) + '</div>'];
			const codeLine = showTraceLine ? row.traceLine : row && row.sourceLine;
			if (codeLine) lines.push('<div class="tooltip-line">' + svgEscape(codeLine.trim()) + '</div>');

			for (const axis of ["x", "y", "z", "c"]) {
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
				const value = (toolChange.position || toolChange.point) && (toolChange.position || toolChange.point)[axis];

				if (Number.isFinite(value)) {
					lines.push('<div class="tooltip-line axis-' + axis + '">' + axis.toUpperCase() + formatAxisNumber(value, data.options.humanFormat) + '</div>');
				}
			}

			return '<div class="tooltip-row">' + lines.join("") + '</div>';
		}
		function collapseCoincidentLabelTargets(targets, plane, humanFormat, mergeDistance, showLabels) {
			const steps = collapseLabelTargetSteps(targets, plane, humanFormat, mergeDistance, showLabels);
			let step;
			do { step = steps.next(); } while (!step.done);
			return step.value;
		}

		function* collapseLabelTargetSteps(targets, plane, humanFormat, mergeDistance, showLabels) {
			const tolerance = Math.max(0, Number(mergeDistance) || 0);
			const groups = [];
			const exactGroups = new Map();
			const spatialCells = new Map();
			let processed = 0;

			for (const target of targets) {
				if (++processed % 128 === 0) yield;
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

			const collapsed = [];
			for (const group of groups) {
				const entries = group.length > 1 ? makeCollapsedLabelTargets(group, plane, humanFormat, showLabels) : [group[0]];
				for (const entry of entries) collapsed.push(entry);
				if (++processed % 128 === 0) yield;
			}
			return collapsed;
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
			const mergedPointSize = group.reduce((largest, target) => Math.max(largest, target.pointSize || 0), 0) * (markerSlices && markerSlices.length > 1 ? mergedSemanticEndpointScale : 1);

			const collapsedTarget = Object.assign({}, representative, {
				pointSize: mergedPointSize,
				labelLine: showLabels ? makeCollapsedLabelText(group.length, toolCount, sourcePosition, plane, humanFormat, data.options.trimLabelTrailingZeros !== false) : "",
				coordinateLine: "",
				markerSlices,
				showMarker: representative.showMarker,
				isMerged: true,
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
					isMerged: true,
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

			for (const axis of [plane.h, plane.v, "c"]) {
				const value = position && position[axis];

				if (Number.isFinite(value)) {
					parts.push(axis.toUpperCase() + formatAxisNumber(value, humanFormat, trimTrailingZeros));
				}
			}

			return parts.join(" ");
		}

		function makePlaneCoordinateLine(position, plane, humanFormat, trimTrailingZeros) {
			const parts = [];

			for (const axis of [plane.h, plane.v, "c"]) {
				const value = position && position[axis];

				if (Number.isFinite(value)) {
					parts.push(axis.toUpperCase() + formatAxisNumber(value, humanFormat, trimTrailingZeros));
				}
			}

			return parts.join(" ");
		}

		function makeVisiblePositionLine(position, humanFormat) {
			const parts = [];

			for (const axis of ["x", "y", "z", "c"]) {
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
			const tooltipCountAttribute = target.hoverItemCount > 1 ? ' data-tooltip-count="' + target.hoverItemCount + '" data-tooltip-merged="true"' : "";
			const markerKeys = getMarkerLegendKeys(target);
			const markerKeysAttribute = markerKeys.length ? ' data-marker-keys="' + escapeAttribute(markerKeys.join(",")) + '"' : "";
			const marker = target.showMarker === false ? "" : renderPointMarker(target, x, y);

			if (!target.labelLine && !target.coordinateLine) {
				return marker ? '<g class="point-label-hit"' + tooltipAttribute + tooltipCountAttribute + markerKeysAttribute + '>' + marker + '</g>' : "";
			}

			return '<g class="point-label-hit"' + tooltipAttribute + tooltipCountAttribute + markerKeysAttribute + '>' + marker +
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

		function renderPlaybackDotSvg(currentDot, unitsPerPixel) {
			if (!currentDot || !currentDot.point) return "";
			const radius = Math.max(0.000001, unitsPerPixel * 5);
			const stroke = Math.max(0.000001, unitsPerPixel * 1.5);
			return '<circle class="playback-current-dot" cx="' + round(currentDot.point.x) + '" cy="' + round(currentDot.point.y) + '" r="' + radius + '" fill="' + escapeAttribute(currentDot.color) + '" stroke="#1e1e1e" stroke-width="' + stroke + '" />';
		}

		function drawCanvasLayer(state) {
			const canvas = document.getElementById(state && state.canvasId ? state.canvasId : "vision-canvas");

			if (!canvas || !state) {
				return;
			}

			if (data.options.renderer !== "canvas" && drawWebglLayer(canvas, state)) return;
			drawCanvas2dLayer(canvas, state);
		}

		function drawCanvas2dLayer(canvas, state) {
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

			const sceneKey = JSON.stringify([state.planeKey, state.bounds, width, height, scale, state.showGrid,
				state.gridSize, state.useToolColors, state.endpointSize, state.arrowSize, state.lineScale,
				state.playback ? state.playback.currentMotionIndex : null]);
			let cached = canvasSceneKeys.get(canvas);
			context.clearRect(0, 0, width, height);
			if (cached && cached.key === sceneKey && cached.token === state.sceneToken) {
				context.drawImage(cached.surface, 0, 0);
				return;
			}
			context.save();
			context.scale(scale, scale);
			const transform = makeCanvasTransform(state.bounds, rect.width, rect.height);

			drawGrid(context, state.bounds, transform, state.gridSize, state.showGrid);
			drawMotionRows(context, state.rows, state, transform);
			drawCycleRows(context, state.cycles, state, transform);
			drawDirectionArrows(context, state.rows, state, transform);
			const surface = cached ? cached.surface : document.createElement("canvas");
			if (surface.width !== width) surface.width = width;
			if (surface.height !== height) surface.height = height;
			const surfaceContext = surface.getContext("2d");
			surfaceContext.clearRect(0, 0, width, height);
			surfaceContext.drawImage(canvas, 0, 0);
			canvasSceneKeys.set(canvas, { key: sceneKey, token: state.sceneToken, surface });
			context.restore();
		}

		function drawWebglLayer(canvas, state) {
			const renderer = getWebglRenderer(canvas);
			if (!renderer || renderer.lost) return false;
			const rect = canvas.getBoundingClientRect();
			const pixelRatio = window.devicePixelRatio || 1;
			const width = Math.max(1, Math.floor(rect.width * pixelRatio));
			const height = Math.max(1, Math.floor(rect.height * pixelRatio));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
			const playbackMap = state.playback && state.playback.motionIndexByExecutionIndex;
			const sceneChanged = renderer.sceneToken !== state.sceneToken
				|| renderer.useToolColors !== state.useToolColors
				|| renderer.playbackMap !== playbackMap;
			if (sceneChanged) {
				uploadWebglPathScene(renderer, state);
				renderer.sceneToken = state.sceneToken;
				renderer.useToolColors = state.useToolColors;
				renderer.playbackMap = playbackMap;
			}
			if (renderer.arrowToken !== state.sceneToken
				|| renderer.arrowPlaybackMap !== playbackMap
				|| renderer.arrowSize !== state.arrowSize
				|| renderer.endpointSize !== state.endpointSize
				|| renderer.arrowUnitsPerPixel !== state.unitsPerPixel
				|| renderer.arrowUseToolColors !== state.useToolColors) {
				uploadWebglArrows(renderer, state);
				renderer.arrowToken = state.sceneToken;
				renderer.arrowPlaybackMap = playbackMap;
				renderer.arrowSize = state.arrowSize;
				renderer.endpointSize = state.endpointSize;
				renderer.arrowUnitsPerPixel = state.unitsPerPixel;
				renderer.arrowUseToolColors = state.useToolColors;
			}
			renderer.drawState = state;
			drawWebglScene(renderer, state, width, height, pixelRatio);
			return true;
		}

		function getWebglRenderer(canvas) {
			if (webglRenderers.has(canvas)) return webglRenderers.get(canvas);
			let gl;
			try {
				gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
			} catch {
				return undefined;
			}
			if (!gl || typeof gl.createShader !== "function" || typeof gl.drawArraysInstanced !== "function") return undefined;
			try {
				const renderer = makeWebglRenderer(gl);
				canvas.addEventListener("webglcontextlost", event => {
					event.preventDefault();
					renderer.lost = true;
				});
				canvas.addEventListener("webglcontextrestored", () => {
					webglRenderers.delete(canvas);
					render();
				});
				webglRenderers.set(canvas, renderer);
				return renderer;
			} catch {
				return undefined;
			}
		}

		function makeWebglRenderer(gl) {
			const lineVertexSource = [
				"#version 300 es", "precision highp float;",
				"layout(location=0) in vec2 aStart;", "layout(location=1) in vec2 aEnd;",
				"layout(location=2) in vec4 aColor;", "layout(location=3) in float aMotion;",
				"layout(location=4) in float aWidth;", "layout(location=5) in float aRapid;", "layout(location=6) in float aDashPhase;",
				"uniform vec4 uBounds;", "uniform vec2 uViewport;", "uniform float uPixelRatio;",
				"out vec4 vColor;", "flat out float vMotion;", "flat out float vRapid;", "flat out vec2 vLineStartPx;", "flat out vec2 vLineTangent;", "flat out float vDashPhase;", "out float vAcrossPx;", "flat out float vHalfWidth;",
				"void main() {", "  int id = gl_VertexID % 6;",
				"  float t = (id == 1 || id == 2 || id == 4) ? 1.0 : 0.0;",
				"  float side = (id == 0 || id == 1 || id == 3) ? -1.0 : 1.0;",
				"  vec2 startPx = (aStart - uBounds.xy) / uBounds.zw * uViewport;",
				"  vec2 endPx = (aEnd - uBounds.xy) / uBounds.zw * uViewport;",
				"  vec2 direction = endPx - startPx;", "  float lengthPx = max(length(direction), 0.0001);",
				"  vec2 tangent = direction / lengthPx;", "  vec2 normal = vec2(-tangent.y, tangent.x);",
				"  float halfWidth = aWidth * uPixelRatio * 0.5;", "  float outerHalfWidth = halfWidth + 1.0;",
				"  float joinOverlap = min(1.0 * uPixelRatio, lengthPx * 0.25);",
				"  vec2 pixel = mix(startPx, endPx, t) + tangent * mix(-joinOverlap, joinOverlap, t) + normal * side * outerHalfWidth;",
				"  gl_Position = vec4(pixel.x / uViewport.x * 2.0 - 1.0, 1.0 - pixel.y / uViewport.y * 2.0, 0.0, 1.0);",
				"  vColor = aColor;", "  vMotion = aMotion;", "  vRapid = aRapid;", "  vLineStartPx = startPx;", "  vLineTangent = tangent;", "  vDashPhase = aDashPhase;", "  vAcrossPx = side * outerHalfWidth / uPixelRatio;", "  vHalfWidth = aWidth * 0.5;", "}"
			].join("\\n");
			const sharedFragmentSource = [
				"#version 300 es", "precision highp float;", "in vec4 vColor;", "flat in float vMotion;",
				"uniform bool uPlaybackActive;", "uniform float uCurrentMotion;", "out vec4 outColor;",
				"void main() {", "  float alpha = vColor.a;",
				"  if (uPlaybackActive) {", "    if (vMotion < 0.0 || vMotion > uCurrentMotion) discard;",
				"    float age = uCurrentMotion - vMotion;", "    alpha *= age == 0.0 ? 1.0 : max(0.06, 1.0 - age / 24.0);", "  }",
				// Premultiply only after coverage and playback opacity have been applied.
				"  outColor = vec4(vColor.rgb * alpha, alpha);", "}"
			].join("\\n");
			const lineFragmentSource = sharedFragmentSource.replace("void main() {", "uniform float uPixelRatio; uniform vec2 uViewport; flat in vec2 vLineStartPx; flat in vec2 vLineTangent; flat in float vDashPhase; in float vAcrossPx; flat in float vHalfWidth; flat in float vRapid;\\nvoid main() {")
				.replace("  float alpha = vColor.a;", "  float alpha = vColor.a;\\n  float crossAa = max(0.5 * length(vec2(dFdx(vAcrossPx), dFdy(vAcrossPx))), 0.0001);\\n  float strokeDistance = abs(vAcrossPx) - vHalfWidth;\\n  float strokeCoverage = 1.0 - smoothstep(-crossAa, crossAa, strokeDistance);\\n  vec2 fragmentPx = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);\\n  float dashAlong = vDashPhase + dot(fragmentPx - vLineStartPx, vLineTangent) / uPixelRatio;\\n  float dashAa = max(0.5 * length(vec2(dFdx(dashAlong), dFdy(dashAlong))), 0.0001);\\n  float dashDistance = abs(fract((dashAlong - 4.0) / 14.0 + 0.5) - 0.5) * 14.0 - 4.0;\\n  float dashCoverage = vRapid > 0.5 ? 1.0 - smoothstep(-dashAa, dashAa, dashDistance) : 1.0;\\n  alpha *= strokeCoverage * dashCoverage;\\n  if (alpha <= 0.001) discard;");
			const arrowVertexSource = [
				"#version 300 es", "precision highp float;", "layout(location=0) in vec2 aPosition;",
				"layout(location=1) in vec4 aColor;", "layout(location=2) in float aMotion;",
				"uniform vec4 uBounds;", "uniform vec2 uViewport;", "out vec4 vColor;", "flat out float vMotion;",
				"void main() {", "  vec2 pixel = (aPosition - uBounds.xy) / uBounds.zw * uViewport;",
				"  gl_Position = vec4(pixel.x / uViewport.x * 2.0 - 1.0, 1.0 - pixel.y / uViewport.y * 2.0, 0.0, 1.0);",
				"  vColor = aColor;", "  vMotion = aMotion;", "}"
			].join("\\n");
			const gridVertexSource = [
				"#version 300 es", "precision highp float;", "uniform vec4 uBounds;", "out vec2 vWorld;",
				"void main() {", "  vec2 clip = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);",
				"  vWorld = uBounds.xy + vec2(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5) * uBounds.zw;",
				"  gl_Position = vec4(clip, 0.0, 1.0);", "}"
			].join("\\n");
			const gridFragmentSource = [
				"#version 300 es", "precision highp float;", "in vec2 vWorld;", "uniform float uGridSize;", "uniform float uCssPixelsPerWorld;", "uniform float uPixelRatio;", "out vec4 outColor;",
				"void main() {", "  vec2 cellDistance = abs(fract(vWorld / uGridSize + 0.5) - 0.5) * uGridSize;",
				"  float distanceCss = min(cellDistance.x, cellDistance.y) * uCssPixelsPerWorld;", "  float aa = 0.5 / uPixelRatio;",
				"  float coverage = 1.0 - smoothstep(aa, 2.0 * aa, distanceCss);", "  float alpha = 0.18 * coverage;",
				"  outColor = vec4(vec3(0.588) * alpha, alpha);", "}"
			].join("\\n");
			const lineProgram = makeWebglProgram(gl, lineVertexSource, lineFragmentSource);
			const arrowProgram = makeWebglProgram(gl, arrowVertexSource, sharedFragmentSource);
			const gridProgram = makeWebglProgram(gl, gridVertexSource, gridFragmentSource);
			return {
				gl, lineProgram, arrowProgram, gridProgram, lineBuffer: gl.createBuffer(), dashPhaseBuffer: gl.createBuffer(), arrowBuffer: gl.createBuffer(),
				lineCount: 0, arrowCount: 0, sceneToken: undefined, arrowKey: "", lost: false
			};
		}

		function makeWebglProgram(gl, vertexSource, fragmentSource) {
			const compile = (type, source) => {
				const shader = gl.createShader(type);
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Vision WebGL shader failed to compile.");
				return shader;
			};
			const program = gl.createProgram();
			gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
			gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Vision WebGL program failed to link.");
			return program;
		}

		function uploadWebglPathScene(renderer, state) {
			const values = [];
			const sceneBounds = state.sceneToken && state.sceneToken.bounds;
			renderer.origin = sceneBounds ? {
				x: sceneBounds.minX + sceneBounds.width / 2,
				y: sceneBounds.minY + sceneBounds.height / 2
			} : { x: 0, y: 0 };
			const rapidPath = { distance: 0, end: undefined };
			for (const row of state.sceneRows || []) {
				const rapid = row.motionCode === 0;
				if (!rapid) { rapidPath.distance = 0; rapidPath.end = undefined; }
				appendWebglPolyline(values, row, getMotionStrokeColor(row, state.useToolColors), (rapid ? 1.1 : 1.4) * state.lineScale, rapid, state, rapidPath, renderer.origin);
			}
			for (const cycle of state.sceneCycles || []) appendWebglPolyline(values, cycle, state.useToolColors && cycle.toolColor ? boostToolColor(cycle.toolColor) : "#4fc3ff", 1.45 * state.lineScale, false, state, undefined, renderer.origin);
			const gl = renderer.gl;
			gl.bindBuffer(gl.ARRAY_BUFFER, renderer.lineBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
			renderer.lineCount = values.length / 12;
			renderer.dashDistances = new Float64Array(renderer.lineCount);
			for (let index = 0; index < renderer.lineCount; index++) renderer.dashDistances[index] = values[index * 12 + 11];
			renderer.dashScaleKey = undefined;
		}

		function appendWebglPolyline(values, row, color, width, rapid, state, rapidPath = { distance: 0, end: undefined }, origin = { x: 0, y: 0 }) {
			const points = row && row.projectedPoints;
			if (!points || points.length < 2) return;
			const rgba = webglColor(color);
			const motion = getWebglMotionIndex(row, state);
			if (rapid && rapidPath.end && getPointDistance(rapidPath.end, points[0]) > 0.000001) rapidPath.distance = 0;
			for (let index = 1; index < points.length; index++) {
				const start = points[index - 1], end = points[index];
				if (!start || !end) continue;
				const dashOffset = rapid ? rapidPath.distance : 0;
				values.push(start.x - origin.x, start.y - origin.y, end.x - origin.x, end.y - origin.y, rgba[0], rgba[1], rgba[2], rgba[3], motion, width, rapid ? 1 : 0, dashOffset);
				if (rapid) rapidPath.distance += getPointDistance(start, end);
			}
			if (rapid) rapidPath.end = points[points.length - 1];
		}

		function uploadWebglArrows(renderer, state) {
			const values = [];
			for (const row of state.sceneRows || []) {
				const segment = makeDirectionArrowSegment(row.projectedPoints, state.endpointSize, state.arrowSize, state.unitsPerPixel);
				if (!segment) continue;
				const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
				const length = Math.hypot(dx, dy);
				if (!Number.isFinite(length) || length <= 0) continue;
				const size = Math.max(state.unitsPerPixel * 4, state.arrowSize);
				const wing = size * 0.45, ux = dx / length, uy = dy / length;
				const left = { x: segment.end.x - ux * size - uy * wing, y: segment.end.y - uy * size + ux * wing };
				const right = { x: segment.end.x - ux * size + uy * wing, y: segment.end.y - uy * size - ux * wing };
				const color = webglColor(getDirectionStrokeColor(row, state.useToolColors));
				const motion = getWebglMotionIndex(row, state);
				const origin = renderer.origin || { x: 0, y: 0 };
				for (const point of [segment.end, left, right]) values.push(point.x - origin.x, point.y - origin.y, color[0], color[1], color[2], color[3], motion);
			}
			const gl = renderer.gl;
			gl.bindBuffer(gl.ARRAY_BUFFER, renderer.arrowBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
			renderer.arrowCount = values.length / 7;
		}

		function getWebglMotionIndex(row, state) {
			const map = state.playback && state.playback.motionIndexByExecutionIndex;
			return map && Number.isFinite(row && row.executionIndex) && map.has(row.executionIndex) ? map.get(row.executionIndex) : -1;
		}

		function webglColor(value) {
			const text = String(value || "#ffffff").trim();
			const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
			if (hex) {
				const source = hex[1].length === 3 ? hex[1].split("").map(character => character + character).join("") : hex[1];
				return [parseInt(source.slice(0, 2), 16) / 255, parseInt(source.slice(2, 4), 16) / 255, parseInt(source.slice(4, 6), 16) / 255, 1];
			}
			// calculateBoostedToolColor returns modern space-separated HSL. Canvas
			// resolves that CSS directly; convert the same form before GPU upload.
			const hsl = text.match(/^hsl[(][ ]*(-?(?:[0-9]+[.]?[0-9]*|[.][0-9]+))[ ]+(-?(?:[0-9]+[.]?[0-9]*|[.][0-9]+))%[ ]+(-?(?:[0-9]+[.]?[0-9]*|[.][0-9]+))%[ ]*[)]$/i);
			if (!hsl) return [1, 1, 1, 1];
			const hue = ((Number(hsl[1]) % 360) + 360) % 360 / 360;
			const saturation = Math.max(0, Math.min(1, Number(hsl[2]) / 100));
			const lightness = Math.max(0, Math.min(1, Number(hsl[3]) / 100));
			const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
			const section = hue * 6;
			const secondary = chroma * (1 - Math.abs(section % 2 - 1));
			const match = lightness - chroma / 2;
			const channels = section < 1 ? [chroma, secondary, 0]
				: section < 2 ? [secondary, chroma, 0]
					: section < 3 ? [0, chroma, secondary]
						: section < 4 ? [0, secondary, chroma]
							: section < 5 ? [secondary, 0, chroma]
								: [chroma, 0, secondary];
			return [channels[0] + match, channels[1] + match, channels[2] + match, 1];
		}

		function drawWebglScene(renderer, state, width, height, pixelRatio) {
			const gl = renderer.gl;
			gl.viewport(0, 0, width, height);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.enable(gl.BLEND);
			// Both the shader output and browser compositor use premultiplied alpha.
			// SRC_ALPHA here would darken edges and square playback trail opacity.
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			if (state.showGrid) drawWebglGrid(renderer, state, width, pixelRatio);
			updateWebglDashPhases(renderer, state, width, pixelRatio);
			drawWebglBuffer(renderer, renderer.lineProgram, renderer.lineBuffer, renderer.lineCount, 12, true, state, width, height, pixelRatio);
			drawWebglBuffer(renderer, renderer.arrowProgram, renderer.arrowBuffer, renderer.arrowCount, 7, false, state, width, height, pixelRatio);
		}

		function drawWebglGrid(renderer, state, width, pixelRatio) {
			const gl = renderer.gl;
			const cssPixelsPerWorldUnit = width / Math.max(0.000001, pixelRatio * state.bounds.width);
			const gridSize = normalizeGridSize(state.gridSize);
			if (!Number.isFinite(gridSize) || gridSize <= 0) return;
			const originX = Math.floor(state.bounds.minX / gridSize) * gridSize;
			const originY = Math.floor(state.bounds.minY / gridSize) * gridSize;
			gl.useProgram(renderer.gridProgram);
			gl.uniform4f(gl.getUniformLocation(renderer.gridProgram, "uBounds"), state.bounds.minX - originX, state.bounds.minY - originY, state.bounds.width, state.bounds.height);
			gl.uniform1f(gl.getUniformLocation(renderer.gridProgram, "uGridSize"), gridSize);
			gl.uniform1f(gl.getUniformLocation(renderer.gridProgram, "uCssPixelsPerWorld"), cssPixelsPerWorldUnit);
			gl.uniform1f(gl.getUniformLocation(renderer.gridProgram, "uPixelRatio"), pixelRatio);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		function updateWebglDashPhases(renderer, state, width, pixelRatio) {
			if (!renderer.lineCount || !renderer.dashDistances) return;
			const cssPixelsPerWorldUnit = width / Math.max(0.000001, pixelRatio * state.bounds.width);
			const scaleKey = Math.round(cssPixelsPerWorldUnit * 1000000000) / 1000000000;
			if (renderer.dashScaleKey === scaleKey) return;
			const periodWorld = 14 / Math.max(0.000001, cssPixelsPerWorldUnit);
			const phases = new Float32Array(renderer.lineCount);
			for (let index = 0; index < renderer.lineCount; index++) {
				const distance = renderer.dashDistances[index];
				phases[index] = ((distance % periodWorld) + periodWorld) % periodWorld * cssPixelsPerWorldUnit;
			}
			const gl = renderer.gl;
			gl.bindBuffer(gl.ARRAY_BUFFER, renderer.dashPhaseBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, phases, gl.DYNAMIC_DRAW);
			renderer.dashScaleKey = scaleKey;
		}

		function drawWebglBuffer(renderer, program, buffer, count, stride, lines, state, width, height, pixelRatio) {
			if (!count) return;
			const gl = renderer.gl;
			gl.useProgram(program);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			const bytes = stride * 4;
			gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, bytes, 0);
			if (lines) {
				gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, bytes, 2 * 4);
				gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 4 * 4);
				gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bytes, 8 * 4);
				gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, bytes, 9 * 4);
				gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, bytes, 10 * 4);
				gl.bindBuffer(gl.ARRAY_BUFFER, renderer.dashPhaseBuffer);
				gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 4, 0);
				for (const location of [0, 1, 2, 3, 4, 5, 6]) gl.vertexAttribDivisor(location, 1);
			} else {
				gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 2 * 4);
				gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bytes, 6 * 4);
			}
			const origin = renderer.origin || { x: 0, y: 0 };
			gl.uniform4f(gl.getUniformLocation(program, "uBounds"), state.bounds.minX - origin.x, state.bounds.minY - origin.y, state.bounds.width, state.bounds.height);
			gl.uniform2f(gl.getUniformLocation(program, "uViewport"), width, height);
			const active = state.playbackActive === true;
			gl.uniform1i(gl.getUniformLocation(program, "uPlaybackActive"), active ? 1 : 0);
			gl.uniform1f(gl.getUniformLocation(program, "uCurrentMotion"), active ? state.playback.currentMotionIndex : -1);
			if (lines) {
				gl.uniform1f(gl.getUniformLocation(program, "uPixelRatio"), pixelRatio);
				gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
				for (const location of [0, 1, 2, 3, 4, 5, 6]) gl.vertexAttribDivisor(location, 0);
			} else {
				gl.drawArrays(gl.TRIANGLES, 0, count);
			}
		}

		function normalizeGridSize(value) {
			const size = Number(value);
			return Number.isFinite(size) && size > 0 ? Math.max(0.001, Math.min(size, 1000000)) : 10;
		}

		function drawGrid(context, bounds, transform, size, showGrid) {
			if (!showGrid || !bounds || !Number.isFinite(size) || size <= 0) return;
			const verticalCount = Math.ceil(bounds.width / size) + 1;
			const horizontalCount = Math.ceil(bounds.height / size) + 1;

			// A very small program-unit grid can otherwise create enough lines to
			// make panning sluggish. The entered size remains intact for closer zoom.
			if (verticalCount > 500 || horizontalCount > 500) return;

			context.save();
			context.strokeStyle = "rgba(150, 150, 150, 0.18)";
			context.lineWidth = 1;
			context.beginPath();
			const startX = Math.ceil(bounds.minX / size) * size;
			const startY = Math.ceil(bounds.minY / size) * size;
			const maxX = bounds.minX + bounds.width;
			const maxY = bounds.minY + bounds.height;

			for (let x = startX; x <= maxX + size * 0.000001; x += size) {
				const screenX = transform.x({ x, y: 0 });
				context.moveTo(screenX, 0);
				context.lineTo(screenX, transform.y({ x: 0, y: maxY }));
			}
			for (let y = startY; y <= maxY + size * 0.000001; y += size) {
				const screenY = transform.y({ x: 0, y });
				context.moveTo(0, screenY);
				context.lineTo(transform.x({ x: maxX, y: 0 }), screenY);
			}
			context.stroke();
			context.restore();
		}

		function getPlaybackProjectionIndex(projected) {
			let index = playbackProjectionIndexes.get(projected);
			if (index) return index;
			const candidates = [...projected.rows, ...projected.cycles, ...projected.toolChanges, ...projected.events]
				.filter(row => Number.isFinite(row.executionIndex)).sort((a, b) => a.executionIndex - b.executionIndex);
			let point, position;
			const positions = candidates.map(row => {
				point = row.projectedEnd || row.projectedPoint || (row.projectedPoints && row.projectedPoints[row.projectedPoints.length - 1]) || point;
				position = row.end || row.position || row.point || position;
				return { executionIndex: row.executionIndex, point, position };
			});
			index = { positions, motions: new Map([...projected.rows, ...projected.cycles].map(row => [row.executionIndex, row])) };
			playbackProjectionIndexes.set(projected, index);
			return index;
		}

		function getPlaybackLocation(projected) {
			const positions = getPlaybackProjectionIndex(projected).positions;
			let low = 0, high = positions.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if (positions[middle].executionIndex <= playback.cursor) low = middle + 1;
				else high = middle;
			}
			return positions[low - 1];
		}

		function getCurrentPlaybackDot(projected) {
			if (!playback || !playback.active) return undefined;
			const location = getPlaybackLocation(projected);
			if (!location || !location.point) return undefined;
			return { point: location.point, color: getPlaybackDotColor(playback.entries[playback.cursor],
				getPlaybackProjectionIndex(projected).motions.get(playback.cursor)) };
		}

		function getCurrentPlaybackPosition(projected) {
			if (!playback || !playback.active) return undefined;
			const location = getPlaybackLocation(projected);
			return location && location.position;
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
			if (/\\bG(?:41|42|43|44|46)\\b/i.test(code)) return "#1f7a3a";
			if (/\\bG(?:40|49)\\b/i.test(code)) return "#8e44ad";
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
				scaleX: width / bounds.width,
				scaleY: height / bounds.height,
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
			if (typeof Path2D !== "undefined") {
				const combined = new Path2D();
				const origin = { x: 0, y: 0 };
				const matrix = { a: transform.scaleX, b: 0, c: 0,
					d: transform.scaleY, e: transform.x(origin), f: transform.y(origin) };
				for (let start = 0; start < pointSets.length; start += 128) {
					const end = Math.min(start + 128, pointSets.length);
					const first = pointSets[start], last = pointSets[end - 1];
					if (!first) continue;
					let cached = pathChunkCache.get(first);
					// Verify every reference: filtering can change the middle of a chunk.
					if (!cached || cached.last !== last || cached.sets.length !== end - start ||
						cached.sets.some((points, offset) => points !== pointSets[start + offset])) {
						const path = new Path2D();
						let bytes = 128;
						for (let i = start; i < end; i++) {
							const points = pointSets[i];
							if (!points || points.length < 2) continue;
							path.moveTo(points[0].x, points[0].y);
							for (let j = 1; j < points.length; j++) path.lineTo(points[j].x, points[j].y);
							bytes += points.length * 32;
						}
						if (pathChunkBytes + bytes > pathChunkLimitBytes) {
							pathChunkCache = new WeakMap(); pathChunkBytes = 0;
						}
						cached = { path, sets: pointSets.slice(start, end), last, bytes };
						if (bytes <= pathChunkLimitBytes) { pathChunkCache.set(first, cached); pathChunkBytes += bytes; }
					}
					combined.addPath(cached.path, matrix);
				}
				context.stroke(combined);
				context.restore();
				return;
			}

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
			const currentMotionIndex = playbackState.currentMotionIndex ?? getCurrentPlaybackMotionIndex(playbackState);
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
			if (!points) return undefined;
			const cached = arrowGeometryCache.get(points);
			if (cached && cached.endpointSize === endpointSize && cached.arrowSize === arrowSize && cached.unitsPerPixel === unitsPerPixel) return cached.segment;
			const segment = calculateDirectionArrowSegment(points, endpointSize, arrowSize, unitsPerPixel);
			arrowGeometryCache.set(points, { endpointSize, arrowSize, unitsPerPixel, segment });
			return segment;
		}

		function calculateDirectionArrowSegment(points, endpointSize, arrowSize, unitsPerPixel) {
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

		function renderZeroAxes(bounds, plane) {
			const lines = [];
			const offsets = collectWorkOffsets();
			const referenceOffset = offsets[collectReferenceFrame()] || { x: 0, y: 0, z: 0 };

			for (const [code, offset] of Object.entries(offsets)) {
				if (!offset.showZeroLines) continue;
				const origin = project({
					x: data.options.xAxisMode === "diameter" ? (offset.x - referenceOffset.x) / 2 : offset.x - referenceOffset.x,
					y: offset.y - referenceOffset.y,
					z: offset.z - referenceOffset.z
				}, plane);
				if (!origin) continue;
				if (bounds.minY <= origin.y && bounds.minY + bounds.height >= origin.y) {
					lines.push('<line class="zero-line" data-zero-frame="' + code + '" x1="' + bounds.minX + '" y1="' + origin.y + '" x2="' + (bounds.minX + bounds.width) + '" y2="' + origin.y + '" />');
				}
				if (bounds.minX <= origin.x && bounds.minX + bounds.width >= origin.x) {
					lines.push('<line class="zero-line" data-zero-frame="' + code + '" x1="' + origin.x + '" y1="' + bounds.minY + '" x2="' + origin.x + '" y2="' + (bounds.minY + bounds.height) + '" />');
				}
			}

			return lines.join("");
		}

		function getDisplayedVisionLineNumber(row) {
			const showTraceLine = analysisModeSelect.value === "trace" && lineDataSelect.value === "trace" && row && row.traceLine && Number.isFinite(row.decompositionLineNumber);

			return showTraceLine
				? row.decompositionLineNumber
				: row && Number.isFinite(row.lineNumber) ? row.lineNumber : undefined;
		}

		function escapeAttribute(value) {
			return String(value || "")
				.replace(/&/g, "&amp;")
				.replace(/"/g, "&quot;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		}

		function boostToolColor(color) {
			if (toolColorCache.has(color)) return toolColorCache.get(color);
			const boosted = calculateBoostedToolColor(color);
			toolColorCache.set(color, boosted);
			return boosted;
		}

		function calculateBoostedToolColor(color) {
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
		sharedAxisSelect.addEventListener("change", () => {
			sharedAxis = sharedAxisSelect.value;
			resetView();
			saveViewport();
		});
		dualViewToggle.addEventListener("click", () => {
			dualView = !dualView;
			if (dualView && !sharedAxis) sharedAxis = getSharedAxisForPlane(planeSelect.value);
			updateDualViewControls();
			saveViewport();
			resetView();
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
		gridInput.addEventListener("change", () => { render(); saveVisionSettings(); });
		gridSizeInput.addEventListener("change", () => { gridSizeInput.value = normalizeGridSize(gridSizeInput.value); render(); saveVisionSettings(); });
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
			if (!tooltip || dragState || pinnedTooltip) {
				if (!pinnedTooltip) hideTooltip();
				return;
			}

			const target = event.target && event.target.closest ? event.target.closest(".point-label-hit") : undefined;
			const hoverId = target && target.getAttribute("data-tooltip-id");
			const labelEntry = currentLabelEntryByViewer.get(event.currentTarget) || currentLabelEntry;
			const html = getCachedTooltipHtml(labelEntry, hoverId);
			updateMarkerLegend(target);

			if (!html) {
				hideTooltipOnly();
				return;
			}

			tooltip.innerHTML = html;
			tooltip.style.display = "block";
			positionTooltip(event);
		}

		function togglePinnedTooltip(event) {
			const target = event.target && event.target.closest ? event.target.closest(".point-label-hit[data-tooltip-merged='true']") : undefined;

			if (!target) {
				if (pinnedTooltip) clearPinnedTooltip();
				return;
			}
			const hoverId = target.getAttribute("data-tooltip-id");

			if (!hoverId) return;
			if (pinnedTooltip && pinnedTooltip.hoverId === hoverId) {
				clearPinnedTooltip();
				return;
			}

			const labelEntry = currentLabelEntryByViewer.get(event.currentTarget) || currentLabelEntry;
			const items = getCachedTooltipItems(labelEntry, hoverId);

			if (items.length < 2) return;
			pinnedTooltip = { hoverId };
			tooltip.innerHTML = '<div class="pinned-tooltip-title">Merged node · ' + items.length + ' entries · scroll to browse · click node to release</div><div class="pinned-tooltip-list">' + items.join("") + '</div>';
			tooltip.classList.add("pinned");
			tooltip.style.display = "block";
			updateMarkerLegend(target);
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
			if (pinnedTooltip) return;
			hideTooltipOnly();
			hideMarkerLegend();
		}

		function clearPinnedTooltip() {
			pinnedTooltip = undefined;
			if (tooltip) tooltip.classList.remove("pinned");
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
		function bindViewerNavigation(targetViewer, viewKey) {
			targetViewer.addEventListener("mousemove", updateTooltip);
			targetViewer.addEventListener("mouseleave", hideTooltip);
			targetViewer.addEventListener("click", togglePinnedTooltip);
			targetViewer.addEventListener("wheel", event => {
				event.preventDefault();
				setZoom(zoom * (event.deltaY < 0 ? wheelZoomStep : 1 / wheelZoomStep), event, viewKey);
			}, { passive: false });
			targetViewer.addEventListener("pointerdown", event => {
				const state = viewStateByKey.get(viewKey);
				if (!state || !state.bounds || event.button !== 0) return;
				if (event.target && event.target.closest && event.target.closest(".point-label-hit[data-tooltip-merged='true']")) return;
				const planeKey = viewKey === "secondary" ? getSecondaryPlaneKey() : getPrimaryPlaneKey();
				const plane = planes[planeKey] || planes.xz;
				targetViewer.setPointerCapture(event.pointerId);
				hideTooltip();
				targetViewer.classList.add("dragging");
				dragState = { pointerId: event.pointerId, viewer: targetViewer, viewKey, plane, startX: event.clientX, startY: event.clientY, startWorldPan: Object.assign({}, worldPan), startProjectedPan: getProjectedPan(plane), bounds: state.bounds };
			});
			targetViewer.addEventListener("pointermove", event => {
				if (!dragState || dragState.viewer !== targetViewer || dragState.pointerId !== event.pointerId) return;
				const rect = targetViewer.getBoundingClientRect();
				const dx = event.clientX - dragState.startX;
				const dy = event.clientY - dragState.startY;
				const projectedPan = {
					x: dragState.startProjectedPan.x - dx / Math.max(1, rect.width) * dragState.bounds.width,
					y: dragState.startProjectedPan.y - dy / Math.max(1, rect.height) * dragState.bounds.height
				};
				if (previewWebglPan(dragState, projectedPan)) return;
				setProjectedPan(dragState.plane, projectedPan, dragState.startWorldPan);
				saveViewport();
				render();
			});
			const finishDrag = event => {
				if (!dragState || dragState.viewer !== targetViewer || (event && dragState.pointerId !== event.pointerId)) return;
				const finishedDrag = dragState;
				dragState = undefined;
				targetViewer.classList.remove("dragging");
				if (finishedDrag.pendingProjectedPan) {
					setProjectedPan(finishedDrag.plane, finishedDrag.pendingProjectedPan, finishedDrag.startWorldPan);
					setDualOverlayVisibility("");
					saveViewport();
					render();
				}
			};
			targetViewer.addEventListener("pointerup", finishDrag);
			targetViewer.addEventListener("pointercancel", finishDrag);
		}

		function previewWebglPan(state, projectedPan) {
			const canvas = state.viewer && state.viewer.querySelector ? state.viewer.querySelector("canvas") : undefined;
			const renderer = canvas && webglRenderers.get(canvas);
			if (!renderer || renderer.lost || !renderer.drawState) return false;
			state.pendingProjectedPan = projectedPan;
			setDualOverlayVisibility("hidden");
			if (state.previewPending) return true;
			state.previewPending = true;
			window.requestAnimationFrame(() => {
				state.previewPending = false;
				if (dragState !== state || !state.pendingProjectedPan) return;
				const previewWorldPan = getWorldPanForProjectedPan(state.plane, state.pendingProjectedPan, state.startWorldPan);
				drawWebglPanPreview(state.viewer, state.viewKey, previewWorldPan);
				if (dualView) drawWebglPanPreview(state.viewKey === "secondary" ? viewer : secondaryViewer,
					state.viewKey === "secondary" ? "primary" : "secondary", previewWorldPan);
			});
			return true;
		}

		function drawWebglPanPreview(targetViewer, viewKey, previewWorldPan) {
			const canvas = targetViewer && targetViewer.querySelector ? targetViewer.querySelector("canvas") : undefined;
			const renderer = canvas && webglRenderers.get(canvas);
			const viewState = viewStateByKey.get(viewKey);
			if (!renderer || renderer.lost || !renderer.drawState || !viewState || !viewState.bounds) return;
			const planeKey = viewKey === "secondary" ? getSecondaryPlaneKey() : getPrimaryPlaneKey();
			const plane = planes[planeKey] || planes.xz;
			const rect = canvas.getBoundingClientRect();
			const previewState = Object.assign({}, renderer.drawState, {
				bounds: getPanPreviewBounds(viewState.bounds, plane, getProjectedPan(plane, previewWorldPan))
			});
			drawWebglScene(renderer, previewState,
				Math.max(1, Math.floor(rect.width * (window.devicePixelRatio || 1))),
				Math.max(1, Math.floor(rect.height * (window.devicePixelRatio || 1))), window.devicePixelRatio || 1);
		}

		function setDualOverlayVisibility(visibility) {
			for (const targetViewer of dualView ? [viewer, secondaryViewer] : [viewer]) {
				const overlayHost = targetViewer.querySelector(".vision-overlay-host");
				if (overlayHost) overlayHost.style.visibility = visibility;
			}
		}

		function getPanPreviewBounds(bounds, plane, pan) {
			const currentPan = getProjectedPan(plane);
			return {
				minX: bounds.minX + pan.x - currentPan.x,
				minY: bounds.minY + pan.y - currentPan.y,
				width: bounds.width,
				height: bounds.height
			};
		}
		bindViewerNavigation(viewer, "primary");
		bindViewerNavigation(secondaryViewer, "secondary");
		markerLegendToggle.addEventListener("change", () => { updateMarkerLegend(); saveVisionSettings(); });
		viewToggle.addEventListener("click", () => viewPanel.classList.toggle("open"));
		offsetsToggle.addEventListener("click", () => {
			offsetPanel.classList.toggle("open");
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
			vscode.postMessage({ type: "saveOffsets", offsets: collectWorkOffsets(), referenceFrame: collectReferenceFrame(), options: collectVisionOptions() });
		});
		document.querySelectorAll("[data-offset-reference]").forEach(input => input.addEventListener("change", () => selectOffsetReference(input)));
		document.querySelectorAll("[data-offset-zero]").forEach(input => input.addEventListener("change", render));
		document.querySelectorAll("[data-offset-axis]").forEach(input => input.addEventListener("change", previewOffsets));
		document.querySelector("[data-start-frame]").addEventListener("change", previewOffsets);
		document.querySelectorAll("[data-start-axis]").forEach(input => input.addEventListener("change", previewOffsets));
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

function makeWebviewNonce() {
	let nonce = "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let index = 0; index < 32; index++) nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	return nonce;
}

function renderVisionOffsetPanel(workOffsets, referenceFrame, initialPosition, isOpen = false) {
	const reference = normalizeVisionReferenceFrame(referenceFrame);
	const normalizedOffsets = normalizeVisionWorkOffsets(workOffsets);
	const start = normalizeVisionInitialPosition(initialPosition);
	const rows = VISION_COORDINATE_FRAME_CODES.map(code => {
		const offset = normalizedOffsets[code];
		const isReference = code === reference;

		return `<tr data-offset-code="${escapeAttribute(code)}">
			<td><code>${escapeHtml(code)}</code></td>
			<td><input data-offset-reference type="radio" name="offsetReference" value="${escapeAttribute(code)}"${code === reference ? " checked" : ""} title="Use this coordinate frame as the display reference"></td>
			<td><input data-offset-zero type="checkbox"${offset.showZeroLines ? " checked" : ""} title="Show this frame's origin axes when View > Zero lines is enabled"></td>
			<td><input data-offset-axis="x" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(offset.x))}"${isReference ? " disabled" : ""}></td>
			<td><input data-offset-axis="y" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(offset.y))}"${isReference ? " disabled" : ""}></td>
			<td><input data-offset-axis="z" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(offset.z))}"${isReference ? " disabled" : ""}></td>
			<td><input data-offset-note type="text" value="${escapeAttribute(offset.note || "")}"></td>
		</tr>`;
	}).join("");
	return `<section id="offsetPanel" class="offset-panel${isOpen ? " open" : ""}">
		<div class="offset-actions" title="Vision draws the first move from this assumed physical tool position. The coordinates are expressed in the selected frame.">
			<label>Assumed start
				<select data-start-frame>${VISION_COORDINATE_FRAME_CODES.map(code => `<option value="${escapeAttribute(code)}"${code === start.coordinateSystem ? " selected" : ""}>${escapeHtml(code)}</option>`).join("")}</select>
			</label>
			<label>X <input data-start-axis="x" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(start.x))}"></label>
			<label>Y <input data-start-axis="y" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(start.y))}"></label>
			<label>Z <input data-start-axis="z" type="number" step="0.001" value="${escapeAttribute(formatOffsetInputValue(start.z))}"></label>
		</div>
		<table>
			<thead>
				<tr>
					<th>Frame</th>
					<th>Ref.</th>
					<th>Show axes</th>
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

function renderVisionViewPanel(options, rows) {
	const toolEntries = getVisibilityEntries(rows, getVisionToolKey, getVisionToolLabel);
	const wcsEntries = getVisibilityEntries(rows, getVisionWcsKey, getVisionWcsLabel);

	return `<section id="viewPanel" class="control-panel">
		<div class="view-panel-section">
			<div class="visibility-options">
				<label class="checkbox"><input id="labels" type="checkbox"${options.showLabels ? " checked" : ""}> Labels</label>
				<label class="checkbox"><input id="endpoints" type="checkbox"${options.showEndpoints ? " checked" : ""}> Endpoints</label>
				<label class="checkbox"><input id="zeroLines" type="checkbox"${options.showZeroLines ? " checked" : ""}> Zero lines</label>
				<label class="checkbox"><input id="toolColors" type="checkbox"${options.useToolColors ? " checked" : ""}> Tool colors</label>
				<label class="checkbox"><input id="markerLegendToggle" type="checkbox"${options.showMarkerLegend ? " checked" : ""}> Legend</label>
				<label class="checkbox" title="Draw a subtle program-unit grid behind the toolpath."><input id="grid" type="checkbox"${options.showGrid ? " checked" : ""}> Grid</label>
				<label class="grid-size" title="Program units between grid lines.">Size <input id="gridSize" type="number" min="0.001" step="any" value="${escapeAttribute(options.gridSize)}"></label>
			</div>
		</div>
		<div class="view-panel-section visibility-groups">
			${renderVisibilityGroup("Tools", toolEntries, "tool")}
			${renderVisibilityGroup("WCS", wcsEntries, "wcs")}
		</div>
	</section>`;
}

function formatOffsetInputValue(value) {
	return Number.isFinite(value) ? String(value) : "0";
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
