// Role: own KAIJU Decomposition's readable execution trace for inspecting and
// debugging macro-driven G-code. Keep shared macro evaluation in
// MetaMacroEngine.js and formatting in kaijuReconstructor/formatter.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	maskProtectedRanges
} = require("../MetaTextRanges");
const {
	MACRO_REGEX,
	buildAliasEntries,
	buildMacroAliasMap,
	buildInitialMacroDefaults,
	evaluateNumericExpression,
	normalizeMacro,
	resolveMacroAlias
} = require("../MetaMacroEngine");
const {
	getFormattingOptions,
	formatDocumentText
} = require("../kaijuReconstructor/formatter");
const { buildExecutionTrace } = require("../MetaExecutionTrace");
const {
	getDecompositionOptions
} = require("./options");

const DECOMPOSITION_SCHEME = "kaiju-decomposition";
const decompositionDocuments = new Map();

function registerKaijuDecomposition(context) {
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DECOMPOSITION_SCHEME, {
			provideTextDocumentContent(uri) {
				return decompositionDocuments.get(uri.toString()) || "";
			}
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			if (document.uri.scheme === DECOMPOSITION_SCHEME) {
				decompositionDocuments.delete(document.uri.toString());
			}
		}),
		vscode.commands.registerCommand("kaijuNC.decompose", async () => {
			await runKaijuDecompositionCommand();
		})
	);
}

async function runKaijuDecompositionCommand() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before using KAIJU Decomposition.");
		return;
	}

	const result = await decomposeDocument(editor.document);

	if (!result) {
		return;
	}

	const sourceName = editor.document.fileName.split(/[\\/]/).pop() || "decomposition";
	const decomposedUri = vscode.Uri.from({
		scheme: DECOMPOSITION_SCHEME,
		path: `/${sourceName}.decomposition.gcode`,
		query: `${Date.now()}-${Math.random().toString(36).slice(2)}`
	});
	decompositionDocuments.set(decomposedUri.toString(), result.text);

	const decomposedDocument = await vscode.workspace.openTextDocument(decomposedUri);

	await vscode.window.showTextDocument(decomposedDocument, {
		preview: false,
		viewColumn: vscode.ViewColumn.Beside
	});

	const warningText = result.warnings.length
		? ` ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} added.`
		: "";

	vscode.window.showInformationMessage(`KAIJU Decomposition opened an execution trace as a temporary document.${warningText}`);
}

async function decomposeDocument(document, runtimeOptions = {}) {
	const sourceName = document.fileName ? document.fileName.split(/[\\/]/).pop() : document.uri.toString();
	const macroAliases = buildMacroAliasMap(document);
	const commentDefaults = buildInitialMacroDefaults(document, macroAliases);
	const options = getDecompositionOptions(document);
	const context = {
		document,
		macroValues: new Map(),
		macroAliases,
		macroAliasLabels: buildMacroAliasLabelMap(document),
		commentDefaults,
		manualInputs: new Map(),
		warnings: [],
		seenOutputLabels: new Set(),
		promptForUnknownMacros: false,
		options
	};
	const traceInputs = collectRuntimeMacroInputs(runtimeOptions, macroAliases, context.manualInputs);
	const trace = runtimeOptions.executionTrace
		|| await buildResolvedDecompositionTrace(document, runtimeOptions, traceInputs, context);
	if (!trace) return undefined;
	if (runtimeOptions.executionTrace && runtimeOptions.promptForUnknownMacros === false) {
		for (const [macro, lines] of trace.assumptions || []) {
			const lineNumber = Math.min(...lines);
			context.manualInputs.set(macro, 0);
			addWarning(context, lineNumber, `Assumed 0 for ${formatMacroPromptTarget(macro, macro, context)} while building trace line data.`);
		}
	}
	for (const problem of trace.problems || []) addWarning(context, problem.lineNumber, problem.message);

	const outputLines = [];
	const decomposedLineEntries = [];

	for (const entry of trace.executionEntries || []) {
		if (outputLines.length > options.maxOutputLines) {
			addWarning(context, entry.lineNumber, `Stopped after ${options.maxOutputLines} output lines.`);
			break;
		}
		const lineNumber = entry.lineNumber;
		const line = entry.sourceLine;
		const codeLine = entry.codeLine || maskProtectedRanges(line);
		const effectiveLine = entry.effectiveCodeLine === undefined ? line : entry.effectiveCodeLine;
		context.macroValues = new Map(Object.entries(entry.macroValues || {}));

		const labelLine = makeFirstVisitLabelLine(line, codeLine, lineNumber, context);
		if (labelLine) outputLines.push(labelLine);

		const controlComment = makeTraceControlComment(entry.control, lineNumber, context);
		if (controlComment) outputLines.push(controlComment);
		for (const assignment of entry.assignments || []) {
			outputLines.push(makeMacroAssignmentComment(
				{ macro: assignment.macro, value: assignment.value },
				assignment.resolvedValue,
				lineNumber
			));
		}

		const isControl = Boolean(entry.control) && !effectiveLine.trim();
		if (entry.termination && entry.termination.macroAlarm) {
			outputLines.push(makeFlowComment(lineNumber, "#3000 alarm, stopped execution"));
			break;
		}

		if (!isControl && isOutputLine(codeLine)) {
			const decomposedLine = await decomposeLine(effectiveLine, lineNumber, context);
			if (decomposedLine !== undefined && decomposedLine.trim()) {
				decomposedLineEntries.push({ sourceLineNumber: lineNumber, outputLineIndex: outputLines.length });
				outputLines.push(decomposedLine);
			}
		}

		if (entry.termination && entry.termination.programEnd) {
			outputLines.push(makeFlowComment(lineNumber, "Program end, stopped execution"));
			break;
		}
	}

	const outputDocumentLines = makeOutputLines(sourceName, context, outputLines);
	const outputText = outputDocumentLines.join("\n");
	const formattedText = formatDocumentText(outputText, getFormattingOptions(document, { enabled: true }));
	const formattedLines = formattedText.split(/\r?\n/);
	const outputBodyStart = outputDocumentLines.length - outputLines.length;
	const decompositionLines = decomposedLineEntries.map(entry => {
		const zeroBasedLineNumber = outputBodyStart + entry.outputLineIndex;
		return {
			sourceLineNumber: entry.sourceLineNumber,
			lineNumber: zeroBasedLineNumber + 1,
			line: formattedLines[zeroBasedLineNumber] || outputLines[entry.outputLineIndex]
		};
	});

	return {
		text: formattedText,
		warnings: context.warnings,
		decompositionLines
	};
}

function collectRuntimeMacroInputs(runtimeOptions, macroAliases, manualInputs) {
	const values = {};
	for (const source of [runtimeOptions.initialMacroValues || {}, runtimeOptions.initialMacroOverrides || {}]) {
		for (const [macro, rawValue] of Object.entries(source)) {
			const value = Number(rawValue);
			if (!Number.isFinite(value)) continue;
			const resolved = resolveMacroAlias(normalizeMacro(macro), macroAliases);
			values[resolved] = value;
			manualInputs.set(resolved, value);
		}
	}
	return values;
}

async function buildResolvedDecompositionTrace(document, runtimeOptions, traceInputs, context) {
	while (true) {
		const trace = buildExecutionTrace(document, {
			initialMacroValues: traceInputs,
			initialMacroOverrides: runtimeOptions.initialMacroOverrides,
			includeDecompositionData: true,
			maxExecutionSteps: context.options.maxExecutionSteps,
			comparisonTolerance: context.options.comparisonTolerance
		});
		const unknowns = [...trace.assumptions.entries()].filter(([macro]) => !Object.prototype.hasOwnProperty.call(traceInputs, macro));
		if (!unknowns.length) return trace;

		for (const [macro, lines] of unknowns) {
			const lineNumber = Math.min(...lines);
			if (runtimeOptions.promptForUnknownMacros === false) {
				traceInputs[macro] = 0;
				context.manualInputs.set(macro, 0);
				addWarning(context, lineNumber, `Assumed 0 for ${formatMacroPromptTarget(macro, macro, context)} while building trace line data.`);
				continue;
			}
			const entered = await vscode.window.showInputBox({
				title: "KAIJU Decomposition",
				prompt: `Line ${lineNumber + 1}: enter a numeric value for ${formatMacroPromptTarget(macro, macro, context)}`,
				placeHolder: "Example: 12.5",
				validateInput: value => Number.isFinite(Number(value.trim())) ? undefined : "Enter a numeric value."
			});
			if (entered === undefined) return undefined;
			const value = Number(entered.trim());
			traceInputs[macro] = value;
			context.manualInputs.set(macro, value);
		}
	}
}

function makeTraceControlComment(control, lineNumber, context) {
	if (!control) return undefined;
	if (["ifGoto", "ifThen", "while"].includes(control.kind)) {
		const previousValues = context.macroValues;
		context.macroValues = new Map(Object.entries(control.condition.macroValues || {}));
		const comment = makeComparisonComment(lineNumber, control.condition.text, control.condition, control.body, context);
		context.macroValues = previousValues;
		return comment;
	}
	if (control.kind === "loopEnd" && Number.isFinite(control.targetLine)) {
		return makeFlowComment(lineNumber, `END${control.doNumber}; return to L${control.targetLine + 1}`);
	}
	if (control.kind === "goto" && Number.isFinite(control.targetLine)) {
		return makeFlowComment(lineNumber, `GOTO ${control.target}`);
	}
	return undefined;
}

async function decomposeLine(line, lineNumber, context) {
	const ranges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	].sort((left, right) => left.start - right.start);
	const pieces = [];
	let cursor = 0;

	for (const range of ranges) {
		if (range.start > cursor) {
			pieces.push(await decomposeCodeSegment(line.slice(cursor, range.start), lineNumber, context));
		}

		pieces.push(line.slice(range.start, range.end + 1));
		cursor = range.end + 1;
	}

	if (cursor < line.length) {
		pieces.push(await decomposeCodeSegment(line.slice(cursor), lineNumber, context));
	}

	return pieces.join("").replace(/\s{2,}/g, " ").trimEnd();
}

async function decomposeCodeSegment(segment, lineNumber, context) {
	let text = removeAssignments(segment);
	text = removeStandaloneLabel(text);

	const replacements = [];
	let index = 0;

	while (index < text.length) {
		const addressStart = index;
		const letter = text[index];

		if (!/[A-Za-z]/.test(letter)) {
			index++;
			continue;
		}

		const valueStart = skipWhitespace(text, index + 1);
		const token = readValueToken(text, valueStart);

		if (!token) {
			index++;
			continue;
		}

		index = token.end;

		if (!needsEvaluation(token.text)) {
			continue;
		}

		const value = await evaluateExpression(token.text, lineNumber, context);

		if (Number.isFinite(value)) {
			replacements.push({
				start: addressStart,
				end: token.end,
				text: `${letter.toUpperCase()}${formatNumber(value)}`
			});
		} else {
			addWarning(context, lineNumber, `Could not resolve ${letter}${token.text}.`);
		}
	}

	return applyReplacements(text, replacements);
}

async function evaluateExpression(expression, lineNumber, context) {
	const value = evaluateNumericExpression(expression, context.macroValues, context.macroAliases);

	if (!Number.isFinite(value)) {
		addWarning(context, lineNumber, `Could not resolve expression ${expression}.`);
	}

	return value;
}

function buildMacroAliasLabelMap(document) {
	const labels = new Map();

	for (const entry of buildAliasEntries(document)) {
		const label = entry.phrase || entry.alias;

		if (!label) {
			continue;
		}

		const numericMacro = normalizeMacro(entry.macro);
		labels.set(numericMacro, label);

		if (entry.alias) {
			labels.set(normalizeMacro(`#${entry.alias}`), label);
		}
	}

	return labels;
}

function getMacroAliasLabel(macro, resolvedMacro, context) {
	const labels = context.macroAliasLabels || new Map();
	const normalizedMacro = normalizeMacro(macro);
	const normalizedResolvedMacro = normalizeMacro(resolvedMacro);

	return labels.get(normalizedMacro) || labels.get(normalizedResolvedMacro) || '';
}

function formatMacroPromptTarget(macro, resolvedMacro, context) {
	const normalizedMacro = normalizeMacro(macro);
	const normalizedResolvedMacro = normalizeMacro(resolvedMacro);
	const label = getMacroAliasLabel(normalizedMacro, normalizedResolvedMacro, context);
	const target = normalizedMacro === normalizedResolvedMacro
		? normalizedMacro
		: `${normalizedMacro} (${normalizedResolvedMacro})`;

	return label ? `${target} - ${label}` : target;
}

function skipWhitespace(text, index) {
	while (index < text.length && /\s/.test(text[index])) {
		index++;
	}

	return index;
}

function readValueToken(text, start) {
	if (start >= text.length) {
		return undefined;
	}

	if (text[start] === "[") {
		return readBracketToken(text, start);
	}

	const match = text.slice(start).match(/^[-+]?(?:#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)|\d+(?:\.\d*)?|\.\d+)/);

	return match
		? { text: match[0], start, end: start + match[0].length }
		: undefined;
}

function readBracketToken(text, start) {
	let depth = 0;

	for (let index = start; index < text.length; index++) {
		if (text[index] === "[") {
			depth++;
			continue;
		}

		if (text[index] === "]") {
			depth--;

			if (depth === 0) {
				return {
					text: text.slice(start, index + 1),
					start,
					end: index + 1
				};
			}
		}
	}

	return undefined;
}

function removeAssignments(text) {
	return text.replace(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^;]+;?/g, "");
}

function removeStandaloneLabel(text) {
	return text.replace(/^\s*N\d+\s*/i, "");
}

function isOutputLine(codeLine) {
	const withoutAssignments = removeAssignments(codeLine);
	const withoutLabel = removeStandaloneLabel(withoutAssignments);

	if (!withoutLabel.trim()) {
		return false;
	}

	return /[A-Za-z]/.test(withoutLabel);
}

function makeFirstVisitLabelLine(line, codeLine, lineNumber, context) {
	if (context.seenOutputLabels.has(lineNumber)) {
		return undefined;
	}

	const match = codeLine.match(/^\s*(N\d+)/i);

	if (!match) {
		return undefined;
	}

	context.seenOutputLabels.add(lineNumber);

	const label = match[1].toUpperCase();
	const comments = getCommentRanges(line)
		.map(range => line.slice(range.start, range.end + 1).trim())
		.filter(Boolean);

	return [label, ...comments].join(" ");
}

function splitComparison(expression) {
	const match = expression.match(/^(.*?)\b(EQ|NE|GT|GE|LT|LE)\b(.*)$/i);

	if (!match) {
		return undefined;
	}

	return {
		left: match[1].trim(),
		operator: match[2].toUpperCase(),
		right: match[3].trim()
	};
}

function splitTopLevelLogicalAnd(expression) {
	const parts = [];
	let depth = 0;
	let partStart = 0;

	for (let index = 0; index < expression.length; index++) {
		if (expression[index] === "[") {
			depth++;
			continue;
		}

		if (expression[index] === "]") {
			depth--;
			continue;
		}

		if (depth !== 0 || expression.slice(index, index + 3).toUpperCase() !== "AND") {
			continue;
		}

		const before = expression[index - 1];
		const after = expression[index + 3];

		if ((before && /[A-Za-z0-9_]/.test(before)) || (after && /[A-Za-z0-9_]/.test(after))) {
			continue;
		}

		parts.push(expression.slice(partStart, index).trim());
		partStart = index + 3;
		index += 2;
	}

	if (!parts.length) {
		return undefined;
	}

	parts.push(expression.slice(partStart).trim());
	return parts;
}

function needsEvaluation(token) {
	return token.includes("#") || token.includes("[");
}

function applyReplacements(text, replacements) {
	let result = text;

	for (let index = replacements.length - 1; index >= 0; index--) {
		const replacement = replacements[index];
		result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
	}

	return result;
}

function addWarning(context, lineNumber, message) {
	const warning = `Line ${lineNumber + 1}: ${message}`;

	if (!context.warnings.includes(warning)) {
		context.warnings.push(warning);
	}
}

function makeFlowComment(lineNumber, message) {
	return `(/flow L${lineNumber + 1}: ${message})`;
}

function makeComparisonComment(lineNumber, conditionText, condition, action, context) {
	const details = describeCondition(conditionText, context);
	const result = condition.value ? "TRUE" : "FALSE";

	return `(/comparison L${lineNumber + 1}: ${[details, result, action].filter(Boolean).join("; ")})`;
}

function describeCondition(conditionText, context) {
	const expression = stripOuterDisplayBrackets(conditionText);
	const values = getConditionMacroValues(expression, context);
	const test = describeConditionTest(expression, context);

	return [values.join(", "), test].filter(Boolean).join("; ");
}

function getConditionMacroValues(expression, context) {
	const macros = new Set();

	for (const match of String(expression || "").matchAll(MACRO_REGEX)) {
		macros.add(normalizeMacro(match[0]));
	}

	return [...macros].map(macro => {
		const value = evaluateNumericExpression(macro, context.macroValues, context.macroAliases);
		return Number.isFinite(value) ? `${macro}=${formatNumber(value)}` : macro;
	});
}

function describeConditionTest(expression, context) {
	const normalizedExpression = stripOuterDisplayBrackets(expression);
	const andParts = splitTopLevelLogicalAnd(normalizedExpression);

	if (andParts) {
		return andParts.map(part => describeConditionTest(part, context)).join(" AND ");
	}

	const comparison = splitComparison(normalizedExpression);

	if (!comparison) {
		const value = evaluateNumericExpression(normalizedExpression, context.macroValues, context.macroAliases);
		return Number.isFinite(value) ? formatNumber(value) : normalizedExpression;
	}

	const left = evaluateNumericExpression(comparison.left, context.macroValues, context.macroAliases);
	const right = evaluateNumericExpression(comparison.right, context.macroValues, context.macroAliases);
	const leftText = Number.isFinite(left) ? formatNumber(left) : comparison.left;
	const rightText = Number.isFinite(right) ? formatNumber(right) : comparison.right;

	return `${leftText} ${comparison.operator} ${rightText}`;
}

function stripOuterDisplayBrackets(text) {
	const trimmed = String(text || "").trim();
	const outerToken = trimmed.startsWith("[") ? readBracketToken(trimmed, 0) : undefined;

	return outerToken && outerToken.end === trimmed.length
		? trimmed.slice(1, -1).trim()
		: trimmed;
}

function makeMacroAssignmentComment(assignment, value, lineNumber) {
	return `(/assignment L${lineNumber + 1}: ${assignment.macro} = ${formatMacroAssignmentValue(assignment.value, value)})`;
}

function formatMacroAssignmentValue(rawValue, value) {
	const trimmedValue = String(rawValue || "").trim();

	if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmedValue) && Number.isFinite(Number(trimmedValue))) {
		return trimmedValue;
	}

	return formatNumber(value);
}

function makeOutputLines(sourceName, context, outputLines) {
	const header = [
		"( KAIJU Decomposition )",
		`( Source: ${sourceName} )`,
		"( Macro-driven G-code execution trace for inspection and debugging. )",
		"( This is not verified machine-ready code. )"
	];

	if (context.commentDefaults.size) {
		header.push("( Comment defaults: )");

		for (const [macro, value] of context.commentDefaults) {
			header.push(`( ${macro} = ${formatNumber(value)} )`);
		}
	}

	if (context.manualInputs.size) {
		header.push("( Manual inputs: )");

		for (const [macro, value] of context.manualInputs) {
			header.push(`( ${macro} = ${formatNumber(value)} )`);
		}
	}


	if (context.warnings.length) {
		header.push("( Warnings: )");

		for (const warning of context.warnings) {
			header.push(`( ${warning} )`);
		}
	}

	return [...header, "", ...outputLines];
}

function formatNumber(value) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	return Number(value.toFixed(6)).toString();
}

module.exports = {
	registerKaijuDecomposition,
	decomposeDocument
};
