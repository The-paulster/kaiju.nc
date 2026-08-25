// Role: own configured KAIJU machine profiles, per-document persistence, and
// change notifications. Commands and status-bar presentation belong to the
// kaijuMachineMode feature.
const vscode = require("vscode");
const { getGCodeDialectProfile } = require("./MetaGCodeDialect");

const MACHINE_MODE_PROFILES = {
	mill: {
		id: "mill",
		label: "Mill",
		statusLabel: "Mill",
		xAxisMode: "radius",
		defaultFeedMode: "perMinute",
		defaultGCodeDialectId: "fanucIso"
	},
	latheRadius: {
		id: "latheRadius",
		label: "Lathe (Radius)",
		statusLabel: "Lathe - Radius",
		xAxisMode: "radius",
		defaultFeedMode: "perRev",
		defaultGCodeDialectId: "dmgMori"
	},
	latheDiameter: {
		id: "latheDiameter",
		label: "Lathe (Diameter)",
		statusLabel: "Lathe - Diameter",
		xAxisMode: "diameter",
		defaultFeedMode: "perRev",
		defaultGCodeDialectId: "dmgMori"
	}
};

const MACHINE_MODE_STORAGE_KEY = "kaijuMachineMode.profilesByDocument";
const DEFAULT_G_CODE_DIALECT_ID = "fanucIso";
const machineModeChangeEmitter = new vscode.EventEmitter();
let machineModeContext;

function initializeMachineMode(context) {
	machineModeContext = context;
}

async function setMachineMode(document, profileId) {
	const profile = getMachineModeProfile(profileId);

	if (document) {
		const allProfiles = getStoredMachineModes();
		const documentKey = getMachineModeDocumentKey(document);
		const current = allProfiles[documentKey] || {};
		allProfiles[documentKey] = {
			profileId: profile.id,
			xAxisMode: profile.xAxisMode,
			gCodeDialectId: current.gCodeDialectId || getConfiguredGCodeDialectId(document, profile)
		};
		await machineModeContext.workspaceState.update(MACHINE_MODE_STORAGE_KEY, allProfiles);
		machineModeChangeEmitter.fire(document);
		return profile;
	}

	const target = vscode.ConfigurationTarget && vscode.ConfigurationTarget.Global
		? vscode.ConfigurationTarget.Global
		: true;

	await vscode.workspace.getConfiguration("kaijuNC.chronoblade").update("machineMode", profile.id, target);
	await vscode.workspace.getConfiguration("kaijuNC.chronoblade").update("xAxisMode", profile.xAxisMode, target);
	await vscode.workspace.getConfiguration("kaijuNC.sense").update("xAxisMode", profile.xAxisMode, target);
	await vscode.workspace.getConfiguration("kaijuNC.vision").update("xAxisMode", profile.xAxisMode, target);

	return profile;
}

async function setGCodeDialect(document, dialectId) {
	const dialect = getGCodeDialectProfile(dialectId);

	if (document) {
		const allProfiles = getStoredMachineModes();
		const documentKey = getMachineModeDocumentKey(document);
		const currentMode = getMachineModeForDocument(document);
		allProfiles[documentKey] = {
			profileId: currentMode.profile.id,
			xAxisMode: currentMode.xAxisMode,
			gCodeDialectId: dialect.id
		};
		await machineModeContext.workspaceState.update(MACHINE_MODE_STORAGE_KEY, allProfiles);
		machineModeChangeEmitter.fire(document);
		return dialect;
	}

	const target = vscode.ConfigurationTarget && vscode.ConfigurationTarget.Global
		? vscode.ConfigurationTarget.Global
		: true;
	await vscode.workspace.getConfiguration("kaijuNC.gCodeDialect").update("defaultProfile", dialect.id, target);
	return dialect;
}

function getMachineModeForDocument(document) {
	const stored = getStoredMachineModes()[getMachineModeDocumentKey(document)];
	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document && document.uri);
	const profile = getMachineModeProfile(stored && stored.profileId || config.get("machineMode", "latheDiameter"));
	const gCodeDialect = getGCodeDialectProfile(stored && stored.gCodeDialectId || getConfiguredGCodeDialectId(document, profile));

	return {
		profile,
		xAxisMode: stored && stored.xAxisMode || getConfiguredValue(config, "xAxisMode", profile.xAxisMode),
		gCodeDialect,
		gCodeDialectId: gCodeDialect.id
	};
}

function getConfiguredGCodeDialectId(document, profile) {
	const config = vscode.workspace.getConfiguration("kaijuNC.gCodeDialect", document && document.uri);
	if (hasConfiguredValue(config, "defaultProfile")) {
		return getGCodeDialectProfile(config.get("defaultProfile", DEFAULT_G_CODE_DIALECT_ID)).id;
	}

	// Preserve an explicit value written by 0.5.1 while the setting moves to
	// the G-code Profiles section. New installs use the FANUC / ISO default.
	const legacyConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document && document.uri);
	const legacyDialectId = legacyConfig.get("gCodeDialect", undefined);
	if (legacyDialectId && hasConfiguredValue(legacyConfig, "gCodeDialect")) {
		return legacyDialectId === "auto"
			? profile.defaultGCodeDialectId
			: getGCodeDialectProfile(legacyDialectId).id;
	}

	return DEFAULT_G_CODE_DIALECT_ID;
}

function getStoredMachineModes() {
	return machineModeContext && machineModeContext.workspaceState
		? Object.assign({}, machineModeContext.workspaceState.get(MACHINE_MODE_STORAGE_KEY, {}))
		: {};
}

function getMachineModeDocumentKey(document) {
	return document && document.uri ? document.uri.toString() : "";
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
	initializeMachineMode,
	getMachineModeProfile,
	getMachineModeForDocument,
	setMachineMode,
	setGCodeDialect,
	onDidChangeMachineMode: machineModeChangeEmitter.event,
	getConfiguredValue
};
