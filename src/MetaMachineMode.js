// Role: own configured KAIJU machine profiles, profile-setting commands, and the
// right-side machine/alias mode status bars. Keep cursor modal state in Sense files.
const vscode = require("vscode");
const { getAliasModeState } = require("./kaijuAlias");
const { getAliasOptions } = require("./kaijuAlias/options");

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

const MACHINE_MODE_STATUS_COLORS = {
	mill: "#4EC9B0",
	latheRadius: "#DCDCAA",
	latheDiameter: "#CE9178"
};

const ALIAS_STATUS_COLORS = {
	on: "#29c718",
	off: "#8A8A8A",
	mixed: "#ff0037"
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
	const statusBar = {
		machineItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90),
		aliasItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 89)
	};
	statusBar.machineItem.tooltip = "KAIJU.NC configured machine mode";
	statusBar.aliasItem.tooltip = "KAIJU Alias mode in the current document";
	context.subscriptions.push(statusBar.machineItem, statusBar.aliasItem);

	const update = () => updateMachineModeStatusBar(statusBar);

	update();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;

			if (editor && event.document === editor.document) {
				update();
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (
				event.affectsConfiguration("kaijuNC.chronoblade.machineMode")
				|| event.affectsConfiguration("kaijuNC.alias")
				|| event.affectsConfiguration("kaijuNC.display.statusBarModeColors")
			) {
				update();
			}
		})
	);
}

function updateMachineModeStatusBar(statusBar) {
	const editor = vscode.window.activeTextEditor;

	if (!editor || !editor.document || editor.document.languageId !== "gcode") {
		hideMachineModeStatusBar(statusBar);
		return;
	}

	const document = editor.document;
	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const profile = getMachineModeProfile(config.get("machineMode", "latheDiameter"));
	const useModeColors = displayConfig.get("statusBarModeColors", false);

	// Right-side configuration indicator: this is the selected KAIJU machine profile,
	// not the cursor-specific modal G/M state shown by KAIJU Sense.
	statusBar.machineItem.text = `KAIJU: ${profile.statusLabel}`;
	statusBar.machineItem.color = useModeColors ? getMachineModeStatusColor(profile.id) : undefined;
	statusBar.machineItem.show();

	const aliasState = getAliasModeState(document, getAliasOptions(document));
	statusBar.aliasItem.text = `Alias: ${getAliasStatusLabel(aliasState.mode)}`;
	statusBar.aliasItem.tooltip = getAliasStatusTooltip(aliasState);
	statusBar.aliasItem.color = useModeColors ? getAliasStatusColor(aliasState.mode) : undefined;
	statusBar.aliasItem.show();
}

function hideMachineModeStatusBar(statusBar) {
	statusBar.machineItem.hide();
	statusBar.aliasItem.hide();
}

function getMachineModeStatusColor(profileId) {
	return MACHINE_MODE_STATUS_COLORS[profileId] || MACHINE_MODE_STATUS_COLORS.latheDiameter;
}

function getAliasStatusLabel(mode) {
	if (mode === "mixed") {
		return "Mixed";
	}

	return mode === "on" ? "On" : "Off";
}

function getAliasStatusTooltip(aliasState) {
	if (!aliasState.hasAliasDefinitions) {
		return "KAIJU Alias mode: no alias comments found before the first G/M block.";
	}

	if (aliasState.mode === "mixed") {
		return "KAIJU Alias mode: aliases and numeric macros are mixed in this document.";
	}

	return aliasState.mode === "on"
		? "KAIJU Alias mode: aliases are active in this document."
		: "KAIJU Alias mode: numeric macros are active in this document.";
}

function getAliasStatusColor(mode) {
	return ALIAS_STATUS_COLORS[mode] || ALIAS_STATUS_COLORS.off;
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
