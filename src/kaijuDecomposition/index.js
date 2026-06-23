// Role: own KAIJU Decomposition's readable execution trace for inspecting and
// debugging macro-driven G-code. Keep shared macro evaluation in
// MetaMacroEngine.js and formatting in kaijuReconstructor/formatter.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("../MetaTextRanges");
const {
	MACRO_REGEX,
	buildAliasEntries,
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
} = require("../MetaMacroEngine");
const {
	getFormattingOptions,
	formatDocumentText
} = require("../kaijuReconstructor/formatter");
const {
	DEFAULT_COMPARISON_TOLERANCE,
	getDecompositionOptions
} = require("./options");

const MAX_EXECUTION_STEPS = 20000;
const MAX_OUTPUT_LINES = 50000;

class DecompositionCancelled extends Error {}

function registerKaijuDecomposition(context) {
	context.subscriptions.push(
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

	const decomposedDocument = await vscode.workspace.openTextDocument({
		language: "gcode",
		content: result.text
	});

	await vscode.window.showTextDocument(decomposedDocument, {
		preview: false,
		viewColumn: vscode.ViewColumn.Beside
	});

	const warningText = result.warnings.length
		? ` ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} added.`
		: "";

	vscode.window.showInformationMessage(`KAIJU Decomposition opened an execution trace as a temporary document.${warningText}`);
}

async function decomposeDocument(document) {
	const sourceName = document.fileName ? document.fileName.split(/[\\/]/).pop() : document.uri.toString();
	const context = {
		document,
		macroValues: new Map(),
		assignedMacros: new Set(),
		macroAliases: buildMacroAliasMap(document),
		macroAliasLabels: buildMacroAliasLabelMap(document),
		manualInputs: new Map(),
		warnings: [],
		labels: buildLabelMap(document),
		seenOutputLabels: new Set(),
		loopStack: [],
		lineStates: new Map(),
		options: getDecompositionOptions(document)
	};
	const outputLines = [];
	let lineNumber = 0;
	let steps = 0;

	try {
		while (lineNumber < document.lineCount) {
			if (++steps > MAX_EXECUTION_STEPS) {
				addWarning(context, lineNumber, `Stopped after ${MAX_EXECUTION_STEPS} execution steps. Check for an unresolved loop or jump.`);
				break;
			}

			if (outputLines.length > MAX_OUTPUT_LINES) {
				addWarning(context, lineNumber, `Stopped after ${MAX_OUTPUT_LINES} output lines.`);
				break;
			}

			const stateKey = makeExecutionStateKey(context.macroValues);
			const previousStates = context.lineStates.get(lineNumber) || new Set();

			if (previousStates.has(stateKey)) {
				addWarning(context, lineNumber, "Stopped after reaching this line again with the same macro values. Check for an unresolved or self-repeating control-flow loop.");
				break;
			}

			previousStates.add(stateKey);
			context.lineStates.set(lineNumber, previousStates);

			const line = document.lineAt(lineNumber).text;
			const codeLine = maskProtectedRanges(line);
			const labelLine = makeFirstVisitLabelLine(line, codeLine, lineNumber, context);

			if (labelLine) {
				outputLines.push(labelLine);
			}

			const controlResult = await handleControlLine(codeLine, lineNumber, context);

			if (controlResult.cancelled) {
				return undefined;
			}

			if (controlResult.comment) {
				outputLines.push(controlResult.comment);
			}

			if (controlResult.comments) {
				outputLines.push(...controlResult.comments);
			}

			if (controlResult.nextLine !== undefined) {
				lineNumber = controlResult.nextLine;
				continue;
			}

			outputLines.push(...await variableTracker(codeLine, lineNumber, context));

			if (isOutputLine(codeLine)) {
				const decomposedLine = await decomposeLine(line, lineNumber, context);

				if (decomposedLine !== undefined && decomposedLine.trim()) {
					outputLines.push(decomposedLine);
				}
			}

			lineNumber++;
		}
	} catch (error) {
		if (error instanceof DecompositionCancelled) {
			return undefined;
		}

		throw error;
	}

	const outputText = makeOutputText(sourceName, context, outputLines);
	const formattedText = formatDocumentText(outputText, getFormattingOptions(document, { enabled: true }));

	return {
		text: formattedText,
		warnings: context.warnings
	};
}

async function handleControlLine(codeLine, lineNumber, context) {
	const ifGoto = findIfGoto(codeLine);

	if (ifGoto) {
		const condition = await evaluateCondition(ifGoto.condition, lineNumber, context);

		if (condition.cancelled) {
			return { cancelled: true };
		}

		if (condition.value) {
			const targetLine = resolveTargetLabel(ifGoto.target, lineNumber, context);

			if (targetLine !== undefined) {
				return {
					comment: makeFlowComment(lineNumber, `IF true, GOTO N${ifGoto.target}`),
					nextLine: targetLine
				};
			}
		}

		return {
			comment: makeFlowComment(lineNumber, `IF false, did not GOTO N${ifGoto.target}`)
		};
	}

	const ifThen = findIfThen(codeLine);

	if (ifThen) {
		const condition = await evaluateCondition(ifThen.condition, lineNumber, context);
		const assignmentComments = condition.value
			? await variableTracker(ifThen.body, lineNumber, context)
			: [];

		return {
			comment: makeFlowComment(lineNumber, `IF ${condition.value ? "true" : "false"}, ${condition.value ? "applied" : "skipped"} THEN ${ifThen.body}`),
			comments: assignmentComments,
			nextLine: lineNumber + 1
		};
	}

	const whileStart = findWhileStart(codeLine);

	if (whileStart) {
		const condition = await evaluateCondition(whileStart.condition, lineNumber, context);

		if (condition.cancelled) {
			return { cancelled: true };
		}

		if (condition.value) {
			context.loopStack.push({
				doNumber: whileStart.doNumber,
				startLine: lineNumber,
				condition: whileStart.condition
			});
			return {
				comment: makeFlowComment(lineNumber, `WHILE true, entering DO${whileStart.doNumber}`)
			};
		}

		const endLine = findMatchingEnd(context.document, lineNumber, whileStart.doNumber);

		if (endLine === undefined) {
			addWarning(context, lineNumber, `Could not find matching END${whileStart.doNumber}.`);
			return {};
		}

		return {
			comment: makeFlowComment(lineNumber, `WHILE false, skipped to after END${whileStart.doNumber}`),
			nextLine: endLine + 1
		};
	}

	const loopEnd = findLoopEnd(codeLine);

	if (loopEnd) {
		const loop = findOpenLoop(context.loopStack, loopEnd.doNumber);

		if (!loop) {
			addWarning(context, lineNumber, `END${loopEnd.doNumber} has no active WHILE DO${loopEnd.doNumber}.`);
			return {};
		}

		context.loopStack.splice(context.loopStack.indexOf(loop), 1);
		return {
			comment: makeFlowComment(lineNumber, `END${loopEnd.doNumber}, returning to line ${loop.startLine + 1}`),
			nextLine: loop.startLine
		};
	}

	const gotoTarget = findGoto(codeLine);

	if (gotoTarget !== undefined) {
		const targetLine = resolveTargetLabel(gotoTarget, lineNumber, context);

		if (targetLine !== undefined) {
			return {
				comment: makeFlowComment(lineNumber, `GOTO N${gotoTarget}`),
				nextLine: targetLine
			};
		}
	}

	return {};
}

async function variableTracker(codeLine, lineNumber, context) {
	const comments = [];

	for (const assignment of findAssignments(codeLine)) {
		const value = await evaluateExpression(assignment.value, lineNumber, context);
		markMacroAssigned(context, assignment.macro);
		setMacroValue(context.macroValues, assignment.macro, value, context.macroAliases);

		if (Number.isFinite(value)) {
			comments.push(makeMacroAssignmentComment(assignment, value));
		}
	}

	return comments;
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

async function evaluateCondition(conditionText, lineNumber, context) {
	await promptForUnknownMacros(conditionText, lineNumber, context);

	const expression = stripOuterBrackets(conditionText);
	const comparison = splitComparison(expression);

	if (!comparison) {
		const value = evaluateNumericExpression(expression, context.macroValues, context.macroAliases);

		return { value: Number.isFinite(value) && value !== 0 };
	}

	const left = evaluateNumericExpression(comparison.left, context.macroValues, context.macroAliases);
	const right = evaluateNumericExpression(comparison.right, context.macroValues, context.macroAliases);

	if (!Number.isFinite(left) || !Number.isFinite(right)) {
		addWarning(context, lineNumber, `Could not resolve condition [${expression}].`);
		return { value: false };
	}

	return { value: compareValues(left, right, comparison.operator, context.options.comparisonTolerance) };
}

async function evaluateExpression(expression, lineNumber, context) {
	await promptForUnknownMacros(expression, lineNumber, context);
	const value = evaluateNumericExpression(expression, context.macroValues, context.macroAliases);

	if (!Number.isFinite(value)) {
		addWarning(context, lineNumber, `Could not resolve expression ${expression}.`);
	}

	return value;
}

async function promptForUnknownMacros(expression, lineNumber, context) {
	const macros = [...String(expression || "").matchAll(MACRO_REGEX)]
		.map(match => normalizeMacro(match[0]));

	for (const macro of macros) {
		const resolvedMacro = resolveMacroAlias(macro, context.macroAliases);

		if (hasMacroValue(context.macroValues, macro, resolvedMacro)) {
			continue;
		}

		if (hasAssignedMacro(context.assignedMacros, macro, resolvedMacro)) {
			continue;
		}

		const entered = await vscode.window.showInputBox({
			title: "KAIJU Decomposition",
			prompt: `Line ${lineNumber + 1}: enter a numeric value for ${formatMacroPromptTarget(macro, resolvedMacro, context)}`,
			placeHolder: "Example: 12.5",
			validateInput: value => Number.isFinite(Number(value.trim()))
				? undefined
				: "Enter a numeric value."
		});

		if (entered === undefined) {
			throw new DecompositionCancelled();
		}

		const value = Number(entered.trim());
		setMacroValue(context.macroValues, macro, value, context.macroAliases);
		context.manualInputs.set(resolvedMacro, value);
	}

	return {};
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

function markMacroAssigned(context, macro) {
	const normalizedMacro = normalizeMacro(macro);
	const resolvedMacro = resolveMacroAlias(normalizedMacro, context.macroAliases);

	context.assignedMacros.add(normalizedMacro);
	context.assignedMacros.add(resolvedMacro);
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

function hasMacroValue(macroValues, macro, resolvedMacro) {
	return Number.isFinite(macroValues.get(macro)) || Number.isFinite(macroValues.get(resolvedMacro));
}

function hasAssignedMacro(assignedMacros, macro, resolvedMacro) {
	return assignedMacros.has(macro) || assignedMacros.has(resolvedMacro);
}

function makeExecutionStateKey(macroValues) {
	return [...macroValues.entries()]
		.filter(([, value]) => Number.isFinite(value))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([macro, value]) => `${macro}=${formatNumber(value)}`)
		.join("|");
}

function findAssignments(codeLine) {
	const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g;
	const matches = [...codeLine.matchAll(assignmentRegex)];

	return matches.map((match, index) => {
		const nextMatch = matches[index + 1];
		const valueStart = match.index + match[0].length;
		const semicolonStart = codeLine.indexOf(";", valueStart);
		const valueEnd = Math.min(
			nextMatch ? nextMatch.index : codeLine.length,
			semicolonStart === -1 ? codeLine.length : semicolonStart
		);

		return {
			macro: normalizeMacro(match[0].match(MACRO_REGEX)[0]),
			value: codeLine.slice(valueStart, valueEnd).trim()
		};
	});
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

	if (findIfGoto(codeLine) || findIfThen(codeLine) || findWhileStart(codeLine) || findLoopEnd(codeLine) || findGoto(codeLine) !== undefined) {
		return false;
	}

	return /[A-Za-z]/.test(withoutLabel);
}

function findIfGoto(codeLine) {
	const statement = readConditionalStatement(codeLine, "IF");
	const match = statement ? statement.rest.match(/^\s*GOTO\s*N?(\d+)/i) : undefined;

	return match
		? { condition: statement.condition, target: match[1] }
		: undefined;
}

function findIfThen(codeLine) {
	const statement = readConditionalStatement(codeLine, "IF");
	const match = statement ? statement.rest.match(/^\s*THEN\s+(.+)$/i) : undefined;

	return match
		? { condition: statement.condition, body: match[1].trim() }
		: undefined;
}

function findGoto(codeLine) {
	const match = codeLine.match(/\bGOTO\s*N?(\d+)/i);

	return match ? match[1] : undefined;
}

function findWhileStart(codeLine) {
	const statement = readConditionalStatement(codeLine, "WHILE");
	const match = statement ? statement.rest.match(/^\s*DO\s*(\d+)/i) : undefined;

	return match
		? { condition: statement.condition, doNumber: match[1] }
		: undefined;
}

function readConditionalStatement(codeLine, keyword) {
	const keywordMatch = codeLine.match(new RegExp(`\\b${keyword}\\b`, "i"));

	if (!keywordMatch) {
		return undefined;
	}

	const conditionStart = skipWhitespace(codeLine, keywordMatch.index + keywordMatch[0].length);
	const condition = readBracketToken(codeLine, conditionStart);

	if (!condition) {
		return undefined;
	}

	return {
		condition: condition.text,
		rest: codeLine.slice(condition.end)
	};
}

function findLoopEnd(codeLine) {
	const match = codeLine.match(/\bEND\s*(\d+)/i);

	return match ? { doNumber: match[1] } : undefined;
}

function findMatchingEnd(document, startLine, doNumber) {
	let depth = 0;

	for (let lineNumber = startLine + 1; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const nestedWhile = findWhileStart(codeLine);
		const end = findLoopEnd(codeLine);

		if (nestedWhile && nestedWhile.doNumber === doNumber) {
			depth++;
			continue;
		}

		if (end && end.doNumber === doNumber) {
			if (depth === 0) {
				return lineNumber;
			}

			depth--;
		}
	}

	return undefined;
}

function findOpenLoop(loopStack, doNumber) {
	for (let index = loopStack.length - 1; index >= 0; index--) {
		if (loopStack[index].doNumber === doNumber) {
			return loopStack[index];
		}
	}

	return undefined;
}

function buildLabelMap(document) {
	const labels = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const match = codeLine.match(/^\s*N(\d+)/i);

		if (match) {
			const label = normalizeSequenceNumber(match[1]);

			if (!labels.has(label)) {
				labels.set(label, lineNumber);
			}
		}
	}

	return labels;
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

function normalizeSequenceNumber(text) {
	return String(Number.parseInt(text, 10));
}

function resolveTargetLabel(target, lineNumber, context) {
	const targetLine = context.labels.get(normalizeSequenceNumber(target));

	if (targetLine === undefined) {
		addWarning(context, lineNumber, `Could not find target N${target}.`);
	}

	return targetLine;
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

function compareValues(left, right, operator, tolerance = DEFAULT_COMPARISON_TOLERANCE) {
	const delta = left - right;

	if (operator === "EQ") {
		return Math.abs(delta) <= tolerance;
	}

	if (operator === "NE") {
		return Math.abs(delta) > tolerance;
	}

	if (operator === "GT") {
		return delta > tolerance;
	}

	if (operator === "GE") {
		return delta >= -tolerance;
	}

	if (operator === "LT") {
		return delta < -tolerance;
	}

	if (operator === "LE") {
		return delta <= tolerance;
	}

	return false;
}

function stripOuterBrackets(text) {
	const trimmed = String(text || "").trim();

	return trimmed.startsWith("[") && trimmed.endsWith("]")
		? trimmed.slice(1, -1).trim()
		: trimmed;
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

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of protectedRanges) {
		for (let index = range.start; index <= range.end; index++) {
			characters[index] = " ";
		}
	}

	return characters.join("");
}

function addWarning(context, lineNumber, message) {
	const warning = `Line ${lineNumber + 1}: ${message}`;

	if (!context.warnings.includes(warning)) {
		context.warnings.push(warning);
	}
}

function makeFlowComment(lineNumber, message) {
	return `( KAIJU flow line ${lineNumber + 1}: ${message} )`;
}

function makeMacroAssignmentComment(assignment, value) {
	return `(${assignment.macro} = ${formatMacroAssignmentValue(assignment.value, value)})`;
}

function formatMacroAssignmentValue(rawValue, value) {
	const trimmedValue = String(rawValue || "").trim();

	if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmedValue) && Number.isFinite(Number(trimmedValue))) {
		return trimmedValue;
	}

	return formatNumber(value);
}

function makeOutputText(sourceName, context, outputLines) {
	const header = [
		"( KAIJU Decomposition )",
		`( Source: ${sourceName} )`,
		"( Macro-driven G-code execution trace for inspection and debugging. )",
		"( This is not verified machine-ready code. )"
	];

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

	return [...header, "", ...outputLines].join("\n");
}

function formatNumber(value) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	return Number(value.toFixed(6)).toString();
}

module.exports = {
	registerKaijuDecomposition
};
