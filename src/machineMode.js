const vscode = require("vscode");

const MACHINE_MODE_PROFILES = {
	mill: {
		id: "mill",
		label: "Mill",
		xAxisMode: "radius",
		defaultFeedMode: "perMinute"
	},
	latheRadius: {
		id: "latheRadius",
		label: "Lathe (Radius)",
		xAxisMode: "radius",
		defaultFeedMode: "perRev"
	},
	latheDiameter: {
		id: "latheDiameter",
		label: "Lathe (Diameter)",
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
