// Role: own right-click quick setting toggles for high-frequency KAIJU controls.
const vscode = require("vscode");

const TOGGLES = {
	sequenceNumberOrder: {
		commands: [
			"kaijuNC.quickToggle.sequenceNumberOrderOn",
			"kaijuNC.quickToggle.sequenceNumberOrderOff"
		],
		section: "kaijuNC.alerts",
		key: "sequenceNumberOrder.enabled",
		defaultValue: true,
		contextKey: "kaijuNC.quickToggle.sequenceNumberOrderEnabled",
		label: "Out-of-Order N Alerts"
	}
};

function registerKaijuQuickToggles(context) {
	for (const toggle of Object.values(TOGGLES)) {
		for (const command of toggle.commands) {
			context.subscriptions.push(
				vscode.commands.registerCommand(command, async () => {
					await toggleSetting(toggle);
				})
			);
		}
	}

	const update = () => updateQuickToggleContexts();

	update();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.alerts.sequenceNumberOrder.enabled")) {
				update();
			}
		})
	);
}

async function toggleSetting(toggle) {
	const editor = vscode.window.activeTextEditor;
	const uri = editor && editor.document ? editor.document.uri : undefined;
	const config = vscode.workspace.getConfiguration(toggle.section, uri);
	const current = config.get(toggle.key, toggle.defaultValue);
	const target = getUpdateTarget(config, toggle.key);

	await config.update(toggle.key, !current, target);
	await vscode.commands.executeCommand("setContext", toggle.contextKey, !current);
	vscode.window.showInformationMessage(`${toggle.label}: ${!current ? "On" : "Off"}.`);
}

function updateQuickToggleContexts() {
	const editor = vscode.window.activeTextEditor;
	const uri = editor && editor.document ? editor.document.uri : undefined;

	for (const toggle of Object.values(TOGGLES)) {
		const value = vscode.workspace
			.getConfiguration(toggle.section, uri)
			.get(toggle.key, toggle.defaultValue);

		vscode.commands.executeCommand("setContext", toggle.contextKey, !!value);
	}
}

function getUpdateTarget(config, key) {
	if (!config || typeof config.inspect !== "function" || !vscode.ConfigurationTarget) {
		return true;
	}

	const inspected = config.inspect(key);

	if (inspected && inspected.workspaceFolderValue !== undefined) {
		return vscode.ConfigurationTarget.WorkspaceFolder;
	}

	if (inspected && inspected.workspaceValue !== undefined) {
		return vscode.ConfigurationTarget.Workspace;
	}

	return vscode.ConfigurationTarget.Global;
}

module.exports = {
	registerKaijuQuickToggles
};
