// Role: render the left-side KAIJU Sense cursor-state status bar. Keep motion
// interpretation in ../MetaMotionEngine.js and keep hover content in hover.js.
const vscode = require("vscode");
const {
	getModalStateAtLine,
	formatModalStateStatus
} = require("../MetaMotionEngine");
const { getSenseOptions } = require("./options");

function registerKaijuSenseStatusBar(context) {
	const statusBar = {
		plainItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90),
		coloredItems: []
	};
	statusBar.plainItem.tooltip = "KAIJU Sense modal state at cursor";
	context.subscriptions.push(statusBar.plainItem);

	const update = () => updateKaijuSenseStatusBar(statusBar, context);

	update();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.window.onDidChangeTextEditorSelection(update),
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;

			if (editor && event.document === editor.document) {
				update();
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.sense") || event.affectsConfiguration("kaijuNC.chronoblade.machineMode")) {
				update();
			}
		})
	);
}

function updateKaijuSenseStatusBar(statusBar, context) {
	const editor = vscode.window.activeTextEditor;

	if (!editor || !editor.document || editor.document.languageId !== "gcode") {
		hideKaijuSenseStatusBar(statusBar);
		return;
	}

	const options = getSenseOptions(editor.document);

	if (!options.enabled) {
		hideKaijuSenseStatusBar(statusBar);
		return;
	}

	const state = getModalStateAtLine(editor.document, editor.selection.active.line, options);
	const text = formatModalStateStatus(state, options.statusVerbose);

	if (!text) {
		hideKaijuSenseStatusBar(statusBar);
		return;
	}

	// Left-side cursor indicator: this follows program modal state at the caret,
	// not the configured KAIJU machine profile shown on the right.
	if (options.statusSyntaxColors) {
		renderColoredKaijuSenseStatusBar(statusBar, context, state, options.statusVerbose);
	} else {
		hideColoredKaijuSenseStatusBar(statusBar);
		statusBar.plainItem.text = text;
		statusBar.plainItem.show();
	}
}

function hideKaijuSenseStatusBar(statusBar) {
	statusBar.plainItem.hide();
	hideColoredKaijuSenseStatusBar(statusBar);
}

function renderColoredKaijuSenseStatusBar(statusBar, context, state, verbose) {
	const entries = state && Array.isArray(state.modalGroups) ? state.modalGroups : [];

	statusBar.plainItem.hide();
	ensureColoredStatusBarItems(statusBar, context, entries.length);

	for (let index = 0; index < statusBar.coloredItems.length; index++) {
		const item = statusBar.coloredItems[index];
		const entry = entries[index];

		if (!entry) {
			item.hide();
			continue;
		}

		item.text = verbose ? `${entry.code} (${entry.label})` : entry.code;
		item.tooltip = "KAIJU Sense modal state at cursor";
		item.color = getModalStatusColor(entry);
		item.show();
	}
}

function ensureColoredStatusBarItems(statusBar, context, count) {
	while (statusBar.coloredItems.length < count) {
		const priority = 90 - statusBar.coloredItems.length;
		const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
		statusBar.coloredItems.push(item);
		context.subscriptions.push(item);
	}
}

function hideColoredKaijuSenseStatusBar(statusBar) {
	for (const item of statusBar.coloredItems) {
		item.hide();
	}
}

function getModalStatusColor(entry) {
	if (entry.key === "motion" && entry.code === "G00") {
		return "#ff8800";
	}

	if (entry.key === "motion") {
		return "#ffd500";
	}

	if (entry.code && entry.code.startsWith("M")) {
		return "#9CDCFE";
	}

	return "#29c718";
}

module.exports = {
	registerKaijuSenseStatusBar
};
