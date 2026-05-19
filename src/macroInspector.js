const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");

const MAX_LOOP_EVENTS = 40;
const MAX_LOOP_ITERATIONS = 10000;
const MAX_RECORDED_ASSIGNMENTS = 500;
const MAX_EXECUTION_DEPTH = 20;

let inspectorPanel;
let inspectorState;

function registerMacroInspector(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.inspectMacro", async (macro, documentUriText) => {
			await openMacroInspector(macro, documentUriText);
		})
	);
}

async function openMacroInspector(macro, documentUriText) {
	const document = await resolveDocument(documentUriText);

	if (!document || document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before inspecting a macro.");
		return;
	}

	inspectorState = {
		macro,
		documentUriText: document.uri.toString(),
		manualValues: inspectorState ? inspectorState.manualValues : {}
	};

	if (!inspectorPanel) {
		inspectorPanel = vscode.window.createWebviewPanel(
			"kaijuMacroInspector",
			`Inspect ${macro}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		inspectorPanel.onDidDispose(() => {
			inspectorPanel = undefined;
			inspectorState = undefined;
		});

		inspectorPanel.webview.onDidReceiveMessage(async message => {
			if (message && message.type === "refresh" && inspectorState) {
				await refreshInspector();
			}

			if (message && message.type === "setManualValue" && inspectorState) {
				setManualValue(message.macro, message.value);
				await refreshInspector();
			}
		});
	} else {
		inspectorPanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderInspector(document, macro);
}

async function refreshInspector() {
	const document = await resolveDocument(inspectorState.documentUriText);

	if (!document) {
		return;
	}

	await renderInspector(document, inspectorState.macro);
}

async function resolveDocument(documentUriText) {
	if (documentUriText) {
		return vscode.workspace.openTextDocument(vscode.Uri.parse(documentUriText));
	}

	const editor = vscode.window.activeTextEditor;
	return editor ? editor.document : undefined;
}

async function renderInspector(document, macro) {
	const inspection = buildMacroInspection(
		document,
		macro,
		inspectorState ? inspectorState.manualValues : {}
	);

	inspectorPanel.title = `Inspect ${macro}`;
	inspectorPanel.webview.html = renderInspectorHtml(inspection);
}

function setManualValue(macro, rawValue) {
	const normalizedMacro = normalizeMacroName(macro);
	const value = Number(rawValue);

	if (!normalizedMacro) {
		return;
	}

	if (!String(rawValue).trim() || !Number.isFinite(value)) {
		delete inspectorState.manualValues[normalizedMacro];
		return;
	}

	inspectorState.manualValues[normalizedMacro] = value;
}

function buildMacroInspection(document, macro, manualValues = {}) {
	const lines = getExecutableLines(document);
	const state = {
		assignments: [],
		references: [],
		notices: [],
		values: createManualValueMap(manualValues),
		valueDependencies: new Map(),
		assignedMacros: new Set(),
		relevantMacros: new Set(),
		missingRelevantMacros: new Set(),
		manualValues,
		targetMacro: macro.toUpperCase(),
		macroPattern: new RegExp(`${escapeRegex(macro)}(?![A-Za-z0-9_])`, "gi")
	};

	executeRange(lines, 0, lines.length, state, []);

	return {
		macro,
		documentName: document.fileName || document.uri.toString(),
		assignments: state.assignments,
		references: state.references,
		notices: state.notices,
		macroValues: buildMacroValueRows(state),
		finalValue: state.assignments.length ? state.assignments[state.assignments.length - 1].value : ""
	};
}

function createManualValueMap(manualValues) {
	const values = new Map();

	for (const [macro, value] of Object.entries(manualValues)) {
		const number = Number(value);

		if (Number.isFinite(number)) {
			values.set(normalizeMacroName(macro), number);
		}
	}

	return values;
}

function buildMacroValueRows(state) {
	const macros = new Set([
		...state.relevantMacros,
		...state.missingRelevantMacros
	]);

	return [...macros]
		.filter(macro => macro !== state.targetMacro)
		.sort(compareMacroNames)
		.map(macro => {
			const value = state.values.get(macro);

			return {
				macro,
				value: Number.isFinite(value) ? formatNumber(value) : "",
				missing: !Number.isFinite(value),
				assigned: state.assignedMacros.has(macro),
				manual: Object.prototype.hasOwnProperty.call(state.manualValues, macro),
				manualValue: Object.prototype.hasOwnProperty.call(state.manualValues, macro)
					? formatNumber(Number(state.manualValues[macro]))
					: ""
			};
		});
}

function getExecutableLines(document) {
	const lines = [];

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const rawLine = document.lineAt(lineNumber).text;

		lines.push({
			lineNumber,
			rawLine,
			codeLine: maskProtectedRanges(rawLine)
		});
	}

	return lines;
}

function executeRange(lines, startIndex, endIndex, state, loopStack, depth = 0) {
	if (depth > MAX_EXECUTION_DEPTH) {
		state.notices.push("Loop nesting was too deep to inspect completely.");
		return;
	}

	for (let index = startIndex; index < endIndex; index++) {
		const line = lines[index];
		const loopStart = getLoopStart(line.codeLine);

		if (loopStart) {
			const loopEndIndex = findLoopEndIndex(lines, index, loopStart.id);

			if (loopEndIndex === -1) {
				state.notices.push(`Line ${line.lineNumber + 1}: DO${loopStart.id} has no matching END${loopStart.id}.`);
				processExecutableLine(line, state, loopStack);
				continue;
			}

			let iteration = 0;

			while (evaluateLoopCondition(loopStart.condition, state.values)) {
				iteration++;

				if (iteration > MAX_LOOP_ITERATIONS) {
					state.notices.push(`Line ${line.lineNumber + 1}: DO${loopStart.id} stopped after ${MAX_LOOP_ITERATIONS} simulated iterations.`);
					break;
				}

				executeRange(
					lines,
					index + 1,
					loopEndIndex,
					state,
					[
						...loopStack,
						{
							id: loopStart.id,
							iteration,
							startLine: line.lineNumber
						}
					],
					depth + 1
				);
			}

			index = loopEndIndex;
			continue;
		}

		processExecutableLine(line, state, loopStack);
	}
}

function processExecutableLine(line, state, loopStack) {
	for (const reference of findMacroReferences(line.codeLine, state.macroPattern)) {
		state.references.push({
			lineNumber: line.lineNumber,
			column: reference.index,
			lineText: line.rawLine,
			loopStack: cloneLoopStack(loopStack)
		});
	}

	for (const assignment of findAssignments(line.codeLine)) {
		const dependencies = getExpressionDependencies(assignment.value, state);
		const numericValue = evaluateNumericExpression(assignment.value, state.values);

		if (assignment.macro === state.targetMacro) {
			trackRelevantDependencies(dependencies, state);
			recordAssignment(line, assignment, numericValue, state, loopStack);
		}

		if (Number.isFinite(numericValue)) {
			state.values.set(assignment.macro, numericValue);
		} else {
			state.values.delete(assignment.macro);
		}

		state.valueDependencies.set(assignment.macro, dependencies);
		state.assignedMacros.add(assignment.macro);
	}
}

function getExpressionDependencies(expression, state) {
	const dependencies = new Set();

	for (const macro of extractMacros(expression)) {
		dependencies.add(macro);

		for (const upstreamMacro of state.valueDependencies.get(macro) || []) {
			dependencies.add(upstreamMacro);
		}
	}

	return dependencies;
}

function trackRelevantDependencies(dependencies, state) {
	for (const macro of dependencies) {
		state.relevantMacros.add(macro);

		if (!state.values.has(macro) && !state.assignedMacros.has(macro)) {
			state.missingRelevantMacros.add(macro);
		}
	}
}

function recordAssignment(line, assignment, numericValue, state, loopStack) {
	if (state.assignments.length >= MAX_RECORDED_ASSIGNMENTS) {
		const lastEvent = state.assignments[state.assignments.length - 1];

		if (lastEvent) {
			lastEvent.truncated = true;
		}

		return;
	}

	state.assignments.push({
		lineNumber: line.lineNumber,
		lineText: line.rawLine,
		expression: assignment.value,
		value: Number.isFinite(numericValue) ? formatNumber(numericValue) : assignment.value,
		loopStack: cloneLoopStack(loopStack),
		isLooped: loopStack.length > 0,
		truncated: false,
		label: formatEventLabel(line.lineNumber, loopStack)
	});
}

function formatEventLabel(lineNumber, loopStack) {
	if (!loopStack.length) {
		return `Line ${lineNumber + 1}`;
	}

	return `Line ${lineNumber + 1}(${loopStack.map(loop => loop.iteration).join(".")})`;
}

function cloneLoopStack(loopStack) {
	return loopStack.map(loop => ({ ...loop }));
}

function formatAssignedValue(value, numericValues) {
	const numericValue = evaluateNumericExpression(value, numericValues);

	if (Number.isFinite(numericValue)) {
		return formatNumber(numericValue);
	}

	return value;
}

function getLoopIterationCount(loopStack) {
	if (!loopStack.length) {
		return 0;
	}

	let count = 1;

	for (const loop of loopStack) {
		if (!loop.iterationCount) {
			return 0;
		}

		count *= loop.iterationCount;

		if (count > MAX_LOOP_EVENTS) {
			return count;
		}
	}

	return count;
}

function inferLoopIterationCount(document, startLine, loopStart, numericValues) {
	const condition = parseLoopCondition(loopStart.condition);

	if (!condition) {
		return 0;
	}

	const startValue = numericValues.get(condition.macro);

	if (!Number.isFinite(startValue)) {
		return 0;
	}

	const endLine = findLoopEndLine(document, startLine, loopStart.id);

	if (endLine === -1) {
		return 0;
	}

	const increment = findLoopIncrement(document, startLine + 1, endLine, condition.macro);

	if (!Number.isFinite(increment) || increment === 0) {
		return 0;
	}

	return calculateLoopIterations(startValue, condition.operator, condition.limit, increment);
}

function findLoopEndIndex(lines, startIndex, loopId) {
	let depth = 0;

	for (let index = startIndex + 1; index < lines.length; index++) {
		const nestedStart = getLoopStart(lines[index].codeLine);

		if (nestedStart && nestedStart.id === loopId) {
			depth++;
		}

		for (const endId of getLoopEndIds(lines[index].codeLine)) {
			if (endId !== loopId) {
				continue;
			}

			if (depth === 0) {
				return index;
			}

			depth--;
		}
	}

	return -1;
}

function evaluateLoopCondition(conditionText, numericValues) {
	const match = conditionText.match(/(.+?)\s*(EQ|NE|GE|LE|GT|LT|>=|<=|<>|>|<|=)\s*(.+)/i);

	if (!match) {
		return false;
	}

	const left = evaluateNumericExpression(match[1], numericValues);
	const operator = normalizeOperator(match[2]);
	const right = evaluateNumericExpression(match[3], numericValues);

	if (!Number.isFinite(left) || !Number.isFinite(right)) {
		return false;
	}

	if (operator === "=") {
		return left === right;
	}

	if (operator === "<>" || operator === "!=") {
		return left !== right;
	}

	return testLoopCondition(left, operator, right);
}

function parseLoopCondition(conditionText) {
	const match = conditionText.match(/(#(?:\d+|[A-Za-z_][A-Za-z0-9_]*))\s*(LT|LE|GT|GE|<|<=|>|>=)\s*(-?\d+(?:\.\d*)?|-?\.\d+)/i);

	if (!match) {
		return undefined;
	}

	return {
		macro: match[1].toUpperCase(),
		operator: normalizeOperator(match[2]),
		limit: Number(match[3])
	};
}

function normalizeOperator(operator) {
	const upperOperator = operator.toUpperCase();

	if (upperOperator === "LT") {
		return "<";
	}

	if (upperOperator === "LE") {
		return "<=";
	}

	if (upperOperator === "GT") {
		return ">";
	}

	if (upperOperator === "GE") {
		return ">=";
	}

	if (upperOperator === "EQ") {
		return "=";
	}

	if (upperOperator === "NE") {
		return "<>";
	}

	return operator;
}

function calculateLoopIterations(startValue, operator, limit, increment) {
	let value = startValue;
	let count = 0;

	while (testLoopCondition(value, operator, limit)) {
		count++;
		value += increment;

		if (count > 10000) {
			return 0;
		}
	}

	return count;
}

function testLoopCondition(value, operator, limit) {
	if (operator === "<") {
		return value < limit;
	}

	if (operator === "<=") {
		return value <= limit;
	}

	if (operator === ">") {
		return value > limit;
	}

	if (operator === ">=") {
		return value >= limit;
	}

	return false;
}

function findLoopEndLine(document, startLine, loopId) {
	let depth = 0;

	for (let lineNumber = startLine + 1; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const nestedStart = getLoopStart(codeLine);

		if (nestedStart && nestedStart.id === loopId) {
			depth++;
		}

		for (const endId of getLoopEndIds(codeLine)) {
			if (endId !== loopId) {
				continue;
			}

			if (depth === 0) {
				return lineNumber;
			}

			depth--;
		}
	}

	return -1;
}

function findLoopIncrement(document, startLine, endLine, macro) {
	const escapedMacro = escapeRegex(macro);
	const incrementRegex = new RegExp(`${escapedMacro}\\s*=\\s*${escapedMacro}\\s*([+-])\\s*(-?\\d+(?:\\.\\d*)?|-?\\.\\d+)`, "i");

	for (let lineNumber = startLine; lineNumber < endLine; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		const match = codeLine.match(incrementRegex);

		if (match) {
			const amount = Number(match[2]);
			return match[1] === "-" ? -amount : amount;
		}
	}

	return 0;
}

function getLoopStart(line) {
	const match = line.match(/\bWHILE\s*\[([^\]]+)\]\s*DO(\d+)\b/i);

	if (!match) {
		return undefined;
	}

	return {
		condition: match[1].trim(),
		id: match[2]
	};
}

function getLoopEndIds(line) {
	return [...line.matchAll(/\bEND(\d+)\b/gi)].map(match => match[1]);
}

function findLastLoopIndex(loopStack, loopId) {
	for (let i = loopStack.length - 1; i >= 0; i--) {
		if (loopStack[i].id === loopId) {
			return i;
		}
	}

	return -1;
}

function findAssignments(line) {
	const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g;
	const matches = [...line.matchAll(assignmentRegex)];

	return matches.map((match, index) => {
		const nextMatch = matches[index + 1];
		const valueStart = match.index + match[0].length;
		const semicolonStart = line.indexOf(";", valueStart);
		const valueEndCandidates = [
			nextMatch ? nextMatch.index : line.length,
			semicolonStart === -1 ? line.length : semicolonStart
		];
		const valueEnd = Math.min(...valueEndCandidates);

		return {
			macro: match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0].toUpperCase(),
			value: line.slice(valueStart, valueEnd).trim(),
			index: match.index
		};
	});
}

function findMacroReferences(line, macroPattern) {
	const references = [];
	let match;

	macroPattern.lastIndex = 0;

	while ((match = macroPattern.exec(line)) !== null) {
		references.push({
			index: match.index
		});
	}

	return references;
}

function extractMacros(expression) {
	const macros = [];
	const macroRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g;
	let match;

	while ((match = macroRegex.exec(expression)) !== null) {
		macros.push(normalizeMacroName(match[0]));
	}

	return macros;
}

function evaluateNumericExpression(expression, numericValues) {
	let jsExpression = expression
		.replace(/\[/g, "(")
		.replace(/\]/g, ")")
		.replace(/\bMOD\b/gi, "%")
		.replace(/\b(?:EQ|NE|GT|GE|LT|LE|AND|OR|XOR)\b/gi, "")
		.replace(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g, macro => {
			const normalizedMacro = normalizeMacroName(macro);
			const value = numericValues.get(normalizedMacro);

			if (Number.isFinite(value)) {
				return String(value);
			}

			return "NaN";
		});

	if (jsExpression.includes("NaN")) {
		return NaN;
	}

	if (!/^[\d+\-*/%().\s]+$/.test(jsExpression)) {
		return NaN;
	}

	try {
		const value = Function(`"use strict"; return (${jsExpression});`)();
		return Number.isFinite(value) ? value : NaN;
	} catch {
		return NaN;
	}
}

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of protectedRanges) {
		for (let i = range.start; i <= range.end; i++) {
			characters[i] = " ";
		}
	}

	return characters.join("");
}

function renderInspectorHtml(inspection) {
	const assignmentRows = inspection.assignments.length
		? inspection.assignments.map(renderAssignmentRow).join("")
		: "<p class=\"empty\">No assignments found for this macro.</p>";
	const referenceRows = inspection.references.length
		? inspection.references.map(renderReferenceRow).join("")
		: "<p class=\"empty\">No references found for this macro.</p>";
	const macroValueRows = inspection.macroValues.length
		? inspection.macroValues.map(renderMacroValueRow).join("")
		: "<p class=\"empty\">No dependent macro values found.</p>";
	const noticeRows = inspection.notices.length
		? `<section><h2>Notes</h2>${inspection.notices.map(notice => `<p class="note">${escapeHtml(notice)}</p>`).join("")}</section>`
		: "";

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
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			padding-bottom: 12px;
			margin-bottom: 16px;
		}

		h1 {
			font-size: 18px;
			margin: 0;
		}

		h2 {
			font-size: 13px;
			text-transform: uppercase;
			margin: 20px 0 8px;
			color: var(--vscode-descriptionForeground);
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

		input {
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
			padding: 5px 7px;
			min-width: 80px;
		}

		.meta {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			margin: 4px 0 0;
			word-break: break-all;
		}

		.item {
			border-left: 3px solid var(--vscode-textLink-foreground);
			padding: 8px 0 8px 10px;
			margin: 0 0 10px;
		}

		.item.looped {
			border-left-color: var(--vscode-charts-yellow);
		}

		.value-row {
			display: grid;
			grid-template-columns: minmax(64px, 1fr) auto;
			gap: 8px;
			align-items: center;
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 8px 0;
		}

		.value-actions {
			display: flex;
			gap: 6px;
			align-items: center;
		}

		.label {
			font-weight: 700;
			margin-bottom: 4px;
		}

		code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 1px 4px;
			border-radius: 3px;
		}

		pre {
			white-space: pre-wrap;
			word-break: break-word;
			margin: 6px 0 0;
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
		}

		.empty,
		.note {
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<header>
		<div>
			<h1>${escapeHtml(inspection.macro)}</h1>
			<p class="meta">${escapeHtml(inspection.documentName)}</p>
		</div>
		<button id="refresh">Refresh</button>
	</header>

	<section>
		<h2>Macro Values Used</h2>
		${macroValueRows}
	</section>

	<section>
		<h2>Assignment History</h2>
		${assignmentRows}
	</section>

	<section>
		<h2>References</h2>
		${referenceRows}
	</section>

	${noticeRows}

	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById("refresh").addEventListener("click", () => {
			vscode.postMessage({ type: "refresh" });
		});

		document.querySelectorAll("[data-save-macro]").forEach(button => {
			button.addEventListener("click", () => {
				const macro = button.getAttribute("data-save-macro");
				const input = document.querySelector("[data-macro-input='" + macro + "']");
				vscode.postMessage({
					type: "setManualValue",
					macro,
					value: input ? input.value : ""
				});
			});
		});

		document.querySelectorAll("[data-macro-input]").forEach(input => {
			input.addEventListener("keydown", event => {
				if (event.key === "Enter") {
					const macro = input.getAttribute("data-macro-input");
					vscode.postMessage({
						type: "setManualValue",
						macro,
						value: input.value
					});
				}
			});
		});
	</script>
</body>
</html>`;
}

function renderMacroValueRow(row) {
	const valueText = row.missing
		? "Unknown"
		: row.value;
	const manualText = row.manual
		? "manual"
		: row.assigned ? "calculated from program" : "needs manual value";
	const actions = row.assigned && !row.manual
		? ""
		: `<div class="value-actions">
			<input data-macro-input="${escapeHtml(row.macro)}" value="${escapeHtml(row.manualValue)}" placeholder="value">
			<button data-save-macro="${escapeHtml(row.macro)}">Apply</button>
		</div>`;

	return `<div class="value-row">
		<div>
			<div class="label">${escapeHtml(row.macro)}: <code>${escapeHtml(valueText)}</code></div>
			<div class="meta">${escapeHtml(manualText)}</div>
		</div>
		${actions}
	</div>`;
}

function renderAssignmentRow(event) {
	const loopText = event.loopStack.length
		? `<div class="meta">Loop: ${escapeHtml(event.loopStack.map(loop => `DO${loop.id}`).join(" > "))}</div>`
		: "";
	const expressionText = event.expression && event.expression !== event.value
		? `<div class="meta">Expression: <code>${escapeHtml(event.expression)}</code></div>`
		: "";
	const truncatedText = event.truncated
		? "<div class=\"note\">More loop iterations exist; display capped for readability.</div>"
		: "";

	return `<div class="item${event.isLooped ? " looped" : ""}">
		<div class="label">${escapeHtml(event.label)}: <code>${escapeHtml(event.value || "No value found")}</code></div>
		${expressionText}
		${loopText}
		<pre>${escapeHtml(event.lineText.trim())}</pre>
		${truncatedText}
	</div>`;
}

function renderReferenceRow(reference) {
	const loopText = reference.loopStack.length
		? ` <span class="meta">(${escapeHtml(reference.loopStack.map(loop => `DO${loop.id}`).join(" > "))})</span>`
		: "";

	return `<div class="item">
		<div class="label">Line ${reference.lineNumber + 1}${loopText}</div>
		<pre>${escapeHtml(reference.lineText.trim())}</pre>
	</div>`;
}

function formatNumber(value) {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function normalizeMacroName(macro) {
	if (typeof macro !== "string") {
		return "";
	}

	const trimmedMacro = macro.trim().toUpperCase();
	return trimmedMacro.startsWith("#") ? trimmedMacro : `#${trimmedMacro}`;
}

function compareMacroNames(left, right) {
	const leftNumber = Number(left.slice(1));
	const rightNumber = Number(right.slice(1));

	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
		return leftNumber - rightNumber;
	}

	return left.localeCompare(right);
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

module.exports = {
	registerMacroInspector,
	buildMacroInspection
};
