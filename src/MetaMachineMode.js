// Role: own configured KAIJU machine profiles, per-document persistence, and
// change notifications. Commands and status-bar presentation belong to the
// kaijuMachineMode feature.
const vscode = require("vscode");
const { getGCodeDialectProfile } = require("./MetaGCodeDialect");
const { maskProtectedRanges } = require("./MetaTextRanges");

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
const inferredMachineModes = new WeakMap();
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

	await vscode.workspace.getConfiguration("kaijuNC.chronoblade", null).update("machineMode", profile.id, target);
	await vscode.workspace.getConfiguration("kaijuNC.chronoblade", null).update("xAxisMode", profile.xAxisMode, target);
	await vscode.workspace.getConfiguration("kaijuNC.sense", null).update("xAxisMode", profile.xAxisMode, target);
	await vscode.workspace.getConfiguration("kaijuNC.vision", null).update("xAxisMode", profile.xAxisMode, target);

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
	await vscode.workspace.getConfiguration("kaijuNC.gCodeDialect", null).update("defaultProfile", dialect.id, target);
	return dialect;
}

function getMachineModeForDocument(document) {
	const stored = getStoredMachineModes()[getMachineModeDocumentKey(document)];
	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document && document.uri);
	const configuredProfileId = config.get("machineMode", "auto");
	const inferred = !stored && configuredProfileId === "auto" ? inferMachineModeForDocument(document) : undefined;
	const profile = getMachineModeProfile(stored && stored.profileId || inferred && inferred.profileId || configuredProfileId);
	const gCodeDialect = getGCodeDialectProfile(stored && stored.gCodeDialectId || getConfiguredGCodeDialectId(document, profile));

	return {
		profile,
		xAxisMode: stored && stored.xAxisMode || getConfiguredValue(config, "xAxisMode", profile.xAxisMode),
		gCodeDialect,
		gCodeDialectId: gCodeDialect.id,
		machineModeSource: stored ? "document" : inferred && inferred.isConfident ? "inferred" : "fallback"
	};
}

// Keep this deliberately conservative: ambiguous X/Z programs retain the
// legacy Lathe (Diameter) fallback, and a saved program profile always wins.
function inferMachineModeForDocument(document) {
	if (!document || !Number.isInteger(document.lineCount)) return { profileId: "latheDiameter", isConfident: false };
	const cached = inferredMachineModes.get(document);
	if (cached && cached.version === document.version) return cached.result;

	const evidence = new Set();
	let latheRadius = false;
	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = maskProtectedRanges(document.lineAt(lineNumber).text).toUpperCase();
		if (/\bG\s*0*(?:96|97)\b|\bG\s*50\b[^\r\n]*\bS\s*[+-]?(?:\d|\.)/.test(line)) evidence.add("lathe-spindle");
		if (/\bG\s*0*(?:71|72|75|76)\b/.test(line)) evidence.add("lathe-cycle");
		if (/\bG\s*0*7\b/.test(line)) evidence.add("lathe-diameter");
		if (/\bG\s*0*8\b/.test(line)) { evidence.add("lathe-radius"); latheRadius = true; }
		if (/\b[UW]\s*[+-]?(?:\d|\.)/.test(line)) evidence.add("lathe-incremental-axis");
		if (/\bT\s*\d{4,}\b/.test(line)) evidence.add("lathe-tool-call");

		if (/\bG\s*0*(?:43|49)\b/.test(line)) evidence.add("mill-tool-length");
		if (/\bG\s*0*(?:81|82|83|84|85|86|87|88|89)\b/.test(line)) evidence.add("mill-cycle");
		if (/\bM\s*0*6\b/.test(line)) evidence.add("mill-tool-change");
		if (/\bY\s*[+-]?(?:\d|\.)/.test(line)) evidence.add("mill-y-axis");
	}
	const latheScore = scoreEvidence(evidence, ["lathe-spindle", "lathe-cycle", "lathe-diameter", "lathe-radius", "lathe-incremental-axis", "lathe-tool-call"]);
	const millScore = scoreEvidence(evidence, ["mill-tool-length", "mill-cycle", "mill-tool-change", "mill-y-axis"]);

	const result = latheScore > millScore && latheScore >= 2
		? { profileId: latheRadius ? "latheRadius" : "latheDiameter", isConfident: true }
		: millScore > latheScore && millScore >= 2
			? { profileId: "mill", isConfident: true }
			: { profileId: "latheDiameter", isConfident: false };
	inferredMachineModes.set(document, { version: document.version, result });
	return result;
}

function scoreEvidence(evidence, names) {
	return names.reduce((score, name) => score + (evidence.has(name)
		? name === "lathe-spindle" || name === "lathe-diameter" || name === "lathe-radius" || name === "mill-tool-length" || name === "lathe-tool-call" ? 3 : name === "lathe-cycle" ? 2 : 1
		: 0), 0);
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
	inferMachineModeForDocument,
	setMachineMode,
	setGCodeDialect,
	onDidChangeMachineMode: machineModeChangeEmitter.event,
	getConfiguredValue
};
