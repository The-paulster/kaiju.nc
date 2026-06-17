// Role: own configured KAIJU machine profiles, profile-setting commands, and the
// right-side machine-profile status bar. Keep cursor modal state in Sense files.
const vscode = require("vscode");

const MACHINE_MODE_PROFILES = {
	mill: {
		id: "mill",
		label: "Mill",
		statusLabel: "Mill",
		xAxisMode: "radius",
		defaultFeedMode: "perMinute"
	},
	latheRadius: {
		id: "latheRadius",
		label: "Lathe (Radius)",
		statusLabel: "Lathe - Radius",
		xAxisMode: "radius",
		defaultFeedMode: "perRev"
	},
	latheDiameter: {
		id: "latheDiameter",
		label: "Lathe (Diameter)",
		statusLabel: "Lathe - Diameter",
		xAxisMode: "diameter",
		defaultFeedMode: "perRev"
	}
};

function registerMachineModeCommands(context) {
	for (const profile of Object.values(MACHINE_MODE_PROFILES)) {
		context.subscriptions.push(
			vscode.commands.registerCommand(`kaijuNC.machineMode.${profile.id}`, async () => {
				await setMachineMode(profile.id);
			})
		);
	}

	registerMachineModeStatusBar(context);
}

function registerMachineModeStatusBar(context) {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	statusBarItem.tooltip = "KAIJU.NC configured machine mode";
	context.subscriptions.push(statusBarItem);

	const update = () => updateMachineModeStatusBar(statusBarItem);

	update();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.chronoblade.machineMode")) {
				update();
			}
		})
	);
}

function updateMachineModeStatusBar(statusBarItem) {
	const editor = vscode.window.activeTextEditor;

	if (!editor || !editor.document || editor.document.languageId !== "gcode") {
		statusBarItem.hide();
		return;
	}

	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", editor.document.uri);
	const profile = getMachineModeProfile(config.get("machineMode", "latheDiameter"));

	// Right-side configuration indicator: this is the selected KAIJU machine profile,
	// not the cursor-specific modal G/M state shown by KAIJU Sense.
	statusBarItem.text = `KAIJU: ${profile.statusLabel}`;
	statusBarItem.show();
}

async function setMachineMode(profileId) {
	const profile = getMachineModeProfile(profileId);
	const editor = vscode.window.activeTextEditor;
	const uri = editor && editor.document ? editor.document.uri : undefined;
	const target = vscode.ConfigurationTarget && vscode.ConfigurationTarget.Global
		? vscode.ConfigurationTarget.Global
		: true;

	await vscode.workspace.getConfiguration("kaijuNC.chronoblade", uri).update("machineMode", profile.id, target);
	await vscode.workspace.getConfiguration("kaijuNC.chronoblade", uri).update("xAxisMode", profile.xAxisMode, target);
	await vscode.workspace.getConfiguration("kaijuNC.sense", uri).update("xAxisMode", profile.xAxisMode, target);
	await vscode.workspace.getConfiguration("kaijuNC.vision", uri).update("xAxisMode", profile.xAxisMode, target);

	vscode.window.showInformationMessage(`KAIJU machine mode set to ${profile.label}.`);
}

function getMachineModeProfile(profileId) {
	return MACHINE_MODE_PROFILES[profileId] || MACHINE_MODE_PROFILES.latheDiameter;
}

function getConfiguredValue(config, key, fallback) {
	if (!hasConfiguredValue(config, key)) {
		return fallback;
	}

	return config.get(key, fallback);
}

function hasConfiguredValue(config, key) {
	if (!config || typeof config.inspect !== "function") {
		return true;
	}

	const inspected = config.inspect(key);

	if (!inspected) {
		return false;
	}

	return [
		"globalValue",
		"workspaceValue",
		"workspaceFolderValue",
		"globalLanguageValue",
		"workspaceLanguageValue",
		"workspaceFolderLanguageValue"
	].some(name => inspected[name] !== undefined);
}

module.exports = {
	MACHINE_MODE_PROFILES,
	registerMachineModeCommands,
	getMachineModeProfile,
	getConfiguredValue
};
