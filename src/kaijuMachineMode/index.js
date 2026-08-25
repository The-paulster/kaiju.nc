// Role: own machine/profile commands, notifications, and right-side status-bar
// presentation. Shared profile state and persistence live in MetaMachineMode.
const vscode = require("vscode");
const { getAliasModeState } = require("../kaijuAlias");
const { getAliasOptions } = require("../kaijuAlias/options");
const { getGCodeDialectProfiles } = require("../MetaGCodeDialect");
const { registerGCodeProfileEditor, reloadConfiguredGCodeDialectProfiles } = require("./profileEditor");
const {
	MACHINE_MODE_PROFILES,
	initializeMachineMode,
	getMachineModeForDocument,
	setMachineMode,
	setGCodeDialect,
	onDidChangeMachineMode
} = require("../MetaMachineMode");

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

function registerKaijuMachineMode(context) {
	initializeMachineMode(context);
	const profileLoadError = reloadConfiguredGCodeDialectProfiles(getActiveDocument());
	if (profileLoadError) vscode.window.showWarningMessage(`KAIJU could not load custom G-code profiles: ${profileLoadError}`);
	for (const profile of Object.values(MACHINE_MODE_PROFILES)) {
		context.subscriptions.push(vscode.commands.registerCommand(`kaijuNC.machineMode.${profile.id}`, async () => {
			const document = getActiveDocument();
			const selected = await setMachineMode(document, profile.id);
			vscode.window.showInformationMessage(document
				? `KAIJU machine mode for this program set to ${selected.label}.`
				: `KAIJU machine mode set to ${selected.label}.`);
		}));
	}
	for (const dialect of getGCodeDialectProfiles()) {
		context.subscriptions.push(vscode.commands.registerCommand(`kaijuNC.gCodeDialect.${dialect.id}`, async () => {
			const document = getActiveDocument();
			const selected = await setGCodeDialect(document, dialect.id);
			vscode.window.showInformationMessage(document
				? `KAIJU G-code profile for this program set to ${selected.label}.`
				: `KAIJU fallback G-code profile set to ${selected.label}.`);
		}));
	}
	registerGCodeProfileEditor(context);
	registerMachineModeStatusBar(context);
}

function getActiveDocument() {
	const editor = vscode.window.activeTextEditor;
	return editor && editor.document;
}

function registerMachineModeStatusBar(context) {
	const statusBar = {
		machineItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90),
		aliasItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 89)
	};
	statusBar.machineItem.tooltip = "KAIJU.NC machine mode and G-code profile for the active program";
	statusBar.aliasItem.tooltip = "KAIJU Alias mode in the current document";
	context.subscriptions.push(statusBar.machineItem, statusBar.aliasItem);

	const update = () => updateMachineModeStatusBar(statusBar);
	update();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === getActiveDocument()) update();
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration("kaijuNC.gCodeDialect.customProfiles")) {
				const profileLoadError = reloadConfiguredGCodeDialectProfiles(getActiveDocument());
				if (profileLoadError) vscode.window.showWarningMessage(`KAIJU could not load custom G-code profiles: ${profileLoadError}`);
			}
			if (
				event.affectsConfiguration("kaijuNC.chronoblade.machineMode")
				|| event.affectsConfiguration("kaijuNC.chronoblade.gCodeDialect")
				|| event.affectsConfiguration("kaijuNC.alias")
				|| event.affectsConfiguration("kaijuNC.display.statusBarModeColors")
			) update();
		}),
		onDidChangeMachineMode(update)
	);
}

function updateMachineModeStatusBar(statusBar) {
	const document = getActiveDocument();
	if (!document || document.languageId !== "gcode") {
		statusBar.machineItem.hide();
		statusBar.aliasItem.hide();
		return;
	}

	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const machineMode = getMachineModeForDocument(document);
	const profile = machineMode.profile;
	const useModeColors = displayConfig.get("statusBarModeColors", false);
	statusBar.machineItem.text = `KAIJU: ${profile.statusLabel}`;
	statusBar.machineItem.tooltip = `Machine Mode: ${profile.label}\nG-code profile: ${machineMode.gCodeDialect.label}`;
	statusBar.machineItem.color = useModeColors ? MACHINE_MODE_STATUS_COLORS[profile.id] || MACHINE_MODE_STATUS_COLORS.latheDiameter : undefined;
	statusBar.machineItem.show();

	const aliasState = getAliasModeState(document, getAliasOptions(document));
	statusBar.aliasItem.text = `Alias: ${aliasState.mode === "mixed" ? "Mixed" : aliasState.mode === "on" ? "On" : "Off"}`;
	statusBar.aliasItem.tooltip = getAliasStatusTooltip(aliasState);
	statusBar.aliasItem.color = useModeColors ? ALIAS_STATUS_COLORS[aliasState.mode] || ALIAS_STATUS_COLORS.off : undefined;
	statusBar.aliasItem.show();
}

function getAliasStatusTooltip(aliasState) {
	if (!aliasState.hasAliasDefinitions) return "KAIJU Alias mode: no alias comments found before the first G/M block.";
	if (aliasState.mode === "mixed") return "KAIJU Alias mode: aliases and numeric macros are mixed in this document.";
	return aliasState.mode === "on"
		? "KAIJU Alias mode: aliases are active in this document."
		: "KAIJU Alias mode: numeric macros are active in this document.";
}

module.exports = { registerKaijuMachineMode };
