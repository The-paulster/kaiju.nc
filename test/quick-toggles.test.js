const test = require("node:test");
const assert = require("node:assert/strict");
const { vscode, makeDocument, configurationValues } = require("./helpers");
const { registerKaijuQuickToggles } = require("../src/kaijuQuickToggles");
const manifest = require("../package.json");

test("unbound G-code quick toggle updates setting, context and reacts to configuration changes", async () => {
	const commands = new Map();
	const contexts = new Map();
	let configurationChanged;
	vscode.commands = {
		registerCommand(name, handler) { commands.set(name, handler); return { dispose() {} }; },
		async executeCommand(command, name, value) { if (command === "setContext") contexts.set(name, value); }
	};
	vscode.window.activeTextEditor = { document: makeDocument("G123") };
	vscode.window.onDidChangeActiveTextEditor = () => ({ dispose() {} });
	vscode.window.showInformationMessage = () => {};
	vscode.workspace.onDidChangeConfiguration = handler => { configurationChanged = handler; return { dispose() {} }; };
	registerKaijuQuickToggles({ subscriptions: [] });
	const key = "kaijuNC.alerts.unboundGCodes.enabled";
	const context = "kaijuNC.quickToggle.unboundGCodesEnabled";
	try {
		assert.equal(contexts.get(context), false);
		await commands.get("kaijuNC.quickToggle.unboundGCodesOff")();
		assert.equal(configurationValues.get(key), true);
		assert.equal(contexts.get(context), true);
		await commands.get("kaijuNC.quickToggle.unboundGCodesOn")();
		assert.equal(configurationValues.get(key), false);
		configurationValues.set(key, false);
		configurationChanged({ affectsConfiguration: name => name === key });
		assert.equal(contexts.get(context), false);
		for (const suffix of ["On", "Off"]) {
			const command = `kaijuNC.quickToggle.unboundGCodes${suffix}`;
			assert.ok(manifest.contributes.commands.some(entry => entry.command === command));
			assert.ok(manifest.contributes.menus["kaijuNC.quickTogglesMenu"].some(entry => entry.command === command));
		}
	} finally { configurationValues.delete(key); }
});
