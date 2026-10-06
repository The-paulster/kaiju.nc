// Role: own configured KAIJU machine profiles, per-document persistence, and
// change notifications. Commands and status-bar presentation belong to the
// kaijuMachineMode feature.
const vscode = require("vscode");
const { getGCodeDialectProfile, getGCodeDialectProfiles } = require("./MetaGCodeDialect");
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
const GENERIC_MACHINE_PROFILE = Object.freeze({
	id: "generic", label: "Generic Machine", description: "General-purpose machine with automatic Mill/Lathe detection.",
	machineMode: "auto", gCodeDialectId: "fanucIso", rapidRate: 10000,
	toolChangeSeconds: 4, extraStationSeconds: 0.5,
	cAxisCoordinates: "wrapped", cAxisResetOnDisable: true,
	requiresSemicolons: false, customTimes: Object.freeze({}),
	turretStationCount: 0, turretIndexing: "shortest",
	rapidRates: Object.freeze({ x: null, y: null, z: null, c: null }),
	workOffsets: Object.freeze({}),
	cAxisTravel: "direct", rotaryFeedRule: "degrees", rotaryFeedScale: 1,
	maxSpindleRpm: 0, cssSurfaceSpeedUnit: "mPerMin",
	startupFeedMode: "machine", startupPlane: "xy", startupDistanceMode: "absolute", startupSpindleMode: "fixed"
});
const machineModeChangeEmitter = new vscode.EventEmitter();
const workOffsetChangeEmitter = new vscode.EventEmitter();
const inferredMachineModes = new WeakMap();
let machineModeContext;

function initializeMachineMode(context) {
	machineModeContext = context;
}

function normalizeMachineProfiles(value, { validateGCodeProfiles = true } = {}) {
	if (!Array.isArray(value)) throw new Error("Machine profiles must be a list.");
	const ids = new Set(["generic"]);
	const dialectIds = new Set(getGCodeDialectProfiles().map(profile => profile.id));
	return value.map(raw => {
		if (!raw || typeof raw !== "object") throw new Error("Invalid machine profile.");
		const id = typeof raw.id === "string" ? raw.id.trim() : "";
		const label = typeof raw.label === "string" ? raw.label.trim() : "";
		if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error("Machine profile IDs must be unique; generic is reserved.");
		if (!label || label.length > 80) throw new Error("Enter a machine profile name of up to 80 characters.");
		ids.add(id);
		if (!["auto", ...Object.keys(MACHINE_MODE_PROFILES)].includes(raw.machineMode)) throw new Error("Select a valid machine type.");
		if (typeof raw.gCodeDialectId !== "string" || !raw.gCodeDialectId.trim() || (validateGCodeProfiles && !dialectIds.has(raw.gCodeDialectId))) throw new Error(`G-code profile for ${label} is unavailable. Select an existing G-code profile.`);
		if (!["wrapped", "continuous"].includes(raw.cAxisCoordinates)) throw new Error("Select a valid C-axis coordinate behavior.");
		if (typeof raw.cAxisResetOnDisable !== "boolean") throw new Error("C-axis reset must be enabled or disabled.");
		if (raw.requiresSemicolons !== undefined && typeof raw.requiresSemicolons !== "boolean") throw new Error("Requires semicolons must be enabled or disabled.");
		const customTimes = {};
		if (raw.customTimes !== undefined && (!raw.customTimes || typeof raw.customTimes !== "object" || Array.isArray(raw.customTimes))) throw new Error("Custom timings must map M codes to seconds.");
		for (const [code, seconds] of Object.entries(raw.customTimes || {})) {
			const match = /^M0*(\d+)$/i.exec(code.trim());
			if (!match || !Number.isSafeInteger(Number(match[1])) || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) throw new Error("Each custom timing needs an M code and non-negative seconds.");
			const normalizedCode = `M${Number(match[1])}`;
			if (Object.prototype.hasOwnProperty.call(customTimes, normalizedCode)) throw new Error(`Duplicate custom timing for ${normalizedCode}.`);
			customTimes[normalizedCode] = seconds;
		}
		const profile = { id, label, description: String(raw.description || "").slice(0, 240),
			machineMode: raw.machineMode, gCodeDialectId: raw.gCodeDialectId,
			cAxisCoordinates: raw.cAxisCoordinates, cAxisResetOnDisable: raw.cAxisResetOnDisable,
			requiresSemicolons: raw.requiresSemicolons === true, customTimes };
		for (const key of ["rapidRate", "toolChangeSeconds", "extraStationSeconds"]) {
			if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0) throw new Error(`${key} must be a non-negative number.`);
			profile[key] = raw[key];
		}
		const choices = {
			turretIndexing: ["shortest", "increasing", "decreasing"], cAxisTravel: ["direct", "shortest", "positive", "negative"],
			rotaryFeedRule: ["degrees", "scaledDegrees", "physical", "linearOnly"], cssSurfaceSpeedUnit: ["mPerMin", "sfm"],
			startupFeedMode: ["machine", "perMinute", "perRev"], startupPlane: ["xy", "xz", "yz"],
			startupDistanceMode: ["absolute", "incremental"], startupSpindleMode: ["fixed", "css"]
		};
		for (const [key, values] of Object.entries(choices)) {
			profile[key] = raw[key] === undefined ? GENERIC_MACHINE_PROFILE[key] : raw[key];
			if (!values.includes(profile[key])) throw new Error(`Select a valid ${key}.`);
		}
		for (const key of ["turretStationCount", "maxSpindleRpm", "rotaryFeedScale"]) {
			profile[key] = raw[key] === undefined ? GENERIC_MACHINE_PROFILE[key] : raw[key];
			if (typeof profile[key] !== "number" || !Number.isFinite(profile[key]) || profile[key] < 0) throw new Error(`${key} must be a non-negative number.`);
		}
		if (!Number.isSafeInteger(profile.turretStationCount)) throw new Error("Turret station count must be a whole number.");
		if (profile.rotaryFeedRule === "scaledDegrees" && profile.rotaryFeedScale <= 0) throw new Error("Angular feed scale must be greater than zero.");
		if (raw.rapidRates !== undefined && (!raw.rapidRates || typeof raw.rapidRates !== "object" || Array.isArray(raw.rapidRates))) throw new Error("Rapid rates must contain axis rates.");
		profile.rapidRates = {};
		profile.workOffsets = normalizeMachineWorkOffsets(raw.workOffsets);
		for (const axis of ["x", "y", "z", "c"]) {
			const rate = raw.rapidRates && raw.rapidRates[axis];
			profile.rapidRates[axis] = rate === undefined || rate === null ? null : rate;
			if (rate !== undefined && rate !== null && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0)) throw new Error(`${axis.toUpperCase()} rapid rate must be a non-negative number or blank.`);
		}
		return profile;
	});
}

function getMachineProfiles(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.machineProfiles", document && document.uri);
	// Keep machines editable if their controller profile has since been removed.
	return [{ ...GENERIC_MACHINE_PROFILE }, ...normalizeMachineProfiles(config.get("customProfiles", []), { validateGCodeProfiles: false })];
}

function normalizeMachineWorkOffsets(value = {}) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Work offsets must contain coordinate frames.");
	const offsets = {};
	for (const [code, raw] of Object.entries(value)) {
		if (!/^G5[3-9]$/.test(code) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Work offsets support G53 through G59.");
		const offset = {};
		for (const axis of ["x", "y", "z", "c"]) {
			const number = raw[axis] === undefined ? 0 : raw[axis];
			if (typeof number !== "number" || !Number.isFinite(number)) throw new Error(`${code} ${axis.toUpperCase()} offset must be a finite number.`);
			offset[axis] = number;
		}
		// Preserve existing Vision origin visibility and notes in program overrides.
		if (typeof raw.showZeroLines === "boolean") offset.showZeroLines = raw.showZeroLines;
		if (typeof raw.note === "string") offset.note = raw.note;
		offsets[code] = offset;
	}
	return offsets;
}

function getDocumentWorkOffsets(document) {
	if (!document || !machineModeContext) return undefined;
	const key = getMachineModeDocumentKey(document);
	const shared = machineModeContext.workspaceState.get("kaijuMachineMode.workOffsetsByDocument", {});
	const legacy = machineModeContext.workspaceState.get("kaijuVision.workOffsetsByDocument", {});
	return Object.prototype.hasOwnProperty.call(shared, key) ? shared[key] : legacy[key];
}

async function saveDocumentWorkOffsets(document, offsets) {
	if (!document || !machineModeContext) return;
	const key = getMachineModeDocumentKey(document);
	const shared = { ...machineModeContext.workspaceState.get("kaijuMachineMode.workOffsetsByDocument", {}) };
	if (offsets === undefined) delete shared[key];
	else shared[key] = normalizeMachineWorkOffsets(offsets);
	await machineModeContext.workspaceState.update("kaijuMachineMode.workOffsetsByDocument", shared);
	const legacy = { ...machineModeContext.workspaceState.get("kaijuVision.workOffsetsByDocument", {}) };
	if (Object.prototype.hasOwnProperty.call(legacy, key)) {
		delete legacy[key];
		await machineModeContext.workspaceState.update("kaijuVision.workOffsetsByDocument", legacy);
	}
	workOffsetChangeEmitter.fire(document);
}

function getDefaultMachineProfileId(document) {
	return vscode.workspace.getConfiguration("kaijuNC.machineProfiles", document && document.uri).get("defaultProfile", "generic");
}

function machineProfileConfigurationTarget(config, key) {
	const inspected = typeof config.inspect === "function" && config.inspect(key);
	if (inspected && inspected.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
	if (inspected && inspected.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
	return vscode.ConfigurationTarget.Global;
}

async function saveMachineProfiles(document, profiles) {
	const normalized = normalizeMachineProfiles(profiles);
	const config = vscode.workspace.getConfiguration("kaijuNC.machineProfiles", document && document.uri);
	await config.update("customProfiles", normalized, machineProfileConfigurationTarget(config, "customProfiles"));
	notifyMachineProfilesChanged();
}

async function setDefaultMachineProfile(document, profileId) {
	if (!getMachineProfiles(document).some(profile => profile.id === profileId)) throw new Error("Machine profile is unavailable.");
	const config = vscode.workspace.getConfiguration("kaijuNC.machineProfiles", document && document.uri);
	await config.update("defaultProfile", profileId, machineProfileConfigurationTarget(config, "defaultProfile"));
	notifyMachineProfilesChanged();
}

async function setMachineProfile(document, profileId) {
	if (!document || !machineModeContext) throw new Error("Open a G-code document before selecting a machine profile.");
	const selected = getMachineProfiles(document).find(profile => profile.id === profileId);
	if (!selected) throw new Error("Machine profile is unavailable.");
	const allProfiles = getStoredMachineModes();
	// Selecting a machine also selects its G-code profile; old mode overrides are cleared.
	allProfiles[getMachineModeDocumentKey(document)] = { machineProfileId: selected.id };
	await machineModeContext.workspaceState.update(MACHINE_MODE_STORAGE_KEY, allProfiles);
	machineModeChangeEmitter.fire(document);
	return selected;
}

function notifyMachineProfilesChanged() {
	for (const document of vscode.workspace.textDocuments || []) {
		if (document.languageId === "gcode") machineModeChangeEmitter.fire(document);
	}
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
			...(getStoredMachineModes()[documentKey] || {}),
			...(currentMode.machineSettings
				? { machineProfileId: currentMode.machineProfile.id }
				: { profileId: currentMode.profile.id, xAxisMode: currentMode.xAxisMode }),
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
	let profiles;
	try { profiles = getMachineProfiles(document); } catch { profiles = [{ ...GENERIC_MACHINE_PROFILE }]; }
	const defaultId = getDefaultMachineProfileId(document);
	const selectedId = stored ? stored.machineProfileId || "generic" : defaultId;
	const machineProfile = profiles.find(candidate => candidate.id === selectedId) || profiles[0];
	// Preserve legacy Settings and saved mode records until a machine profile is selected.
	const machineConfig = vscode.workspace.getConfiguration("kaijuNC.machineProfiles", document && document.uri);
	const explicitDefault = getConfiguredValue(machineConfig, "defaultProfile", undefined) !== undefined;
	const useMachineSettings = Boolean(stored && stored.machineProfileId) || (!stored && (defaultId !== "generic" || explicitDefault));
	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document && document.uri);
	const configuredProfileId = useMachineSettings ? machineProfile.machineMode : config.get("machineMode", "auto");
	const inferred = !(stored && stored.profileId) && configuredProfileId === "auto" ? inferMachineModeForDocument(document) : undefined;
	const profile = getMachineModeProfile(stored && stored.profileId || inferred && inferred.profileId || configuredProfileId);
	const gCodeDialect = getGCodeDialectProfile(stored && stored.gCodeDialectId || (useMachineSettings ? machineProfile.gCodeDialectId : getConfiguredGCodeDialectId(document, profile)));

	return {
		profile,
		machineProfile,
		machineSettings: useMachineSettings ? machineProfile : undefined,
		motionOptions: {
			...(useMachineSettings ? {
			rapidRates: machineProfile.rapidRates, turretStationCount: machineProfile.turretStationCount, turretIndexing: machineProfile.turretIndexing,
			cAxisTravel: machineProfile.cAxisTravel, rotaryFeedRule: machineProfile.rotaryFeedRule, rotaryFeedScale: machineProfile.rotaryFeedScale,
			maxSpindleRpm: machineProfile.maxSpindleRpm, cssSurfaceSpeedUnit: machineProfile.cssSurfaceSpeedUnit,
			startupPlane: machineProfile.startupPlane, startupDistanceMode: machineProfile.startupDistanceMode, startupSpindleMode: machineProfile.startupSpindleMode,
			defaultFeedMode: machineProfile.startupFeedMode === "machine" ? profile.defaultFeedMode : machineProfile.startupFeedMode
			} : {}),
			workOffsets: getDocumentWorkOffsets(document) || (useMachineSettings ? machineProfile.workOffsets : {})
		},
		// X convention is part of the selected machine profile. The legacy
		// chronoblade.xAxisMode setting can otherwise leave an inferred Mill
		// program reporting Mill while Alert still halves X as Diameter.
		xAxisMode: stored && stored.xAxisMode || profile.xAxisMode,
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
	normalizeMachineWorkOffsets,
	getDocumentWorkOffsets,
	saveDocumentWorkOffsets,
	GENERIC_MACHINE_PROFILE,
	normalizeMachineProfiles,
	getMachineProfiles,
	getDefaultMachineProfileId,
	saveMachineProfiles,
	setDefaultMachineProfile,
	setMachineProfile,
	notifyMachineProfilesChanged,
	MACHINE_MODE_PROFILES,
	initializeMachineMode,
	getMachineModeProfile,
	getMachineModeForDocument,
	getDocumentMachineSettings: document => ({
		selection: { ...(getStoredMachineModes()[getMachineModeDocumentKey(document)] || {}) },
		workOffsets: getDocumentWorkOffsets(document)
	}),
	inferMachineModeForDocument,
	setMachineMode,
	setGCodeDialect,
	onDidChangeMachineMode: machineModeChangeEmitter.event,
	onDidChangeWorkOffsets: workOffsetChangeEmitter.event,
	getConfiguredValue
};
