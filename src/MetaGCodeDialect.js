// Role: map controller-specific G-code words to stable KAIJU motion/modal
// operations. Keep calculation and modal state updates in MetaMotionEngine.
const G_CODE_OPERATIONS = Object.freeze({
	MOTION_RAPID: "motion.rapid",
	MOTION_LINEAR: "motion.linear",
	MOTION_ARC_CW: "motion.arcClockwise",
	MOTION_ARC_CCW: "motion.arcCounterclockwise",
	DISTANCE_ABSOLUTE: "distance.absolute",
	DISTANCE_INCREMENTAL: "distance.incremental",
	FEED_PER_MINUTE: "feed.perMinute",
	FEED_PER_REVOLUTION: "feed.perRevolution",
	PLANE_XY: "plane.xy",
	PLANE_XZ: "plane.xz",
	PLANE_YZ: "plane.yz",
	SPINDLE_CSS: "spindle.constantSurfaceSpeed",
	SPINDLE_FIXED_RPM: "spindle.fixedRpm",
	SPINDLE_RPM_LIMIT: "spindle.rpmLimit",
	CYCLE_CANCEL: "cycle.cancel",
	CYCLE_RETURN_INITIAL: "cycle.returnInitial",
	CYCLE_RETURN_R: "cycle.returnR",
	DWELL: "motion.dwell",
	MACHINE_COORDINATE: "coordinate.machine",
	COORDINATE_SETTING: "coordinate.setting"
});
const G_CODE_OPERATION_DEFINITIONS = Object.freeze({
	[G_CODE_OPERATIONS.MOTION_RAPID]: operationDefinition({ motionCode: 0, statusGroup: "motion", label: "Rapid" }),
	[G_CODE_OPERATIONS.MOTION_LINEAR]: operationDefinition({ motionCode: 1, statusGroup: "motion", label: "Linear" }),
	[G_CODE_OPERATIONS.MOTION_ARC_CW]: operationDefinition({ motionCode: 2, statusGroup: "motion", label: "CW arc" }),
	[G_CODE_OPERATIONS.MOTION_ARC_CCW]: operationDefinition({ motionCode: 3, statusGroup: "motion", label: "CCW arc" }),
	[G_CODE_OPERATIONS.DISTANCE_ABSOLUTE]: operationDefinition({ statusGroup: "distanceMode", label: "Absolute" }),
	[G_CODE_OPERATIONS.DISTANCE_INCREMENTAL]: operationDefinition({ statusGroup: "distanceMode", label: "Incremental" }),
	[G_CODE_OPERATIONS.FEED_PER_MINUTE]: operationDefinition({ statusGroup: "feedMode", label: "Feed/min" }),
	[G_CODE_OPERATIONS.FEED_PER_REVOLUTION]: operationDefinition({ statusGroup: "feedMode", label: "Feed/rev" }),
	[G_CODE_OPERATIONS.CYCLE_RETURN_INITIAL]: operationDefinition({ statusGroup: "cannedCycleReturn", label: "Initial-plane return" }),
	[G_CODE_OPERATIONS.CYCLE_RETURN_R]: operationDefinition({ statusGroup: "cannedCycleReturn", label: "R-plane return" }),
	[G_CODE_OPERATIONS.PLANE_XY]: operationDefinition({ statusGroup: "plane", label: "X-Y plane" }),
	[G_CODE_OPERATIONS.PLANE_XZ]: operationDefinition({ statusGroup: "plane", label: "X-Z plane" }),
	[G_CODE_OPERATIONS.PLANE_YZ]: operationDefinition({ statusGroup: "plane", label: "Y-Z plane" }),
	[G_CODE_OPERATIONS.CYCLE_CANCEL]: operationDefinition({ statusGroup: "motion", label: "Cycle cancel" }),
	[G_CODE_OPERATIONS.SPINDLE_CSS]: operationDefinition({ statusGroup: "spindleSpeedMode", label: "CSS" }),
	[G_CODE_OPERATIONS.SPINDLE_FIXED_RPM]: operationDefinition({ statusGroup: "spindleSpeedMode", label: "Fixed RPM" }),
	[G_CODE_OPERATIONS.SPINDLE_RPM_LIMIT]: operationDefinition({ statusGroup: "speedLimit", label: "Spindle limit" }),
	[G_CODE_OPERATIONS.DWELL]: operationDefinition(),
	[G_CODE_OPERATIONS.MACHINE_COORDINATE]: operationDefinition(),
	[G_CODE_OPERATIONS.COORDINATE_SETTING]: operationDefinition()
});
const resolutionCache = new WeakMap();

function operationDefinition(value = {}) {
	return Object.freeze(Object.assign({}, value));
}

const COMMON_BINDINGS = Object.freeze({
	[G_CODE_OPERATIONS.MOTION_RAPID]: binding(0),
	[G_CODE_OPERATIONS.MOTION_LINEAR]: binding(1),
	[G_CODE_OPERATIONS.MOTION_ARC_CW]: binding(2),
	[G_CODE_OPERATIONS.MOTION_ARC_CCW]: binding(3),
	[G_CODE_OPERATIONS.DWELL]: binding(4),
	[G_CODE_OPERATIONS.COORDINATE_SETTING]: binding(10),
	[G_CODE_OPERATIONS.PLANE_XY]: binding(17),
	[G_CODE_OPERATIONS.PLANE_XZ]: binding(18),
	[G_CODE_OPERATIONS.PLANE_YZ]: binding(19),
	[G_CODE_OPERATIONS.MACHINE_COORDINATE]: binding(53),
	[G_CODE_OPERATIONS.CYCLE_CANCEL]: binding(80),
	[G_CODE_OPERATIONS.SPINDLE_CSS]: binding(96),
	[G_CODE_OPERATIONS.SPINDLE_FIXED_RPM]: binding(97)
});
const LATHE_COMMON_BINDINGS = Object.freeze({
	[G_CODE_OPERATIONS.SPINDLE_RPM_LIMIT]: binding(50, { requiredWords: ["S"], argumentWord: "S" })
});

const BUILT_IN_G_CODE_DIALECT_PROFILES = Object.freeze({
	fanucIso: makeProfile({
		id: "fanucIso",
		label: "FANUC / ISO",
		description: "ISO-style G94/G95 feed modes with mill G98/G99 canned-cycle return modes.",
		bindings: {
			mill: {
				[G_CODE_OPERATIONS.DISTANCE_ABSOLUTE]: binding(90),
				[G_CODE_OPERATIONS.DISTANCE_INCREMENTAL]: binding(91),
				[G_CODE_OPERATIONS.FEED_PER_MINUTE]: binding(94),
				[G_CODE_OPERATIONS.FEED_PER_REVOLUTION]: binding(95),
				[G_CODE_OPERATIONS.CYCLE_RETURN_INITIAL]: binding(98),
				[G_CODE_OPERATIONS.CYCLE_RETURN_R]: binding(99)
			},
			lathe: {
				[G_CODE_OPERATIONS.DISTANCE_ABSOLUTE]: binding(90),
				[G_CODE_OPERATIONS.DISTANCE_INCREMENTAL]: binding(91),
				[G_CODE_OPERATIONS.FEED_PER_MINUTE]: binding(94),
				[G_CODE_OPERATIONS.FEED_PER_REVOLUTION]: binding(95)
			}
		}
	}),
	dmgMori: makeProfile({
		id: "dmgMori",
		label: "DMG MORI",
		description: "DMG MORI turning G98/G99 feed modes with ISO mill feed and canned-cycle return modes.",
		bindings: {
			mill: {
				[G_CODE_OPERATIONS.DISTANCE_ABSOLUTE]: binding(90),
				[G_CODE_OPERATIONS.DISTANCE_INCREMENTAL]: binding(91),
				[G_CODE_OPERATIONS.FEED_PER_MINUTE]: binding(94),
				[G_CODE_OPERATIONS.FEED_PER_REVOLUTION]: binding(95),
				[G_CODE_OPERATIONS.CYCLE_RETURN_INITIAL]: binding(98),
				[G_CODE_OPERATIONS.CYCLE_RETURN_R]: binding(99)
			},
			lathe: {
				[G_CODE_OPERATIONS.FEED_PER_MINUTE]: binding(98),
				[G_CODE_OPERATIONS.FEED_PER_REVOLUTION]: binding(99)
			}
		}
	})
});

validateProfiles(BUILT_IN_G_CODE_DIALECT_PROFILES);
let customGCodeDialectProfiles = Object.freeze({});

function binding(code, options = {}) {
	const numericCode = Number(code);
	if (!Number.isFinite(numericCode)) throw new Error(`Invalid G-code binding: ${code}`);
	const requiredWords = Array.isArray(options.requiredWords) ? options.requiredWords.map(normalizeLetter).sort() : [];
	const argumentWord = options.argumentWord ? normalizeLetter(options.argumentWord) : undefined;
	if (argumentWord && !requiredWords.includes(argumentWord)) {
		throw new Error(`Binding G${numericCode} selects ${argumentWord}, but does not require it.`);
	}
	return Object.freeze({
		code: numericCode,
		requiredWords: Object.freeze(requiredWords),
		argumentWord
	});
}

function makeBindingTable(...sources) {
	const table = Object.fromEntries(Object.keys(G_CODE_OPERATION_DEFINITIONS).map(operation => [operation, null]));

	for (const source of sources) {
		for (const [operation, candidate] of Object.entries(source || {})) {
			if (!Object.prototype.hasOwnProperty.call(G_CODE_OPERATION_DEFINITIONS, operation)) {
				throw new Error(`Unknown canonical G-code operation: ${operation}`);
			}

			if (candidate === null) {
				table[operation] = null;
				continue;
			}

			const triggerKey = getBindingTriggerKey(candidate);
			for (const [ownedOperation, ownedBinding] of Object.entries(table)) {
				if (ownedOperation !== operation && ownedBinding && getBindingTriggerKey(ownedBinding) === triggerKey) {
					table[ownedOperation] = null;
				}
			}
			table[operation] = candidate;
		}
	}

	return Object.freeze(table);
}

function makeProfile(profile) {
	return Object.freeze({
		id: profile.id,
		label: profile.label,
		description: profile.description,
		schemaVersion: 3,
		bindings: Object.freeze({
			mill: makeBindingTable(COMMON_BINDINGS, profile.bindings.mill),
			lathe: makeBindingTable(COMMON_BINDINGS, LATHE_COMMON_BINDINGS, profile.bindings.lathe)
		})
	});
}

function getGCodeDialectProfile(profileId) {
	return customGCodeDialectProfiles[profileId] || BUILT_IN_G_CODE_DIALECT_PROFILES[profileId] || BUILT_IN_G_CODE_DIALECT_PROFILES.fanucIso;
}

function getGCodeDialectProfiles() {
	return [...Object.values(BUILT_IN_G_CODE_DIALECT_PROFILES), ...Object.values(customGCodeDialectProfiles)];
}

function getBuiltInGCodeDialectProfiles() {
	return Object.values(BUILT_IN_G_CODE_DIALECT_PROFILES);
}

function setCustomGCodeDialectProfiles(rawProfiles) {
	const normalized = normalizeCustomGCodeDialectProfiles(rawProfiles);
	customGCodeDialectProfiles = Object.freeze(Object.fromEntries(normalized.map(profile => [profile.id, profile])));
	return getGCodeDialectProfiles();
}

function normalizeCustomGCodeDialectProfiles(rawProfiles) {
	if (!Array.isArray(rawProfiles)) return [];
	const ids = new Set();
	const labels = new Set();
	return rawProfiles.map((rawProfile, index) => {
		const label = String(rawProfile && rawProfile.label || rawProfile && rawProfile.name || "").trim();
		const id = normalizeProfileId(rawProfile && rawProfile.id || label);
		if (!label) throw new Error(`Custom G-code profile ${index + 1} needs a name.`);
		if (!id) throw new Error(`Custom G-code profile ${index + 1} needs a valid name.`);
		if (BUILT_IN_G_CODE_DIALECT_PROFILES[id]) throw new Error(`${label} uses a built-in profile ID.`);
		if (ids.has(id)) throw new Error(`Custom G-code profile ID ${id} is duplicated.`);
		if (labels.has(label.toLowerCase())) throw new Error(`Custom G-code profile name ${label} is duplicated.`);
		ids.add(id);
		labels.add(label.toLowerCase());
		return makeProfile({
			id,
			label,
			description: String(rawProfile && rawProfile.description || "").trim(),
			bindings: {
				mill: normalizeBindingSource(rawProfile && rawProfile.bindings && rawProfile.bindings.mill),
				lathe: normalizeBindingSource(rawProfile && rawProfile.bindings && rawProfile.bindings.lathe)
			}
		});
	});
}

function normalizeBindingSource(source) {
	const normalized = {};
	for (const [operation, candidate] of Object.entries(source || {})) {
		if (!Object.prototype.hasOwnProperty.call(G_CODE_OPERATION_DEFINITIONS, operation)) {
			throw new Error(`Unknown canonical G-code operation: ${operation}`);
		}
		normalized[operation] = candidate === null ? null : binding(candidate && candidate.code, candidate || {});
	}
	return normalized;
}

function normalizeProfileId(value) {
	return String(value || "").trim().replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getPreferredGCodeBinding(operation, options = {}) {
	const profile = getGCodeDialectProfile(options.gCodeDialectId);
	const mode = options.machineMode === "mill" ? "mill" : "lathe";
	const candidate = profile.bindings[mode][operation];
	return candidate ? Object.freeze({ operation, ...candidate }) : undefined;
}

function getGCodeWordForOperation(operation, options = {}, formatOptions = {}) {
	const candidate = getPreferredGCodeBinding(operation, options);
	return candidate ? formatGCodeBinding(candidate, formatOptions) : undefined;
}

function formatGCodeBinding(candidate, options = {}) {
	if (!candidate || !Number.isFinite(candidate.code)) return undefined;
	let code = String(Number(candidate.code));
	if (options.padSingleDigit === true && Number.isInteger(candidate.code) && candidate.code >= 0 && candidate.code < 10) {
		code = code.padStart(2, "0");
	}
	return `G${code}`;
}

function resolveGCodeOperations(words, options = {}) {
	const profile = getGCodeDialectProfile(options.gCodeDialectId);
	const mode = options.machineMode === "mill" ? "mill" : "lathe";
	const cacheKey = `${profile.id}|${mode}`;
	const cached = words && resolutionCache.get(words);
	if (cached && cached.has(cacheKey)) return cached.get(cacheKey);
	const matches = [];

	for (const word of words || []) {
		if (word.letter !== "G" || !Number.isFinite(word.value)) continue;

		for (const [operation, candidate] of Object.entries(profile.bindings[mode])) {
			if (!candidate) continue;
			if (!sameCode(candidate.code, word.value)) continue;
			if (!candidate.requiredWords.every(letter => hasFiniteWord(words, letter))) continue;

			const argument = candidate.argumentWord ? lastFiniteWord(words, candidate.argumentWord) : undefined;
			matches.push({
				operation,
				code: candidate.code,
				word,
				argumentWord: candidate.argumentWord,
				argument: argument && argument.value
			});
		}
	}

	const resolved = Object.freeze(matches);
	if (words && typeof words === "object") {
		const byProfile = cached || new Map();
		byProfile.set(cacheKey, resolved);
		if (!cached) resolutionCache.set(words, byProfile);
	}
	return resolved;
}

function hasGCodeOperation(words, operation, options) {
	return resolveGCodeOperations(words, options).some(match => match.operation === operation);
}

function sameCode(expected, actual) {
	return Math.abs(Number(expected) - Number(actual)) < 0.000000001;
}

function hasFiniteWord(words, letter) {
	return Boolean(lastFiniteWord(words, letter));
}

function lastFiniteWord(words, letter) {
	for (let index = words.length - 1; index >= 0; index--) {
		if (words[index].letter === letter && Number.isFinite(words[index].value)) return words[index];
	}

	return undefined;
}

function normalizeLetter(value) {
	const letter = String(value || "").trim().toUpperCase();
	if (!/^[A-Z]$/.test(letter)) throw new Error(`Invalid G-code companion word: ${value}`);
	return letter;
}

function getBindingTriggerKey(candidate) {
	// A block can contain every companion word, so different companion
	// requirements on the same G word would still be ambiguous at runtime.
	return String(candidate.code);
}

function validateProfiles(profiles) {
	for (const profile of Object.values(profiles)) {
		if (!profile.id || profile.schemaVersion !== 3 || !profile.bindings) {
			throw new Error("Invalid G-code dialect profile.");
		}

		for (const mode of ["mill", "lathe"]) {
			if (!profile.bindings[mode] || Array.isArray(profile.bindings[mode])) {
				throw new Error(`Invalid ${profile.label} ${mode} bindings.`);
			}
			const owners = new Map();
			for (const operation of Object.keys(G_CODE_OPERATION_DEFINITIONS)) {
				if (!Object.prototype.hasOwnProperty.call(profile.bindings[mode], operation)) {
					throw new Error(`Missing ${profile.label} ${mode} binding slot for ${operation}.`);
				}
				const candidate = profile.bindings[mode][operation];
				if (candidate === null) continue;
				const key = getBindingTriggerKey(candidate);
				const previous = owners.get(key);
				if (previous && previous !== operation) {
					throw new Error(`Conflicting ${profile.label} ${mode} binding for G${candidate.code}: ${previous} / ${operation}`);
				}
				owners.set(key, operation);
			}
		}
	}
}

module.exports = {
	G_CODE_OPERATIONS,
	G_CODE_OPERATION_DEFINITIONS,
	G_CODE_DIALECT_PROFILES: BUILT_IN_G_CODE_DIALECT_PROFILES,
	getBuiltInGCodeDialectProfiles,
	setCustomGCodeDialectProfiles,
	normalizeCustomGCodeDialectProfiles,
	createGCodeBinding: binding,
	createGCodeBindingTable: makeBindingTable,
	getGCodeDialectProfile,
	getGCodeDialectProfiles,
	getPreferredGCodeBinding,
	getGCodeWordForOperation,
	formatGCodeBinding,
	resolveGCodeOperations,
	hasGCodeOperation
};
