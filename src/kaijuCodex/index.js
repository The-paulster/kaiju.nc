// Role: open packaged, user-facing KAIJU Codex Markdown in VS Code's preview.
const vscode = require("vscode");

const TOPICS = Object.freeze({
	alerts: "alerts.md",
	alias: "alias.md",
	chronoblade: "chronoblade.md",
	conditionals: "conditionals.md",
	decomposition: "decomposition.md",
	machineMode: "machine-mode.md",
	reconstructor: "reconstructor.md",
	sections: "sections.md",
	sense: "sense.md",
	syntax: "syntax.md",
	vision: "vision.md"
});

function registerKaijuCodex(context) {
	context.subscriptions.push(vscode.commands.registerCommand("kaijuNC.codex", async (topic) => {
		const fileName = TOPICS[topic] || "README.md";
		const documentUri = vscode.Uri.joinPath(context.extensionUri, "codex", fileName);
		try {
			await vscode.workspace.openTextDocument(documentUri);
			await vscode.commands.executeCommand("markdown.showPreviewToSide", documentUri);
		} catch (error) {
			vscode.window.showErrorMessage(`KAIJU Codex could not open ${fileName}.`);
		}
	}));
}

module.exports = { registerKaijuCodex };
