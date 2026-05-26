const vscode = require("vscode");
const { TOOL_COLORS, getToolRanges } = require("./toolModel");

function registerToolDecorations(context) {
	const decorationTypes = TOOL_COLORS.map(color => {
		const decorationType = vscode.window.createTextEditorDecorationType({
			gutterIconPath: makeToolMarkerUri(color),
			gutterIconSize: "contain",
			overviewRulerColor: color,
			overviewRulerLane: vscode.OverviewRulerLane.Left
		});

		context.subscriptions.push(decorationType);
		return decorationType;
	});

	let pendingUpdate;

	const scheduleUpdate = () => {
		clearTimeout(pendingUpdate);
		pendingUpdate = setTimeout(() => {
			updateVisibleToolDecorations(decorationTypes);
		}, 100);
	};

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(scheduleUpdate),
		vscode.window.onDidChangeVisibleTextEditors(scheduleUpdate),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) {
				scheduleUpdate();
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.syntax.toolDecorations.enabled")) {
				scheduleUpdate();
			}
		}),
		{
			dispose() {
				clearTimeout(pendingUpdate);
			}
		}
	);

	updateVisibleToolDecorations(decorationTypes);
}

function updateVisibleToolDecorations(decorationTypes) {
	for (const editor of vscode.window.visibleTextEditors) {
		updateToolDecorations(editor, decorationTypes);
	}
}

function updateToolDecorations(editor, decorationTypes) {
	const groupedDecorations = decorationTypes.map(() => []);

	if (editor.document.languageId === "gcode" && areToolDecorationsEnabled(editor.document)) {
		for (const range of getToolRanges(editor.document)) {
			for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
				groupedDecorations[range.colorIndex].push({
					range: new vscode.Range(lineNumber, 0, lineNumber, 0)
				});
			}
		}
	}

	for (let i = 0; i < decorationTypes.length; i++) {
		editor.setDecorations(decorationTypes[i], groupedDecorations[i]);
	}
}

function areToolDecorationsEnabled(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.syntax", document.uri);

	return config.get("toolDecorations.enabled", true);
}

function makeToolMarkerUri(color) {
	const svg = [
		"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"16\" viewBox=\"0 0 12 16\">",
		`<rect x="4" y="0" width="4" height="16" rx="1" fill="${color}" fill-opacity="0.82"/>`,
		"</svg>"
	].join("");

	return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

module.exports = {
	registerToolDecorations
};
