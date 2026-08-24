// Role: execute deterministic macro control flow once per settled document
// version and expose a shared, read-only trace cache. Product UI belongs in
// the consuming feature modules.
const vscode = require("vscode");
const { EventEmitter } = require("events");
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("./MetaTextRanges");
const {
	MACRO_REGEX,
	buildAliasEntries,
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
} = require("./MetaMacroEngine");

const DEFAULT_DEBOUNCE_MS = 350;
const DEFAULT_MAX_EXECUTION_STEPS = 20000;
const DEFAULT_COMPARISON_TOLERANCE = 1e-7;
const traceCache = new Map();
const pendingRuns = new Map();
const traceEvents = new EventEmitter();

function registerExecutionTrace(context) {
	const scheduleActive = (options) => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === "gcode") {
			scheduleExecutionTrace(editor.document, options);
		}
	};

	scheduleActive();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(scheduleActive),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.languageId === "gcode") {
				scheduleExecutionTrace(event.document);
			}
		}),
		vscode.workspace.onDidCloseTextDocument(document => clearExecutionTrace(document)),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.trace")) {
				scheduleActive({ force: true });
			}
		}),
		{ dispose: () => disposeExecutionTraceService() }
	);
}

function scheduleExecutionTrace(document, { force = false } = {}) {
	if (!document || document.languageId !== "gcode") {
		return;
	}

	const key = document.uri.toString();
	const existing = pendingRuns.get(key);
	const current = traceCache.get(key);

	// Trace-state notifications are synchronous. A consumer that refreshes while
	// the initial "running" state is announced must not restart that same run.
	if (!force && existing && current && current.status === "running" && current.version === document.version) {
		return;
	}

	if (existing) {
		clearTimeout(existing.timer);
	}

	const options = getExecutionTraceOptions(document);
	const timer = setTimeout(() => {
		pendingRuns.delete(key);
		const trace = buildExecutionTrace(document, options);

		// The document may have changed while this debounced run was pending.
		if (document.version !== trace.version) {
			scheduleExecutionTrace(document);
			return;
		}

		setTraceState(key, trace);
	}, options.debounceMs);

	pendingRuns.set(key, { timer });
	setTraceState(key, { status: "running", version: document.version, document });
}

function getExecutionTrace(document) {
	if (!document) {
		return undefined;
	}

	const trace = traceCache.get(document.uri.toString());
	return trace && trace.version === document.version ? trace : undefined;
}

function onDidChangeExecutionTrace(listener) {
	traceEvents.on("change", listener);
	return { dispose: () => traceEvents.off("change", listener) };
}

function clearExecutionTrace(document) {
	if (!document) {
		return;
	}

	const key = document.uri.toString();
	const pending = pendingRuns.get(key);

	if (pending) {
		clearTimeout(pending.timer);
		pendingRuns.delete(key);
	}

	traceCache.delete(key);
	traceEvents.emit("change", document);
}

function disposeExecutionTraceService() {
	for (const pending of pendingRuns.values()) {
		clearTimeout(pending.timer);
	}

	pendingRuns.clear();
	traceCache.clear();
	traceEvents.removeAllListeners();
}

function setTraceState(key, trace) {
	traceCache.set(key, trace);
	traceEvents.emit("change", trace.document);
}

function getExecutionTraceOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.trace", document.uri);
	return {
		debounceMs: clampInteger(config.get("debounceMs", DEFAULT_DEBOUNCE_MS), DEFAULT_DEBOUNCE_MS, 50, 5000),
		maxExecutionSteps: clampInteger(config.get("maxExecutionSteps", DEFAULT_MAX_EXECUTION_STEPS), DEFAULT_MAX_EXECUTION_STEPS, 1, 1000000),
		comparisonTolerance: clampNumber(config.get("comparisonTolerance", DEFAULT_COMPARISON_TOLERANCE), DEFAULT_COMPARISON_TOLERANCE, 0)
	};
}

function buildExecutionTrace(document, options = {}) {
	const traceOptions = {
		maxExecutionSteps: clampInteger(options.maxExecutionSteps, DEFAULT_MAX_EXECUTION_STEPS, 1, 1000000),
		comparisonTolerance: clampNumber(options.comparisonTolerance, DEFAULT_COMPARISON_TOLERANCE, 0),
		includePlaybackData: options.includePlaybackData === true,
		// The passive file-open trace only feeds health and Sense macro history.
		// Construct per-occurrence source/trace records only for an explicit
		// inspection consumer such as Vision or Playback.
		includeExecutionEntries: options.includeExecutionEntries === true || options.includePlaybackData === true
	};
	const macroAliases = buildMacroAliasMap(document);
	const context = {
		document,
		macroAliases,
		macroValues: buildInitialCommentDefaults(document, macroAliases),
		initialOverrides: new Set(),
		firstExecutableLine: findFirstExecutableGMLine(document),
		labels: buildLabelMap(document),
		loopStack: [],
		lineStates: new Map(),
		lineMacroHistories: new Map(),
		executionEntries: [],
		assumptions: new Map(),
		problems: [],
		options: traceOptions
	};
	for (const [macro, value] of Object.entries(options.initialMacroValues || {})) {
		if (Number.isFinite(Number(value))) {
			setMacroValue(context.macroValues, macro, Number(value), macroAliases);
		}
	}
	for (const [macro, value] of Object.entries(options.initialMacroOverrides || {})) {
		if (Number.isFinite(Number(value))) {
			const resolved = resolveMacroAlias(normalizeMacro(macro), macroAliases);
			context.initialOverrides.add(resolved);
			setMacroValue(context.macroValues, macro, Number(value), macroAliases);
		}
	}
	const initialMacroValues = traceOptions.includePlaybackData ? Object.fromEntries(context.macroValues) : undefined;
	let lineNumber = 0;
	let steps = 0;
	let stopReason = "complete";

	try {
		while (lineNumber < document.lineCount) {
			if (++steps > traceOptions.maxExecutionSteps) {
				addProblem(context, lineNumber, `Stopped after ${traceOptions.maxExecutionSteps} execution steps.`);
				stopReason = "capped";
				break;
			}

			const stateKey = makeExecutionStateKey(context.macroValues);
			const previousStates = context.lineStates.get(lineNumber) || new Set();
			if (previousStates.has(stateKey)) {
				addProblem(context, lineNumber, "Stopped after reaching this line again with the same macro values.");
				stopReason = "repeating";
				break;
			}
			previousStates.add(stateKey);
			context.lineStates.set(lineNumber, previousStates);

			const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
			const macroValuesBeforeLine = traceOptions.includePlaybackData ? new Map(context.macroValues) : undefined;
			const control = executeControlLine(codeLine, lineNumber, context);
			if (!control.handled) {
				applyAssignments(codeLine, lineNumber, context);
			}

			recordLineMacroValues(codeLine, lineNumber, context);
			if (traceOptions.includeExecutionEntries) {
				recordExecutionEntry(document.lineAt(lineNumber).text, codeLine, lineNumber, context, macroValuesBeforeLine);
			}

			if (control.terminal || isMacroAlarmLine(codeLine) || isProgramEndLine(codeLine)) {
				stopReason = control.terminal || isMacroAlarmLine(codeLine) ? "terminal" : "complete";
				break;
			}

			lineNumber = control.nextLine === undefined ? lineNumber + 1 : control.nextLine;
		}
	} catch (error) {
		addProblem(context, lineNumber, `Trace error: ${error.message || String(error)}`);
		stopReason = "error";
	}

	return {
		document,
		version: document.version,
		steps,
		stopReason,
		status: stopReason === "complete" ? (context.assumptions.size ? "assumed" : "ready") : stopReason,
		lineMacroHistories: context.lineMacroHistories,
		...(traceOptions.includePlaybackData ? { initialMacroValues } : {}),
		executionEntries: context.executionEntries,
		assumptions: context.assumptions,
		problems: context.problems
	};
}

function recordExecutionEntry(sourceLine, codeLine, lineNumber, context, macroValuesBeforeLine) {
	const values = {};
	for (const match of String(codeLine || "").matchAll(MACRO_REGEX)) {
		const macro = normalizeMacro(match[0]);
		const resolved = resolveMacroAlias(macro, context.macroAliases);
		const value = context.macroValues.get(resolved);
		if (Number.isFinite(value)) {
			values[macro] = value;
			values[resolved] = value;
		}
	}
	const entry = {
		lineNumber,
		sourceLine,
		traceLine: renderTraceLine(sourceLine, context),
		macroValues: values
	};
	if (context.options.includePlaybackData) {
		entry.executionIndex = context.executionEntries.length;
		entry.macroChanges = makeMacroChanges(macroValuesBeforeLine || new Map(), context.macroValues);
		entry.macroDisplayPrecisionChanges = makeMacroDisplayPrecisionChanges(codeLine, context.macroAliases);
	}
	context.executionEntries.push(entry);
}

function makeMacroChanges(before, after) {
	const macros = new Set([...before.keys(), ...after.keys()]);
	const changes = [];

	for (const macro of macros) {
		const previous = before.get(macro);
		const current = after.get(macro);
		if (previous !== current) {
			changes.push({ macro, previous: Number.isFinite(previous) ? previous : undefined, current: Number.isFinite(current) ? current : undefined });
		}
	}

	return changes;
}

function makeMacroDisplayPrecisionChanges(codeLine, macroAliases) {
	const precisionByMacro = new Map();

	for (const assignment of findAssignments(codeLine)) {
		const precision = getExplicitDecimalPrecision(assignment.value);
		const normalized = normalizeMacro(assignment.macro);
		const resolved = resolveMacroAlias(normalized, macroAliases);
		precisionByMacro.set(normalized, precision);
		precisionByMacro.set(resolved, precision);
	}

	return [...precisionByMacro].map(([macro, precision]) => ({ macro, precision }));
}

function getExplicitDecimalPrecision(expression) {
	let precision = 0;

	for (const match of String(expression || "").matchAll(/(?:\d+\.(\d*)|\.(\d+))(?:[Ee][-+]?\d+)?/g)) {
		precision = Math.max(precision, (match[1] || match[2] || "").length);
	}

	return Math.min(6, precision);
}

function renderTraceLine(line, context) {
	const text = String(line || "");
	const commentRanges = getCommentRanges(text).sort((left, right) => left.start - right.start);
	const parts = [];
	let cursor = 0;

	for (const range of commentRanges) {
		parts.push(renderTraceCodeSegment(text.slice(cursor, range.start), context));
		parts.push(text.slice(range.start, range.end + 1));
		cursor = range.end + 1;
	}

	parts.push(renderTraceCodeSegment(text.slice(cursor), context));
	return parts.join("");
}

function renderTraceCodeSegment(segment, context) {
	let result = "";
	let cursor = 0;

	while (cursor < segment.length) {
		if (segment[cursor] === "[") {
			const token = readBracketToken(segment, cursor);
			if (token) {
				const value = evaluateNumericExpression(token.text, context.macroValues, context.macroAliases);
				result += Number.isFinite(value) ? formatTraceNumber(value) : token.text;
				cursor = token.end;
				continue;
			}
		}

		result += segment[cursor++];
	}

	return result.replace(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g, macro => {
		const value = context.macroValues.get(resolveMacroAlias(macro, context.macroAliases));
		return Number.isFinite(value) ? formatTraceNumber(value) : macro;
	});
}

function formatTraceNumber(value) {
	return Number(value.toFixed(6)).toString();
}

function executeControlLine(codeLine, lineNumber, context) {
	const ifGoto = findIfGoto(codeLine);
	if (ifGoto) {
		if (evaluateCondition(ifGoto.condition, lineNumber, context)) {
			return { handled: true, nextLine: resolveTargetLabel(ifGoto.target, lineNumber, context) };
		}
		return { handled: true };
	}

	const ifThen = findIfThen(codeLine);
	if (ifThen) {
		const condition = evaluateCondition(ifThen.condition, lineNumber, context);
		if (condition) {
			applyAssignments(ifThen.body, lineNumber, context);
		}
		return { handled: true, terminal: condition && isMacroAlarmLine(ifThen.body) };
	}

	const whileStart = findWhileStart(codeLine);
	if (whileStart) {
		if (evaluateCondition(whileStart.condition, lineNumber, context)) {
			context.loopStack.push({ doNumber: whileStart.doNumber, startLine: lineNumber });
			return { handled: true };
		}
		const endLine = findMatchingEnd(context.document, lineNumber, whileStart.doNumber);
		if (endLine === undefined) {
			addProblem(context, lineNumber, `Could not find matching END${whileStart.doNumber}.`);
			return { handled: true };
		}
		return { handled: true, nextLine: endLine + 1 };
	}

	const loopEnd = findLoopEnd(codeLine);
	if (loopEnd) {
		const loop = findOpenLoop(context.loopStack, loopEnd.doNumber);
		if (!loop) {
			addProblem(context, lineNumber, `END${loopEnd.doNumber} has no active WHILE DO${loopEnd.doNumber}.`);
			return { handled: true };
		}
		context.loopStack.splice(context.loopStack.indexOf(loop), 1);
		return { handled: true, nextLine: loop.startLine };
	}

	const gotoTarget = findGoto(codeLine);
	if (gotoTarget !== undefined) {
		return { handled: true, nextLine: resolveTargetLabel(gotoTarget, lineNumber, context) };
	}

	return { handled: false };
}

function applyAssignments(codeLine, lineNumber, context) {
	for (const assignment of findAssignments(codeLine)) {
		const resolved = resolveMacroAlias(normalizeMacro(assignment.macro), context.macroAliases);
		if (lineNumber < context.firstExecutableLine && context.initialOverrides.has(resolved)) {
			continue;
		}
		const value = evaluateExpression(assignment.value, lineNumber, context);
		setMacroValue(context.macroValues, assignment.macro, value, context.macroAliases);
	}
}

function findFirstExecutableGMLine(document) {
	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		if (/(^|[^A-Za-z0-9_])[GgMm]\d+/.test(maskProtectedRanges(document.lineAt(lineNumber).text))) {
			return lineNumber;
		}
	}
	return document.lineCount;
}

function evaluateCondition(conditionText, lineNumber, context) {
	const expression = stripOuterBrackets(conditionText);
	const comparison = splitComparison(expression);
	if (!comparison) {
		return evaluateExpression(expression, lineNumber, context) !== 0;
	}
	const left = evaluateExpression(comparison.left, lineNumber, context);
	const right = evaluateExpression(comparison.right, lineNumber, context);
	return compareValues(left, right, comparison.operator, context.options.comparisonTolerance);
}

function evaluateExpression(expression, lineNumber, context) {
	assumeUnknownMacros(expression, lineNumber, context);
	const value = evaluateNumericExpression(expression, context.macroValues, context.macroAliases);
	return Number.isFinite(value) ? value : 0;
}

function assumeUnknownMacros(expression, lineNumber, context) {
	for (const match of String(expression || "").matchAll(MACRO_REGEX)) {
		const macro = normalizeMacro(match[0]);
		const resolved = resolveMacroAlias(macro, context.macroAliases);
		if (Number.isFinite(context.macroValues.get(macro)) || Number.isFinite(context.macroValues.get(resolved))) {
			continue;
		}
		setMacroValue(context.macroValues, macro, 0, context.macroAliases);
		if (!context.assumptions.has(resolved)) {
			context.assumptions.set(resolved, new Set());
		}
		context.assumptions.get(resolved).add(lineNumber);
	}
}

function recordLineMacroValues(codeLine, lineNumber, context) {
	const macros = new Set([...String(codeLine || "").matchAll(MACRO_REGEX)].map(match => normalizeMacro(match[0])));
	for (const macro of macros) {
		const resolved = resolveMacroAlias(macro, context.macroAliases);
		const value = context.macroValues.get(resolved);
		if (!Number.isFinite(value)) {
			continue;
		}
		const key = `${lineNumber}:${resolved}`;
		const history = context.lineMacroHistories.get(key) || { count: 0, values: [] };
		history.count++;
		if (history.count <= 10) {
			history.values.push(value);
		} else if (history.count === 11) {
			history.first = history.values.slice(0, 5);
			history.last = history.values.slice(-4);
			history.last.push(value);
			delete history.values;
		} else {
			history.last.shift();
			history.last.push(value);
		}
		context.lineMacroHistories.set(key, history);
	}
}

function getMacroHistory(trace, lineNumber, macro, macroAliases = new Map()) {
	if (!trace || !trace.lineMacroHistories) {
		return undefined;
	}
	const resolved = resolveMacroAlias(normalizeMacro(macro), macroAliases);
	return trace.lineMacroHistories.get(`${lineNumber}:${resolved}`);
}

function buildInitialCommentDefaults(document, macroAliases) {
	const defaults = new Map();
	for (const entry of buildAliasEntries(document)) {
		const match = String(entry.comment || "").match(/\{\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*\}\s*$/);
		if (match) {
			setMacroValue(defaults, entry.macro, Number(match[1]), macroAliases);
		}
	}
	return defaults;
}

function findAssignments(codeLine) {
	const matches = [...String(codeLine || "").matchAll(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g)];
	return matches.map((match, index) => {
		const next = matches[index + 1];
		const valueStart = match.index + match[0].length;
		const semicolon = codeLine.indexOf(";", valueStart);
		const valueEnd = Math.min(next ? next.index : codeLine.length, semicolon === -1 ? codeLine.length : semicolon);
		return { macro: normalizeMacro(match[0].match(MACRO_REGEX)[0]), value: codeLine.slice(valueStart, valueEnd).trim() };
	});
}

function findIfGoto(codeLine) {
	const statement = readConditionalStatement(codeLine, "IF");
	const match = statement && statement.rest.match(/^\s*GOTO\s*N?(\d+)/i);
	return match ? { condition: statement.condition, target: match[1] } : undefined;
}

function findIfThen(codeLine) {
	const statement = readConditionalStatement(codeLine, "IF");
	const match = statement && statement.rest.match(/^\s*THEN\s+(.+)$/i);
	return match ? { condition: statement.condition, body: match[1].trim() } : undefined;
}

function findGoto(codeLine) {
	const match = codeLine.match(/\bGOTO\s*N?(\d+)/i);
	return match ? match[1] : undefined;
}

function findWhileStart(codeLine) {
	const statement = readConditionalStatement(codeLine, "WHILE");
	const match = statement && statement.rest.match(/^\s*DO\s*(\d+)/i);
	return match ? { condition: statement.condition, doNumber: match[1] } : undefined;
}

function findLoopEnd(codeLine) {
	const match = codeLine.match(/\bEND\s*(\d+)/i);
	return match ? { doNumber: match[1] } : undefined;
}

function readConditionalStatement(codeLine, keyword) {
	const keywordMatch = codeLine.match(new RegExp(`\\b${keyword}\\b`, "i"));
	if (!keywordMatch) {
		return undefined;
	}
	const conditionStart = skipWhitespace(codeLine, keywordMatch.index + keywordMatch[0].length);
	const condition = readBracketToken(codeLine, conditionStart);
	return condition ? { condition: condition.text, rest: codeLine.slice(condition.end) } : undefined;
}

function findMatchingEnd(document, startLine, doNumber) {
	let depth = 0;
	for (let lineNumber = startLine + 1; lineNumber < document.lineCount; lineNumber++) {
		const line = maskProtectedRanges(document.lineAt(lineNumber).text);
		const nested = findWhileStart(line);
		const end = findLoopEnd(line);
		if (nested && nested.doNumber === doNumber) {
			depth++;
		} else if (end && end.doNumber === doNumber) {
			if (depth === 0) {
				return lineNumber;
			}
			depth--;
		}
	}
	return undefined;
}

function findOpenLoop(loopStack, doNumber) {
	return [...loopStack].reverse().find(loop => loop.doNumber === doNumber);
}

function buildLabelMap(document) {
	const labels = new Map();
	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const match = maskProtectedRanges(document.lineAt(lineNumber).text).match(/^\s*N(\d+)/i);
		if (match && !labels.has(String(Number(match[1])))) {
			labels.set(String(Number(match[1])), lineNumber);
		}
	}
	return labels;
}

function resolveTargetLabel(target, lineNumber, context) {
	const targetLine = context.labels.get(String(Number(target)));
	if (targetLine === undefined) {
		addProblem(context, lineNumber, `Could not find target N${target}.`);
	}
	return targetLine;
}

function splitComparison(expression) {
	const match = String(expression || "").match(/^(.*?)\b(EQ|NE|GT|GE|LT|LE)\b(.*)$/i);
	return match ? { left: match[1].trim(), operator: match[2].toUpperCase(), right: match[3].trim() } : undefined;
}

function compareValues(left, right, operator, tolerance) {
	const delta = left - right;
	return operator === "EQ" ? Math.abs(delta) <= tolerance
		: operator === "NE" ? Math.abs(delta) > tolerance
			: operator === "GT" ? delta > tolerance
				: operator === "GE" ? delta >= -tolerance
					: operator === "LT" ? delta < -tolerance
						: operator === "LE" ? delta <= tolerance : false;
}

function stripOuterBrackets(text) {
	const trimmed = String(text || "").trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;
}

function isMacroAlarmLine(codeLine) {
	return /#\s*3000\s*=/.test(codeLine);
}

function isProgramEndLine(codeLine) {
	return /\bM\s*(?:0?2|30)(?![.\d])/i.test(codeLine);
}

function readBracketToken(text, start) {
	let depth = 0;
	for (let index = start; index < text.length; index++) {
		if (text[index] === "[") depth++;
		if (text[index] === "]" && --depth === 0) return { text: text.slice(start, index + 1), end: index + 1 };
	}
	return undefined;
}

function skipWhitespace(text, index) {
	while (index < text.length && /\s/.test(text[index])) index++;
	return index;
}

function makeExecutionStateKey(macroValues) {
	return [...macroValues.entries()].filter(([, value]) => Number.isFinite(value)).sort(([a], [b]) => a.localeCompare(b)).map(([macro, value]) => `${macro}=${value}`).join("|");
}

function maskProtectedRanges(line) {
	const characters = String(line || "").split("");
	for (const range of [...getCommentRanges(line), ...getAngleBracketRanges(line)]) {
		for (let index = range.start; index <= range.end; index++) characters[index] = " ";
	}
	return characters.join("");
}

function addProblem(context, lineNumber, message) {
	const entry = { lineNumber: Math.max(0, lineNumber), message };
	if (!context.problems.some(problem => problem.lineNumber === entry.lineNumber && problem.message === entry.message)) context.problems.push(entry);
}

function clampInteger(value, fallback, min, max) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
}

function clampNumber(value, fallback, min) {
	const number = Number(value);
	return Number.isFinite(number) && number >= min ? number : fallback;
}

module.exports = {
	registerExecutionTrace,
	scheduleExecutionTrace,
	getExecutionTrace,
	onDidChangeExecutionTrace,
	buildExecutionTrace,
	getMacroHistory
};
