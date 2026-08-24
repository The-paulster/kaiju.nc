// Role: present passive execution-trace health in the right-side status bar.
// Trace execution and storage remain in MetaExecutionTrace.js.
const vscode = require("vscode");
const {
	getExecutionTrace,
	onDidChangeExecutionTrace,
	scheduleExecutionTrace
} = require("../MetaExecutionTrace");

function registerKaijuTraceStatusBar(context) {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 88);
	context.subscriptions.push(item);

	const update = () => updateKaijuTraceStatusBar(item);
	update();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		onDidChangeExecutionTrace(update)
	);
}

function updateKaijuTraceStatusBar(item) {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !editor.document || editor.document.languageId !== "gcode") {
		item.hide();
		return;
	}

	const document = editor.document;
	const trace = getExecutionTrace(document);
	if (!trace || trace.status === "running") {
		scheduleExecutionTrace(document);
		item.text = "KAIJU Trace: running";
		item.color = "#DCDCAA";
		item.tooltip = "KAIJU Trace is waiting for the document to settle.";
		item.show();
		return;
	}

	if (trace.status === "ready") {
		item.text = "KAIJU Trace: ready";
		item.color = undefined;
		item.tooltip = `KAIJU Trace completed ${trace.steps} execution steps.`;
		item.show();
		return;
	}

	item.text = getTraceLabel(trace);
	item.color = trace.status === "assumed" ? "#DCDCAA" : "#ff8800";
	item.tooltip = makeTraceTooltipMarkdown(trace);
	item.show();
}

function getTraceLabel(trace) {
	if (trace.status === "assumed") {
		return `KAIJU Trace: ${trace.assumptions.size} assumed zero`;
	}
	if (trace.status === "capped") {
		return "KAIJU Trace: step cap";
	}
	if (trace.status === "repeating") {
		return "KAIJU Trace: repeating";
	}
	return "KAIJU Trace: problem";
}

function makeTraceTooltip(trace) {
	const lines = [`KAIJU Trace completed ${trace.steps} execution steps.`];
	if (trace.assumptions.size) {
		lines.push("", "Assumed-zero macros:");
		for (const [macro, occurrences] of trace.assumptions) {
			lines.push(`${macro}: ${formatLineNumbers(occurrences)}`);
		}
		lines.push("", "Tip: To set an assumed default for a macro variable, add a header comment such as (#100 {3.000}) before the first executable G/M block.");
	}
	if (trace.problems.length) {
		lines.push("", "Trace problems:");
		for (const problem of trace.problems) {
			lines.push(`Line ${problem.lineNumber + 1}: ${problem.message}`);
		}
	}
	return lines.join("\n");
}

function makeTraceTooltipMarkdown(trace) {
	const plainText = makeTraceTooltip(trace);
	const tipIndex = plainText.indexOf("\n\nTip: ");

	if (tipIndex === -1) {
		return plainText;
	}

	const tooltip = new vscode.MarkdownString();
	tooltip.appendText(plainText.slice(0, tipIndex));
	tooltip.appendMarkdown(`\n\n*${plainText.slice(tipIndex + 2)}*`);
	return tooltip;
}

function formatLineNumbers(occurrences) {
	return [...occurrences].map(lineNumber => `L${lineNumber + 1}`).join(", ");
}

module.exports = {
	registerKaijuTraceStatusBar,
	makeTraceTooltip
};
