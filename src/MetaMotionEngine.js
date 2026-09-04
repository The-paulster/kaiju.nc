// Role: interpret G-code motion/modal state and provide shared motion analysis
// primitives. UI modules may read snapshots from here, but editor rendering and
// product UI belong in the KAIJU feature modules. Status-bar modal definitions
// are split between MetaGCodeDialect and the non-dialect MetaModalDefs table.
const {
	getCommentRanges,
	maskProtectedRanges
} = require("./MetaTextRanges");
const {
	buildMacroAliasMap,
	evaluateNumericExpression,
	findMacroAssignments,
	setMacroValue
} = require("./MetaMacroEngine");
const {
	TOOL_COLORS,
	getToolRanges
} = require("./MetaToolModel");
const {
	formatHumanNumber,
	formatHumanPosition,
	formatHumanTime
} = require("./MetaHumanFormat");
const {
	G_CODE_OPERATIONS,
	G_CODE_OPERATION_DEFINITIONS,
	resolveGCodeOperations,
	hasGCodeOperation,
	getPreferredGCodeBinding,
	getGCodeWordForOperation
} = require("./MetaGCodeDialect");
const STATUS_MODAL_GROUPS = require("./MetaModalDefs.json");

const HOVER_MOTION_CODES = new Set([0, 1, 2, 3]);
const REPORT_MOTION_CODES = new Set([0, 1, 2, 3]);
const MOTION_OPERATIONS_BY_CODE = new Map([
	[0, G_CODE_OPERATIONS.MOTION_RAPID],
	[1, G_CODE_OPERATIONS.MOTION_LINEAR],
	[2, G_CODE_OPERATIONS.MOTION_ARC_CW],
	[3, G_CODE_OPERATIONS.MOTION_ARC_CCW]
]);
const CANNED_CYCLE_CODES = new Set([73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

function estimateMotionAtLine(document, targetLineNumber, hoveredMotion, options) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);

	for (let lineNumber = 0; lineNumber <= targetLineNumber; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);

		trackMacroAssignments(codeLine, macroValues, macroAliases);

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words, options);

		applyModalState(words, motionCode, state, options);

		if (lineNumber === targetLineNumber) {
			if (motionCode !== hoveredMotion.code || !HOVER_MOTION_CODES.has(motionCode)) {
				return undefined;
			}

			return estimateMotion(words, motionCode, state, options);
		}

		applyPositionUpdate(words, state, options);
	}

	return undefined;
}

// Status-bar read model only. This intentionally reuses the same G-code modal
// parsing as motion analysis, but it does not estimate geometry, time, or update
// position. Dialect-owned movement/modal groups come from MetaGCodeDialect;
// unrelated status-only groups remain in MetaModalDefs.json.
function getModalStateAtLine(document, targetLineNumber, options = {}) {
	const state = makeInitialState(options);
	const statusState = makeInitialStatusModalState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const lastLineNumber = Math.min(Math.max(targetLineNumber, 0), document.lineCount - 1);

	for (let lineNumber = 0; lineNumber <= lastLineNumber; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);

		trackMacroAssignments(codeLine, macroValues, macroAliases);

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words, options);

		applyModalState(words, motionCode, state, options);
		applyStatusModalState(words, statusState, options);
	}

	return {
		motionCode: state.motionCode,
		feedMode: state.feedMode,
		spindleMode: state.spindleMode,
		modalGroups: getStatusModalEntries(statusState)
	};
}

function makeInitialState(options = {}) {
	const initialPosition = options.initialPosition && typeof options.initialPosition === "object"
		? options.initialPosition
		: undefined;
	const position = {};
	for (const axis of ["x", "y", "z"]) {
		if (initialPosition && Number.isFinite(Number(initialPosition[axis]))) {
			position[axis] = Number(initialPosition[axis]);
		}
	}
	const positionCoordinateSystem = initialPosition && typeof initialPosition.coordinateSystem === "string"
		? initialPosition.coordinateSystem
		: undefined;

	return {
		position,
		positionCoordinateSystem,
		motionCode: undefined,
		arcPlane: "xy",
		distanceMode: "absolute",
		coordinateSystem: "G54",
		cannedCycle: undefined,
		cannedCycleRetractMode: "initial",
		feed: undefined,
		feedMode: options.defaultFeedMode === "perMinute" ? "perMinute" : "perRev",
		spindleMode: "fixed",
		rpm: undefined,
		cssSurfaceSpeed: undefined,
		rpmLimit: undefined
	};
}

function makeInitialStatusModalState(options = {}) {
	const statusState = new Map();
	setDefaultDialectStatusEntry(
		statusState,
		options.defaultFeedMode === "perMinute" ? G_CODE_OPERATIONS.FEED_PER_MINUTE : G_CODE_OPERATIONS.FEED_PER_REVOLUTION,
		options
	);
	setDefaultDialectStatusEntry(statusState, G_CODE_OPERATIONS.SPINDLE_FIXED_RPM, options);

	return statusState;
}

function setDefaultDialectStatusEntry(statusState, operation, options) {
	const candidate = getPreferredGCodeBinding(operation, options);
	if (!candidate) return;
	setDialectStatusModalEntry(statusState, {
		operation,
		word: { letter: "G", value: candidate.code },
		argumentWord: undefined,
		argument: undefined
	});
}

function trackMacroAssignments(codeLine, macroValues, macroAliases) {
	for (const assignment of findMacroAssignments(codeLine)) {
		const value = evaluateNumericExpression(assignment.value, macroValues, macroAliases);
		setMacroValue(macroValues, assignment.macro, value, macroAliases);
	}
}

function parseWords(codeLine, macroValues, macroAliases) {
	const words = [];
	let index = 0;

	while (index < codeLine.length) {
		const letter = codeLine[index];

		if (!/[A-Za-z]/.test(letter)) {
			index++;
			continue;
		}

		const valueStart = skipWhitespace(codeLine, index + 1);
		const valueToken = readValueToken(codeLine, valueStart);

		if (!valueToken) {
			index++;
			continue;
		}

		words.push({
			letter: letter.toUpperCase(),
			raw: valueToken.text,
			value: evaluateNumericExpression(valueToken.text, macroValues, macroAliases),
			start: index,
			end: valueToken.end
		});

		index = valueToken.end;
	}

	return words;
}

function skipWhitespace(text, index) {
	while (index < text.length && /\s/.test(text[index])) {
		index++;
	}

	return index;
}

function readValueToken(text, start) {
	if (start >= text.length) {
		return undefined;
	}

	if (text[start] === "[") {
		return readBracketToken(text, start);
	}

	const rest = text.slice(start);
	const match = rest.match(/^[-+]?(?:#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)|\d+(?:\.\d*)?|\.\d+)/);

	if (!match) {
		return undefined;
	}

	return {
		text: match[0],
		end: start + match[0].length
	};
}

function readBracketToken(text, start) {
	let depth = 0;

	for (let index = start; index < text.length; index++) {
		if (text[index] === "[") {
			depth++;
			continue;
		}

		if (text[index] === "]") {
			depth--;

			if (depth === 0) {
				return {
					text: text.slice(start, index + 1),
					end: index + 1
				};
			}
		}
	}

	return undefined;
}

function getMotionCode(words, options = {}) {
	let motionCode;

	for (const match of resolveGCodeOperations(words, options)) {
		const definition = G_CODE_OPERATION_DEFINITIONS[match.operation];
		if (definition && Number.isFinite(definition.motionCode)) motionCode = definition.motionCode;
	}

	return motionCode;
}

function getMotionCodeForGCode(gCode, options = {}) {
	const value = Number(gCode);
	return Number.isFinite(value) ? getMotionCode([{ letter: "G", value }], options) : undefined;
}

function getMotionDisplayWords(options = {}) {
	return {
		rapid: getGCodeWordForOperation(G_CODE_OPERATIONS.MOTION_RAPID, options) || "Rapid",
		cutting: [
			G_CODE_OPERATIONS.MOTION_LINEAR,
			G_CODE_OPERATIONS.MOTION_ARC_CW,
			G_CODE_OPERATIONS.MOTION_ARC_CCW
		].map(operation => getGCodeWordForOperation(operation, options)).filter(Boolean)
	};
}

function getMotionWord(motionCode, options) {
	const operation = MOTION_OPERATIONS_BY_CODE.get(motionCode);
	return operation ? getGCodeWordForOperation(operation, options) : undefined;
}

function getFeedModeWord(feedMode, options) {
	return getGCodeWordForOperation(
		feedMode === "perRev" ? G_CODE_OPERATIONS.FEED_PER_REVOLUTION : G_CODE_OPERATIONS.FEED_PER_MINUTE,
		options
	);
}

function applyModalState(words, motionCode, state, options = {}) {
	const sWord = lastWord(words, "S");
	const fWord = lastWord(words, "F");
	let hasRpmLimit = false;
	let cycleCode;
	let cancelCycle = false;

	for (const match of resolveGCodeOperations(words, options)) {
		switch (match.operation) {
			case G_CODE_OPERATIONS.DISTANCE_ABSOLUTE: state.distanceMode = "absolute"; break;
			case G_CODE_OPERATIONS.DISTANCE_INCREMENTAL: state.distanceMode = "incremental"; break;
			case G_CODE_OPERATIONS.FEED_PER_MINUTE: state.feedMode = "perMinute"; break;
			case G_CODE_OPERATIONS.FEED_PER_REVOLUTION: state.feedMode = "perRev"; break;
			case G_CODE_OPERATIONS.CYCLE_RETURN_INITIAL: state.cannedCycleRetractMode = "initial"; break;
			case G_CODE_OPERATIONS.CYCLE_RETURN_R: state.cannedCycleRetractMode = "r"; break;
			case G_CODE_OPERATIONS.PLANE_XY: state.arcPlane = "xy"; break;
			case G_CODE_OPERATIONS.PLANE_XZ: state.arcPlane = "xz"; break;
			case G_CODE_OPERATIONS.PLANE_YZ: state.arcPlane = "yz"; break;
			case G_CODE_OPERATIONS.CYCLE_CANCEL: cancelCycle = true; break;
			case G_CODE_OPERATIONS.SPINDLE_CSS: state.spindleMode = "css"; break;
			case G_CODE_OPERATIONS.SPINDLE_FIXED_RPM: state.spindleMode = "fixed"; break;
			case G_CODE_OPERATIONS.SPINDLE_RPM_LIMIT:
				hasRpmLimit = Number.isFinite(match.argument);
				if (hasRpmLimit) state.rpmLimit = match.argument;
				break;
		}
	}

	for (const word of words) {
		if (word.letter !== "G" || !Number.isFinite(word.value)) {
			continue;
		}

		const code = Math.trunc(word.value);

		if (code >= 54 && code <= 59) {
			state.coordinateSystem = "G" + code;
		} else if (CANNED_CYCLE_CODES.has(code)) {
			cycleCode = code;
		}
	}

	if (sWord && Number.isFinite(sWord.value) && !hasRpmLimit) {
		if (state.spindleMode === "css") {
			state.cssSurfaceSpeed = sWord.value;
		} else {
			state.rpm = sWord.value;
		}
	}

	if (fWord && Number.isFinite(fWord.value)) {
		state.feed = fWord.value;
	}

	if (REPORT_MOTION_CODES.has(motionCode)) {
		state.motionCode = motionCode;
	}

	if (cancelCycle) {
		state.cannedCycle = undefined;
	} else if (cycleCode) {
		state.cannedCycle = makeCannedCycleState(cycleCode, words, state);
	} else if (state.cannedCycle) {
		state.cannedCycle = updateCannedCycleState(state.cannedCycle, words, state);
	}
}

// Shared, non-UI arc geometry read model. Consumers decide whether and how to
// present a failure; this reports only conditions established from the
// program's resolved modal state.
function analyzeArcAtLine(document, targetLineNumber, options = {}) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);

	for (let lineNumber = 0; lineNumber <= targetLineNumber; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		trackMacroAssignments(codeLine, macroValues, macroAliases);

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words, options);
		applyModalState(words, motionCode, state, options);

		if (lineNumber === targetLineNumber) {
			return analyzeArcWords(words, motionCode, state, options);
		}

		applyPositionUpdate(words, state, options);
	}

	return undefined;
}

// Whole-document arc validation for batch consumers such as KAIJU Alert.
// Modal and macro state advance once through the source rather than replaying
// the program from line zero for every diagnostic candidate.
function analyzeArcsInDocument(document, options = {}) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const arcs = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const codeLine = maskProtectedRanges(document.lineAt(lineNumber).text);
		trackMacroAssignments(codeLine, macroValues, macroAliases);

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words, options);
		applyModalState(words, motionCode, state, options);

		const arc = analyzeArcWords(words, motionCode, state, options);
		if (arc) {
			arcs.set(lineNumber, arc);
		}

		applyPositionUpdate(words, state, options);
	}

	return arcs;
}

function analyzeArcWords(words, motionCode, state, options) {
	if (motionCode !== 2 && motionCode !== 3) {
		return undefined;
	}

	const motionWord = [...words].reverse().find(word => word.letter === "G"
		&& Number.isFinite(word.value)
		&& Math.trunc(word.value) === motionCode);
	const start = clonePosition(state.position);
	const end = makeEndPosition(start, words, state.distanceMode, options);

	return {
		motionCode,
		arcPlane: state.arcPlane,
		motionRange: motionWord ? { start: motionWord.start, end: motionWord.end } : undefined,
		validation: validateArcGeometry(words, start, end, state.arcPlane, options)
	};
}

function makeCannedCycleState(cycleCode, words, state) {
	const existing = state.cannedCycle || {};
	const cycle = Object.assign({}, existing, {
		code: cycleCode,
		initialZ: state.position.z,
		retractMode: state.cannedCycleRetractMode
	});

	return updateCannedCycleState(cycle, words, state);
}

function updateCannedCycleState(cycle, words, state) {
	const next = Object.assign({}, cycle, {
		retractMode: state.cannedCycleRetractMode
	});

	setCycleAxisValue(next, "z", lastWord(words, "Z"), state.position.z, state.distanceMode);
	setCycleAxisValue(next, "r", lastWord(words, "R"), state.position.z, state.distanceMode);
	setCycleValue(next, "q", lastWord(words, "Q"));
	setCycleValue(next, "p", lastWord(words, "P"));

	return next;
}

function setCycleAxisValue(cycle, key, word, baseValue, distanceMode) {
	if (!word || !Number.isFinite(word.value)) {
		return;
	}

	cycle[key] = distanceMode === "incremental" && Number.isFinite(baseValue)
		? baseValue + word.value
		: word.value;
}

function setCycleValue(cycle, key, word) {
	if (word && Number.isFinite(word.value)) {
		cycle[key] = word.value;
	}
}

function applyStatusModalState(words, statusState, options = {}) {
	for (const group of STATUS_MODAL_GROUPS) {
		for (const word of words) {
			if (word.letter !== group.letter || !Number.isFinite(word.value)) {
				continue;
			}
			setStatusModalEntry(statusState, group.key, getStatusModalCode(word.value), word, words, options);
		}
	}

	for (const match of resolveGCodeOperations(words, options)) {
		setDialectStatusModalEntry(statusState, match);
	}
}

function setDialectStatusModalEntry(statusState, match) {
	const definition = G_CODE_OPERATION_DEFINITIONS[match.operation];
	const group = definition && STATUS_MODAL_GROUPS.find(candidate => candidate.key === definition.statusGroup);
	if (!definition || !definition.statusGroup || !group) return;

	const argument = match.argumentWord && Number.isFinite(match.argument)
		? ` ${match.argumentWord}${formatCodeNumber(match.argument)}`
		: "";
	statusState.set(group.key, {
		key: group.key,
		order: group.order,
		code: `${formatDialectGCode(match.word.value)}${argument}`,
		label: definition.label
	});
}

function formatDialectGCode(value) {
	const code = formatCodeNumber(value);
	return `G${Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) < 10 ? code.padStart(2, "0") : code}`;
}

function getStatusModalCode(value) {
	return Number.isInteger(value) ? String(Math.trunc(value)) : String(Number(value));
}

function setStatusModalEntry(statusState, groupKey, code, word, words = [], options = {}) {
	const group = STATUS_MODAL_GROUPS.find(candidate => candidate.key === groupKey);
	const definition = group && group.codes[code];

	if (!group || !definition || !isStatusDefinitionEnabled(definition, options)) {
		return;
	}

	const label = getStatusDefinitionLabel(definition, options);
	const entry = definition.formatter
		? makeFormattedStatusModalEntry(definition.formatter, word, words, group, definition, label)
		: makeStatusModalEntry(group, definition, label);

	if (entry) {
		statusState.set(group.key, entry);
	}
}

function isStatusDefinitionEnabled(definition, options) {
	if (!Array.isArray(definition.modes) || !definition.modes.length) {
		return true;
	}

	return definition.modes.includes(options.machineMode === "mill" ? "mill" : "lathe");
}

function getStatusDefinitionLabel(definition, options) {
	return options.machineMode === "mill"
		? definition.millLabel || definition.label || definition.latheLabel || ""
		: definition.latheLabel || definition.label || definition.millLabel || "";
}

function makeFormattedStatusModalEntry(formatter, word, words, group, definition, label) {
	if (formatter === "extendedWorkOffset") {
		return makeExtendedWorkOffsetStatusEntry(word, words, group, definition, label);
	}

	return undefined;
}

function makeStatusModalEntry(group, definition, label) {
	return {
		key: group.key,
		order: group.order,
		code: definition.code,
		label
	};
}

function makeExtendedWorkOffsetStatusEntry(word, words, group, definition, label) {
	const pWord = lastWord(words, "P");

	return {
		key: group.key,
		order: group.order,
		code: `G54.1${pWord && Number.isFinite(pWord.value) ? ` P${formatCodeNumber(pWord.value)}` : ""}`,
		label
	};
}

function formatCodeNumber(value) {
	return Number(value).toString();
}

function getStatusModalEntries(statusState) {
	return [...statusState.values()].sort((a, b) => a.order - b.order);
}

function formatModalStateStatus(modalState, verbose) {
	const entries = modalState && Array.isArray(modalState.modalGroups)
		? modalState.modalGroups
		: [];

	return entries
		.map(entry => verbose ? `${entry.code} (${entry.label})` : entry.code)
		.join(" ");
}

function getStatusModalGroups() {
	return STATUS_MODAL_GROUPS.map(group => ({
		key: group.key,
		order: group.order,
		letter: group.letter,
		codes: Object.keys(group.codes).map(Number)
	}));
}

function lastWord(words, letter) {
	for (let index = words.length - 1; index >= 0; index--) {
		if (words[index].letter === letter) {
			return words[index];
		}
	}

	return undefined;
}

function estimateMotion(words, motionCode, state, options) {
	const start = clonePosition(state.position);
	const end = makeEndPosition(start, words, state.distanceMode, options);

	if (!hasKnownPosition(start) || !hasKnownPosition(end)) {
		applyPositionUpdate(words, state, options);
		return makeUnavailableEstimate(motionCode, start, end, "Start or end position is incomplete.");
	}

	const path = buildPathPoints(motionCode, start, end, words, state.arcPlane, options);
	const distance = sumPathDistance(path, options);
	const geometry = makeMotionGeometry(motionCode, start, end, path, options);
	const timing = motionCode === 0
		? estimateRapidTime(distance, options)
		: estimatePathTime(path, state, options);
	const warnings = collectUnresolvedWordWarnings(words, ["X", "Y", "Z", "U", "V", "W", "F"]);

	if (distance <= 0) {
		warnings.push("Move distance is zero.");
	}

	if (motionCode === 0 && (!Number.isFinite(options.rapidRate) || options.rapidRate <= 0)) {
		warnings.push("Rapid rate is unknown or zero.");
	}

	if (motionCode !== 0 && (!Number.isFinite(state.feed) || state.feed <= 0)) {
		warnings.push("Feed is unknown or zero.");
	}

	if (motionCode !== 0 && state.feedMode === "perRev" && state.spindleMode === "fixed" && (!Number.isFinite(state.rpm) || state.rpm <= 0)) {
		warnings.push("Fixed RPM is unknown or zero.");
	}

	if (motionCode !== 0 && state.feedMode === "perRev" && state.spindleMode === "css" && (!Number.isFinite(state.cssSurfaceSpeed) || state.cssSurfaceSpeed <= 0)) {
		warnings.push("CSS surface speed is unknown or zero.");
	}

	if (motionCode !== 0 && state.spindleMode === "css" && !Number.isFinite(state.rpmLimit)) {
		warnings.push("No RPM limit found; CSS estimate is unclamped.");
	}

	applyPositionUpdate(words, state, options);

	return {
		motionCode,
		motionWord: getMotionWord(motionCode, options),
		machineCoordinate: hasGCodeOperation(words, G_CODE_OPERATIONS.MACHINE_COORDINATE, options),
		start,
		end,
		coordinateSystem: state.coordinateSystem,
		distance,
		timeSeconds: timing.timeSeconds,
		minRpm: timing.minRpm,
		maxRpm: timing.maxRpm,
		feed: state.feed,
		feedMode: state.feedMode,
		feedModeWord: getFeedModeWord(state.feedMode, options),
		spindleMode: state.spindleMode,
		spindleModeWord: getGCodeWordForOperation(
			state.spindleMode === "css" ? G_CODE_OPERATIONS.SPINDLE_CSS : G_CODE_OPERATIONS.SPINDLE_FIXED_RPM,
			options
		),
		rpmLimitWord: getGCodeWordForOperation(G_CODE_OPERATIONS.SPINDLE_RPM_LIMIT, options),
		rpm: state.rpm,
		cssSurfaceSpeed: state.cssSurfaceSpeed,
		rpmLimit: state.rpmLimit,
		geometry,
		pathPoints: path.points,
		usedArcFallback: path.usedArcFallback,
		warnings
	};
}

function makeUnavailableEstimate(motionCode, start, end, reason) {
	return {
		motionCode,
		machineCoordinate: false,
		start,
		end,
		distance: NaN,
		timeSeconds: NaN,
		warnings: [reason]
	};
}

function applyPositionUpdate(words, state, options) {
	if (isCoordinateSettingLine(words, options)) {
		return;
	}

	state.position = makeEndPosition(state.position, words, state.distanceMode, options);
}

function collectUnresolvedWordWarnings(words, letters) {
	const warnings = [];

	for (const letter of letters) {
		const word = lastWord(words, letter);

		if (word && !Number.isFinite(word.value)) {
			warnings.push(`Could not resolve ${letter}${word.raw}.`);
		}
	}

	return warnings;
}

function makeEndPosition(start, words, distanceMode = "absolute", options = {}) {
	const end = clonePosition(start);
	const axisWords = [
		{ position: "X", incremental: "U", key: "x" },
		{ position: "Y", incremental: "V", key: "y" },
		{ position: "Z", incremental: "W", key: "z" }
	];
	for (const axis of axisWords) {
		const positionWord = lastWord(words, axis.position);
		const incrementalWord = lastWord(words, axis.incremental);

		if (positionWord && Number.isFinite(positionWord.value)) {
			if (distanceMode === "incremental" && Number.isFinite(end[axis.key])) {
				end[axis.key] += positionWord.value;
			} else {
				end[axis.key] = positionWord.value;
			}
		}

		if (incrementalWord && Number.isFinite(incrementalWord.value) && Number.isFinite(end[axis.key])) {
			end[axis.key] += incrementalWord.value;
		}
	}

	return end;
}

function hasGCode(words, targetCode) {
	return words.some(word => word.letter === "G" && Number.isFinite(word.value) && Math.trunc(word.value) === targetCode);
}

function buildPathPoints(motionCode, start, end, words, arcPlane, options) {
	if (motionCode === 0 || motionCode === 1) {
		return buildLinearPathPoints(start, end, options);
	}

	return buildArcPathPoints(motionCode, start, end, words, arcPlane, options);
}

function buildLinearPathPoints(start, end, options) {
	return {
		points: [clonePosition(start), clonePosition(end)],
		kind: "linear",
		usedArcFallback: false
	};
}

function buildArcPathPoints(motionCode, start, end, words, arcPlane, options) {
	const iWord = lastWord(words, "I");
	const jWord = lastWord(words, "J");
	const kWord = lastWord(words, "K");
	const rWord = lastWord(words, "R");
	const plane = getArcPlaneAxes(arcPlane);

	if (plane) {
		const primaryWord = getArcOffsetWord(words, plane.primaryAxis);
		const secondaryWord = getArcOffsetWord(words, plane.secondaryAxis);

		if (Number.isFinite(start[plane.primaryAxis])
			&& Number.isFinite(start[plane.secondaryAxis])
			&& Number.isFinite(end[plane.primaryAxis])
			&& Number.isFinite(end[plane.secondaryAxis])
			&& primaryWord
			&& secondaryWord
			&& Number.isFinite(primaryWord.value)
			&& Number.isFinite(secondaryWord.value)) {
			return buildPlanarArcPath(
				motionCode,
				start,
				end,
				plane.primaryAxis,
				plane.secondaryAxis,
				primaryWord.value,
				secondaryWord.value,
				options
			);
		}

		if (Number.isFinite(start[plane.primaryAxis])
			&& Number.isFinite(start[plane.secondaryAxis])
			&& Number.isFinite(end[plane.primaryAxis])
			&& Number.isFinite(end[plane.secondaryAxis])
			&& rWord
			&& Number.isFinite(rWord.value)) {
			const path = buildRadiusArcPath(
				motionCode,
				start,
				end,
				plane.primaryAxis,
				plane.secondaryAxis,
				rWord.value,
				options
			);

			if (path) {
				return path;
			}
		}
	}

	return {
		points: [start, end],
		kind: "arc",
		usedArcFallback: true
	};
}

function getArcPlaneAxes(arcPlane) {
	if (arcPlane === "xz") {
		return { primaryAxis: "x", secondaryAxis: "z" };
	}

	if (arcPlane === "yz") {
		return { primaryAxis: "y", secondaryAxis: "z" };
	}

	return { primaryAxis: "x", secondaryAxis: "y" };
}

function getArcOffsetWord(words, axis) {
	if (axis === "x") {
		return lastWord(words, "I");
	}

	if (axis === "y") {
		return lastWord(words, "J");
	}

	return lastWord(words, "K");
}

function buildPlanarArcPath(motionCode, start, end, primaryAxis, secondaryAxis, primaryOffset, secondaryOffset, options) {
	const startPoint = toPhysicalPoint(start, options);
	const centerPrimary = startPoint[primaryAxis] + toPhysicalAxisDistance(primaryAxis, primaryOffset, options);
	const centerSecondary = startPoint[secondaryAxis] + toPhysicalAxisDistance(secondaryAxis, secondaryOffset, options);
	const sweepMotionCode = getPlaneSweepMotionCode(motionCode, primaryAxis, secondaryAxis);

	return buildPlanarArcPathFromCenter(
		motionCode,
		sweepMotionCode,
		start,
		end,
		primaryAxis,
		secondaryAxis,
		centerPrimary,
		centerSecondary,
		options
	);
}

function buildRadiusArcPath(motionCode, start, end, primaryAxis, secondaryAxis, radiusWordValue, options) {
	const radius = Math.abs(radiusWordValue);

	if (!Number.isFinite(radius) || radius <= 0) {
		return undefined;
	}

	const startPoint = toPhysicalPoint(start, options);
	const endPoint = toPhysicalPoint(end, options);
	const deltaPrimary = endPoint[primaryAxis] - startPoint[primaryAxis];
	const deltaSecondary = endPoint[secondaryAxis] - startPoint[secondaryAxis];
	const chordLength = Math.hypot(deltaPrimary, deltaSecondary);

	if (!Number.isFinite(chordLength) || chordLength <= 0 || chordLength / 2 > radius) {
		return undefined;
	}

	const midpointPrimary = (startPoint[primaryAxis] + endPoint[primaryAxis]) / 2;
	const midpointSecondary = (startPoint[secondaryAxis] + endPoint[secondaryAxis]) / 2;
	const centerDistance = Math.sqrt(Math.max(0, radius * radius - (chordLength / 2) * (chordLength / 2)));
	const normalPrimary = -deltaSecondary / chordLength;
	const normalSecondary = deltaPrimary / chordLength;
	const sweepMotionCode = getPlaneSweepMotionCode(motionCode, primaryAxis, secondaryAxis);
	const directionSign = sweepMotionCode === 3 ? 1 : -1;
	const radiusSign = radiusWordValue < 0 ? -1 : 1;
	const centerSign = directionSign * radiusSign;
	const centerPrimary = midpointPrimary + normalPrimary * centerDistance * centerSign;
	const centerSecondary = midpointSecondary + normalSecondary * centerDistance * centerSign;

	return buildPlanarArcPathFromCenter(
		motionCode,
		sweepMotionCode,
		start,
		end,
		primaryAxis,
		secondaryAxis,
		centerPrimary,
		centerSecondary,
		options
	);
}

function getPlaneSweepMotionCode(motionCode, primaryAxis, secondaryAxis) {
	if (primaryAxis === "x" && secondaryAxis === "z") {
		return motionCode === 2 ? 3 : motionCode === 3 ? 2 : motionCode;
	}

	return motionCode;
}

function buildPlanarArcPathFromCenter(motionCode, sweepMotionCode, start, end, primaryAxis, secondaryAxis, centerPrimary, centerSecondary, options) {
	const startPoint = toPhysicalPoint(start, options);
	const endPoint = toPhysicalPoint(end, options);
	const startAngle = Math.atan2(startPoint[secondaryAxis] - centerSecondary, startPoint[primaryAxis] - centerPrimary);
	const endAngle = Math.atan2(endPoint[secondaryAxis] - centerSecondary, endPoint[primaryAxis] - centerPrimary);
	const sweep = getArcSweep(sweepMotionCode, startAngle, endAngle);
	const steps = Math.max(8, Math.ceil(options.samples * Math.min(1, sweep / (Math.PI * 2))));
	const radius = Math.hypot(
		startPoint[primaryAxis] - centerPrimary,
		startPoint[secondaryAxis] - centerSecondary
	);
	const points = [];

	for (let step = 0; step <= steps; step++) {
		const fraction = step / steps;
		const angle = sweepMotionCode === 2
			? startAngle - sweep * fraction
			: startAngle + sweep * fraction;
		const physicalPoint = {
			x: interpolateAxis(startPoint.x, endPoint.x, fraction),
			y: interpolateAxis(startPoint.y, endPoint.y, fraction),
			z: interpolateAxis(startPoint.z, endPoint.z, fraction)
		};
		physicalPoint[primaryAxis] = centerPrimary + Math.cos(angle) * radius;
		physicalPoint[secondaryAxis] = centerSecondary + Math.sin(angle) * radius;
		points.push(fromPhysicalPoint(physicalPoint, options));
	}

	return {
		points,
		kind: "arc",
		plane: `${primaryAxis.toUpperCase()}${secondaryAxis.toUpperCase()}`,
		center: fromPhysicalPoint({
			x: primaryAxis === "x" ? centerPrimary : startPoint.x,
			y: primaryAxis === "y" ? centerPrimary : secondaryAxis === "y" ? centerSecondary : startPoint.y,
			z: secondaryAxis === "z" ? centerSecondary : startPoint.z
		}, options),
		radius,
		startAngle,
		sweepMotionCode,
		sweepRadians: sweep,
		sweepDegrees: radiansToDegrees(sweep),
		direction: motionCode === 2 ? "CW" : "CCW",
		arcLength: radius * sweep,
		usedArcFallback: false
	};
}

function makeMotionGeometry(motionCode, start, end, path, options) {
	const delta = getProgramDelta(start, end);
	const physicalDelta = getPhysicalDelta(start, end, options);

	if (motionCode === 0 || motionCode === 1 || !path || path.usedArcFallback) {
		return {
			kind: motionCode === 0 || motionCode === 1 ? "linear" : "fallback",
			delta,
			angleFromXDegrees: getAngleFromX(physicalDelta)
		};
	}

	return {
		kind: "arc",
		delta,
		plane: path.plane,
		center: path.center,
		radius: path.radius,
		sweepDegrees: path.sweepDegrees,
		direction: path.direction,
		arcLength: path.arcLength
	};
}

function getProgramDelta(start, end) {
	return {
		x: axisDelta(start.x, end.x),
		y: axisDelta(start.y, end.y),
		z: axisDelta(start.z, end.z)
	};
}

function getPhysicalDelta(start, end, options) {
	const startPoint = toPhysicalPoint(start, options);
	const endPoint = toPhysicalPoint(end, options);

	return {
		x: axisDelta(startPoint.x, endPoint.x),
		y: axisDelta(startPoint.y, endPoint.y),
		z: axisDelta(startPoint.z, endPoint.z)
	};
}

function axisDelta(startValue, endValue) {
	if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
		return NaN;
	}

	return endValue - startValue;
}

function getAngleFromX(delta) {
	if (!Number.isFinite(delta.x)) {
		return NaN;
	}

	const nonXTravel = Math.hypot(
		Number.isFinite(delta.y) ? delta.y : 0,
		Number.isFinite(delta.z) ? delta.z : 0
	);
	const length = Math.hypot(delta.x, nonXTravel);

	if (!Number.isFinite(length) || length <= 0) {
		return NaN;
	}

	return radiansToDegrees(Math.atan2(nonXTravel, Math.abs(delta.x)));
}

function radiansToDegrees(radians) {
	return radians * 180 / Math.PI;
}

function getArcSweep(motionCode, startAngle, endAngle) {
	let sweep = motionCode === 2
		? startAngle - endAngle
		: endAngle - startAngle;

	while (sweep <= 0) {
		sweep += Math.PI * 2;
	}

	return sweep;
}

function estimatePathTime(path, state, options) {
	if (path && path.kind === "linear") {
		return estimateLinearPathTime(path, state, options);
	}

	let timeSeconds = 0;
	const rpmRange = estimatePathRpmRange(path, state, options);

	for (let index = 1; index < path.points.length; index++) {
		const start = path.points[index - 1];
		const end = path.points[index];
		const distance = getPhysicalDistance(start, end, options);
		const midpoint = midpointPosition(start, end);
		const rpm = getEffectiveRpm(midpoint, state, options);
		const feedRate = getFeedRatePerMinute(state.feed, rpm, state.feedMode);

		if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(feedRate) || feedRate <= 0) {
			continue;
		}

		timeSeconds += distance / feedRate * 60;
	}

	return {
		timeSeconds: timeSeconds > 0 ? timeSeconds : NaN,
		minRpm: rpmRange.minRpm,
		maxRpm: rpmRange.maxRpm
	};
}

function validateArcGeometry(words, start, end, arcPlane, options) {
	const plane = getArcPlaneAxes(arcPlane);
	const primaryWord = getArcOffsetWord(words, plane.primaryAxis);
	const secondaryWord = getArcOffsetWord(words, plane.secondaryAxis);
	const rWord = lastWord(words, "R");
	const hasAnyOffset = Boolean(lastWord(words, "I") || lastWord(words, "J") || lastWord(words, "K"));
	const hasPlaneOffset = Boolean(primaryWord || secondaryWord);

	if (rWord && hasAnyOffset) {
		return makeInvalidArc("conflictingDefinition", "Arc cannot use both R and I/J/K centre offsets.");
	}

	if (!rWord && !hasPlaneOffset) {
		const planeName = arcPlane === "xz" ? "G18 (I/K)" : arcPlane === "yz" ? "G19 (J/K)" : "G17 (I/J)";
		return makeInvalidArc("missingDefinition", `Arc has no R or centre-offset definition for ${planeName}.`);
	}

	if ((rWord && !Number.isFinite(rWord.value))
		|| (primaryWord && !Number.isFinite(primaryWord.value))
		|| (secondaryWord && !Number.isFinite(secondaryWord.value))) {
		return { valid: undefined };
	}

	if (!hasKnownPlanarPosition(start, end, plane)) {
		return { valid: undefined };
	}

	const startPoint = toPhysicalPoint(start, options);
	const endPoint = toPhysicalPoint(end, options);
	const deltaPrimary = endPoint[plane.primaryAxis] - startPoint[plane.primaryAxis];
	const deltaSecondary = endPoint[plane.secondaryAxis] - startPoint[plane.secondaryAxis];
	const chordLength = Math.hypot(deltaPrimary, deltaSecondary);

	if (rWord) {
		const radius = Math.abs(rWord.value);

		if (radius <= 0) {
			return makeInvalidArc("zeroRadius", "Arc radius R must be greater than zero.");
		}

		if (isNearlyZero(chordLength, radius)) {
			return makeInvalidArc("ambiguousRadiusCircle", "R cannot define a full circle; use centre offsets instead.");
		}

		if (chordLength / 2 > radius + getArcTolerance([radius, chordLength], options)) {
			return makeInvalidArc("radiusTooSmall", `Arc chord ${formatArcValue(chordLength)} is longer than diameter ${formatArcValue(radius * 2)} allowed by R${formatArcValue(rWord.value)}.`);
		}

		return { valid: true };
	}

	const primaryOffset = toPhysicalAxisDistance(plane.primaryAxis, primaryWord ? primaryWord.value : 0, options);
	const secondaryOffset = toPhysicalAxisDistance(plane.secondaryAxis, secondaryWord ? secondaryWord.value : 0, options);
	const startRadius = Math.hypot(primaryOffset, secondaryOffset);
	const endRadius = Math.hypot(
		endPoint[plane.primaryAxis] - (startPoint[plane.primaryAxis] + primaryOffset),
		endPoint[plane.secondaryAxis] - (startPoint[plane.secondaryAxis] + secondaryOffset)
	);

	if (isNearlyZero(startRadius, endRadius)) {
		return makeInvalidArc("zeroRadius", "Arc centre is at its start point, giving a zero radius.");
	}

	const mismatch = Math.abs(startRadius - endRadius);

	if (mismatch > getArcTolerance([startRadius, endRadius], options)) {
		return makeInvalidArc("centerRadiusMismatch", `Arc centre offsets give start radius ${formatArcValue(startRadius)} and end radius ${formatArcValue(endRadius)} (difference ${formatArcValue(mismatch)}).`);
	}

	return { valid: true };
}

function makeInvalidArc(code, message) {
	return { valid: false, code, message };
}

function hasKnownPlanarPosition(start, end, plane) {
	return Number.isFinite(start[plane.primaryAxis])
		&& Number.isFinite(start[plane.secondaryAxis])
		&& Number.isFinite(end[plane.primaryAxis])
		&& Number.isFinite(end[plane.secondaryAxis]);
}

function toPhysicalAxisDistance(axis, value, options) {
	return axis === "x" && options.xAxisMode === "diameter" ? value / 2 : value;
}

function getArcTolerance(values, options = {}) {
	const numericValues = Array.isArray(values) ? values : [values];
	const configuredTolerance = Number(options && options.arcTolerance);
	const absoluteTolerance = Number.isFinite(configuredTolerance)
		? Math.max(0, configuredTolerance)
		: 0;

	return Math.max(0.000001, absoluteTolerance, ...numericValues.map(value => Math.abs(value) * 0.000001));
}

function isNearlyZero(value, scale) {
	return Math.abs(value) <= getArcTolerance([value, scale]);
}

function formatArcValue(value) {
	return Number(value.toFixed(6)).toString();
}

function estimateLinearPathTime(path, state, options) {
	const points = path && Array.isArray(path.points) ? path.points : [];
	const start = points[0];
	const end = points[points.length - 1];
	const distance = start && end ? getPhysicalDistance(start, end, options) : NaN;
	const rpmRange = estimatePathRpmRange(path, state, options);
	let timeSeconds = NaN;

	if (Number.isFinite(distance) && distance > 0) {
		if (state.feedMode === "perMinute") {
			const feedRate = getFeedRatePerMinute(state.feed, NaN, state.feedMode);
			timeSeconds = Number.isFinite(feedRate) && feedRate > 0
				? distance / feedRate * 60
				: NaN;
		} else if (state.spindleMode === "css") {
			timeSeconds = estimateLinearCssFeedPerRevTime(start, end, distance, state, options);
		} else {
			const rpm = getEffectiveRpm(midpointPosition(start, end), state, options);
			const feedRate = getFeedRatePerMinute(state.feed, rpm, state.feedMode);
			timeSeconds = Number.isFinite(feedRate) && feedRate > 0
				? distance / feedRate * 60
				: NaN;
		}
	}

	return {
		timeSeconds,
		minRpm: rpmRange.minRpm,
		maxRpm: rpmRange.maxRpm
	};
}

function estimateLinearCssFeedPerRevTime(start, end, distance, state, options) {
	if (!Number.isFinite(state.feed) || state.feed <= 0 || !Number.isFinite(distance) || distance <= 0) {
		return NaN;
	}

	const cssRpmConstant = getCssRpmConstant(state, options);

	if (!Number.isFinite(cssRpmConstant) || cssRpmConstant <= 0) {
		return NaN;
	}

	const inverseRpmIntegral = integrateLinearInverseCssRpm(start.x, end.x, cssRpmConstant, state.rpmLimit);

	if (!Number.isFinite(inverseRpmIntegral) || inverseRpmIntegral <= 0) {
		return NaN;
	}

	return distance * 60 / state.feed * inverseRpmIntegral;
}

function getCssRpmConstant(state, options) {
	if (!Number.isFinite(state.cssSurfaceSpeed) || state.cssSurfaceSpeed <= 0) {
		return NaN;
	}

	return options.cssSurfaceSpeedUnit === "sfm"
		? (state.cssSurfaceSpeed * 12) / Math.PI
		: (state.cssSurfaceSpeed * 1000) / Math.PI;
}

function integrateLinearInverseCssRpm(startDiameter, endDiameter, cssRpmConstant, rpmLimit) {
	if (!Number.isFinite(startDiameter) || !Number.isFinite(endDiameter)) {
		return NaN;
	}

	const splitPoints = [0, 1];
	const delta = endDiameter - startDiameter;

	addLinearRootSplit(splitPoints, startDiameter, delta, 0);

	if (Number.isFinite(rpmLimit) && rpmLimit > 0) {
		const clampDiameter = cssRpmConstant / rpmLimit;
		addLinearRootSplit(splitPoints, startDiameter, delta, clampDiameter);
		addLinearRootSplit(splitPoints, startDiameter, delta, -clampDiameter);
	}

	splitPoints.sort((a, b) => a - b);

	let integral = 0;

	for (let index = 1; index < splitPoints.length; index++) {
		const t0 = splitPoints[index - 1];
		const t1 = splitPoints[index];

		if (t1 <= t0) {
			continue;
		}

		const midpoint = (t0 + t1) / 2;
		const midpointDiameter = startDiameter + delta * midpoint;
		const unclampedInverse = Math.abs(midpointDiameter) / cssRpmConstant;

		if (Number.isFinite(rpmLimit) && rpmLimit > 0 && unclampedInverse < 1 / rpmLimit) {
			integral += (t1 - t0) / rpmLimit;
			continue;
		}

		integral += integrateAbsoluteLinear(startDiameter, delta, t0, t1) / cssRpmConstant;
	}

	return integral;
}

function addLinearRootSplit(splitPoints, startValue, delta, targetValue) {
	if (!Number.isFinite(delta) || delta === 0) {
		return;
	}

	const t = (targetValue - startValue) / delta;

	if (t > 0 && t < 1) {
		splitPoints.push(t);
	}
}

function integrateAbsoluteLinear(startValue, delta, t0, t1) {
	const midpoint = (t0 + t1) / 2;
	const sign = startValue + delta * midpoint < 0 ? -1 : 1;
	const rawIntegral = startValue * (t1 - t0) + 0.5 * delta * (t1 * t1 - t0 * t0);

	return sign * rawIntegral;
}

function estimatePathRpmRange(path, state, options) {
	if (state.spindleMode === "fixed") {
		return Number.isFinite(state.rpm)
			? { minRpm: state.rpm, maxRpm: state.rpm }
			: { minRpm: NaN, maxRpm: NaN };
	}

	const diameters = getPathCssDiameterCandidates(path, options);
	const rpms = diameters
		.map(diameter => getEffectiveRpm({ x: diameter }, state, options))
		.filter(Number.isFinite);

	if (!rpms.length) {
		return { minRpm: NaN, maxRpm: NaN };
	}

	return {
		minRpm: Math.min(...rpms),
		maxRpm: Math.max(...rpms)
	};
}

function getPathCssDiameterCandidates(path, options) {
	const candidates = [];
	const points = path && Array.isArray(path.points) ? path.points : [];

	for (const point of points) {
		addFiniteCandidate(candidates, point.x);
	}

	for (let index = 1; index < points.length; index++) {
		const previousX = points[index - 1].x;
		const nextX = points[index].x;

		if (Number.isFinite(previousX) && Number.isFinite(nextX) && previousX * nextX < 0) {
			candidates.push(0);
		}
	}

	addArcCssDiameterExtrema(candidates, path, options);

	return candidates;
}

function addArcCssDiameterExtrema(candidates, path, options) {
	if (!path || path.kind !== "arc" || path.usedArcFallback || !path.plane || !path.plane.includes("X")) {
		return;
	}

	const center = path.center && toPhysicalPoint(path.center, options);

	if (!center || !Number.isFinite(center.x) || !Number.isFinite(path.radius) || path.radius <= 0) {
		return;
	}

	for (const angle of [0, Math.PI]) {
		if (!isAngleOnArcSweep(angle, path.startAngle, path.sweepRadians, path.sweepMotionCode)) {
			continue;
		}

		const physicalX = center.x + Math.cos(angle) * path.radius;
		addFiniteCandidate(candidates, fromPhysicalPoint({ x: physicalX }, options).x);
	}
}

function isAngleOnArcSweep(angle, startAngle, sweepRadians, sweepMotionCode) {
	if (!Number.isFinite(angle) || !Number.isFinite(startAngle) || !Number.isFinite(sweepRadians)) {
		return false;
	}

	const travel = sweepMotionCode === 2
		? normalizePositiveAngle(startAngle - angle)
		: normalizePositiveAngle(angle - startAngle);

	return travel <= sweepRadians + 1e-9;
}

function normalizePositiveAngle(angle) {
	const fullCircle = Math.PI * 2;
	let normalized = angle % fullCircle;

	if (normalized < 0) {
		normalized += fullCircle;
	}

	return normalized;
}

function addFiniteCandidate(candidates, value) {
	if (Number.isFinite(value)) {
		candidates.push(value);
	}
}

function estimateRapidTime(distance, options) {
	if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(options.rapidRate) || options.rapidRate <= 0) {
		return {
			timeSeconds: NaN,
			minRpm: NaN,
			maxRpm: NaN
		};
	}

	return {
		timeSeconds: distance / options.rapidRate * 60,
		minRpm: NaN,
		maxRpm: NaN
	};
}

function getEffectiveRpm(position, state, options) {
	if (state.spindleMode === "fixed") {
		return state.rpm;
	}

	if (!Number.isFinite(state.cssSurfaceSpeed) || state.cssSurfaceSpeed <= 0) {
		return NaN;
	}

	const diameter = Math.abs(position.x);

	if (!Number.isFinite(diameter) || diameter <= 0) {
		if (Number.isFinite(state.rpmLimit) && state.rpmLimit > 0) {
			return state.rpmLimit;
		}

		return NaN;
	}

	const rawRpm = options.cssSurfaceSpeedUnit === "sfm"
		? (state.cssSurfaceSpeed * 12) / (Math.PI * diameter)
		: (state.cssSurfaceSpeed * 1000) / (Math.PI * diameter);

	if (Number.isFinite(state.rpmLimit) && state.rpmLimit > 0) {
		return Math.min(rawRpm, state.rpmLimit);
	}

	return rawRpm;
}

function getFeedRatePerMinute(feed, rpm, feedMode) {
	if (!Number.isFinite(feed) || feed <= 0) {
		return NaN;
	}

	if (feedMode === "perMinute") {
		return feed;
	}

	if (!Number.isFinite(rpm) || rpm <= 0) {
		return NaN;
	}

	return feed * rpm;
}

function sumPathDistance(path, options) {
	let distance = 0;

	for (let index = 1; index < path.points.length; index++) {
		distance += getPhysicalDistance(path.points[index - 1], path.points[index], options);
	}

	return distance;
}

function getPhysicalDistance(start, end, options) {
	const startPoint = toPhysicalPoint(start, options);
	const endPoint = toPhysicalPoint(end, options);

	return Math.hypot(
		(endPoint.x || 0) - (startPoint.x || 0),
		(endPoint.y || 0) - (startPoint.y || 0),
		(endPoint.z || 0) - (startPoint.z || 0)
	);
}

function toPhysicalPoint(position, options) {
	return {
		x: options.xAxisMode === "diameter" && Number.isFinite(position.x) ? position.x / 2 : position.x,
		y: position.y,
		z: position.z
	};
}

function fromPhysicalPoint(position, options) {
	return {
		x: options.xAxisMode === "diameter" && Number.isFinite(position.x) ? position.x * 2 : position.x,
		y: position.y,
		z: position.z
	};
}

function midpointPosition(start, end) {
	return {
		x: averageAxis(start.x, end.x),
		y: averageAxis(start.y, end.y),
		z: averageAxis(start.z, end.z)
	};
}

function averageAxis(startValue, endValue) {
	if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
		return (startValue + endValue) / 2;
	}

	return Number.isFinite(startValue) ? startValue : endValue;
}

function interpolateAxis(startValue, endValue, fraction) {
	if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
		return startValue + (endValue - startValue) * fraction;
	}

	return Number.isFinite(startValue) ? startValue : endValue;
}

function clonePosition(position) {
	return {
		x: position.x,
		y: position.y,
		z: position.z
	};
}

function hasKnownPosition(position) {
	return Number.isFinite(position.x) || Number.isFinite(position.y) || Number.isFinite(position.z);
}

function analyzeChronobladeRange(document, range, options) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const toolRanges = getToolRanges(document);
	const rows = [];
	const targetRange = normalizeLineRange(range, document.lineCount);
	const executionEntries = options.executionTrace && Array.isArray(options.executionTrace.executionEntries)
		? options.executionTrace.executionEntries
		: undefined;
	let previousTool;
	let hasSeenProgramMotion = false;

	for (let entryIndex = 0; entryIndex < (executionEntries ? executionEntries.length : document.lineCount); entryIndex++) {
		const executionEntry = executionEntries ? executionEntries[entryIndex] : undefined;
		const lineNumber = executionEntry ? executionEntry.lineNumber : entryIndex;
		const line = executionEntry ? executionEntry.sourceLine : document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(executionEntry && executionEntry.effectiveCodeLine !== undefined ? executionEntry.effectiveCodeLine : line);
		let positionWasUpdated = false;

		if (executionEntry) {
			macroValues.clear();
			for (const [macro, value] of Object.entries(executionEntry.macroValues || {})) {
				macroValues.set(macro, value);
			}
		} else {
			trackMacroAssignments(codeLine, macroValues, macroAliases);
		}

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words, options);

		applyModalState(words, motionCode, state, options);

		if (isLineInRange(lineNumber, targetRange)) {
			const toolRange = getToolRangeAtLine(toolRanges, lineNumber);
			const labelRow = makeLabelReportRow(lineNumber, line, codeLine);

			if (labelRow) {
				attachChronobladeLineData(labelRow, lineNumber, executionEntry);
				labelRow.toolColor = getToolColor(toolRange);
				rows.push(labelRow);
			}

			for (const toolChange of makeToolChangeRows(words, previousTool, options)) {
				rows.push(attachChronobladeLineData({
					type: "tool",
					lineNumber: lineNumber + 1,
					instruction: toolChange.instruction,
					toolColor: getToolColor(getToolRangeStartingAtLine(toolRanges, lineNumber) || toolRange),
					start: "",
					end: "",
					distance: NaN,
					timeSeconds: toolChange.timeSeconds,
					feed: NaN,
					feedMode: "",
					spindle: "",
					rpmUsed: "",
					warnings: toolChange.warnings
				}, lineNumber, executionEntry));
			}

			for (const customEvent of makeCustomEventTimeRows(words, options)) {
				rows.push(attachChronobladeLineData({
					type: "other",
					lineNumber: lineNumber + 1,
					instruction: customEvent.instruction,
					toolColor: getToolColor(toolRange),
					start: "",
					end: "",
					distance: NaN,
					timeSeconds: customEvent.timeSeconds,
					feed: NaN,
					feedMode: "",
					spindle: "",
					rpmUsed: "",
					warnings: []
				}, lineNumber, executionEntry));
			}
		}

		const nextTool = getLastTool(words);

		if (nextTool) {
			previousTool = nextTool;
		}

		const activeMotionCode = Number.isFinite(motionCode) ? motionCode : state.motionCode;

		if (isDwellLine(words, options)) {
			positionWasUpdated = true;

			if (isLineInRange(lineNumber, targetRange)) {
				rows.push(attachChronobladeLineData(makeDwellReportRow(lineNumber, words, getToolRangeAtLine(toolRanges, lineNumber)), lineNumber, executionEntry));
			}
		} else if (REPORT_MOTION_CODES.has(activeMotionCode) && hasMotionAxisWords(words, options)) {
			const estimate = estimateMotion(words, activeMotionCode, state, options);
			positionWasUpdated = true;

			const isFirstProgramMotion = !hasSeenProgramMotion;
			hasSeenProgramMotion = true;
			if (!isFirstProgramMotion && isLineInRange(lineNumber, targetRange)) {
				rows.push(attachChronobladeLineData(makeMotionReportRow(lineNumber, activeMotionCode, estimate, options, getToolRangeAtLine(toolRanges, lineNumber)), lineNumber, executionEntry));
			}
		}

		if (!positionWasUpdated) {
			applyPositionUpdate(words, state, options);
		}
	}

	annotateLabelSectionTotals(rows);

	return {
		rows,
		range: targetRange,
		summary: summarizeChronobladeRows(rows)
	};
}

function attachChronobladeLineData(row, lineNumber, executionEntry) {
	row.sourceLineNumber = lineNumber + 1;
	if (executionEntry) {
		row.executionIndex = executionEntry.executionIndex;
		row.traceLine = executionEntry.traceLine;
		row.decompositionLineNumber = executionEntry.decompositionLineNumber;
	}
	return row;
}

function analyzeVisionRange(document, range, options) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const toolRanges = getToolRanges(document);
	const rows = [];
	const targetRange = normalizeLineRange(range, document.lineCount);
	const executionEntries = options.executionTrace && Array.isArray(options.executionTrace.executionEntries)
		? options.executionTrace.executionEntries
		: undefined;
	let hasSeenProgramMotion = false;

	for (let entryIndex = 0; entryIndex < (executionEntries ? executionEntries.length : document.lineCount); entryIndex++) {
		const executionEntry = executionEntries ? executionEntries[entryIndex] : undefined;
		const lineNumber = executionEntry ? executionEntry.lineNumber : entryIndex;
		const line = executionEntry ? executionEntry.sourceLine : document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(executionEntry && executionEntry.effectiveCodeLine !== undefined ? executionEntry.effectiveCodeLine : line);
		let positionWasUpdated = false;

		if (executionEntry) {
			macroValues.clear();
			for (const [macro, value] of Object.entries(executionEntry.macroValues || {})) {
				macroValues.set(macro, value);
			}
		} else {
			trackMacroAssignments(codeLine, macroValues, macroAliases);
		}

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words, options);

		applyModalState(words, motionCode, state, options);
		rebaseVisionPositionForCoordinateSystem(state, state.coordinateSystem, options);
		const startCoordinateSystem = state.positionCoordinateSystem || state.coordinateSystem;

		if (isLineInRange(lineNumber, targetRange)) {
			const toolRange = getToolRangeAtLine(toolRanges, lineNumber);
			const labelRow = makeLabelReportRow(lineNumber, line, codeLine);

			if (labelRow) {
				attachVisionLineData(labelRow, line, executionEntry);
				labelRow.toolColor = getToolColor(toolRange);
				rows.push(labelRow);
			}
		}

		const toolRange = getToolRangeStartingAtLine(toolRanges, lineNumber);

		if (toolRange && isLineInRange(lineNumber, targetRange)) {
			rows.push(attachVisionLineData(
				makeVisionToolChangeRow(lineNumber, toolRange, getPreviousToolRange(toolRanges, toolRange), state.position, state.positionCoordinateSystem || state.coordinateSystem, options),
				line,
				executionEntry
			));
		}

		if ((isProgramStopLine(words) || isCompensationLine(words) || isSpeedChangeLine(words)) && !hasMotionAxisWords(words, options) && isLineInRange(lineNumber, targetRange)) {
			rows.push(attachVisionLineData(
				makeVisionEventMarkerRow(lineNumber, words, state.position, state.positionCoordinateSystem || state.coordinateSystem, options),
				line,
				executionEntry
			));
		}

		const activeMotionCode = Number.isFinite(motionCode) ? motionCode : state.motionCode;
		const activeCycleCode = getCannedCycleCode(words);
		const hasCycleOperation = hasActiveCannedCycleOperation(words, state, activeCycleCode, options);

		if (hasCycleOperation) {
			const cycleRow = makeVisionCycleRow(lineNumber, state, words, options, getToolRangeAtLine(toolRanges, lineNumber));
			attachVisionLineData(cycleRow, line, executionEntry);
			positionWasUpdated = true;

			const isFirstProgramMotion = !hasSeenProgramMotion;
			hasSeenProgramMotion = true;
			if (!isFirstProgramMotion && isLineInRange(lineNumber, targetRange)) {
				rows.push(cycleRow);
			}

			applyCannedCyclePositionUpdate(words, state);
			state.positionCoordinateSystem = state.coordinateSystem;
		} else if (isDwellLine(words, options)) {
			positionWasUpdated = true;
		} else if (REPORT_MOTION_CODES.has(activeMotionCode) && hasMotionAxisWords(words, options)) {
			const estimate = estimateMotion(words, activeMotionCode, state, options);
			const isMachineCoordinate = hasGCodeOperation(words, G_CODE_OPERATIONS.MACHINE_COORDINATE, options);
			estimate.machineCoordinate = isMachineCoordinate;
			estimate.startCoordinateSystem = startCoordinateSystem;
			estimate.endCoordinateSystem = isMachineCoordinate
				? getGCodeWordForOperation(G_CODE_OPERATIONS.MACHINE_COORDINATE, options) || "G53"
				: state.coordinateSystem;
			positionWasUpdated = true;

			const isFirstProgramMotion = !hasSeenProgramMotion;
			hasSeenProgramMotion = true;
			state.positionCoordinateSystem = estimate.endCoordinateSystem;
			if ((!isFirstProgramMotion || hasKnownPosition(options.initialPosition || {})) && isLineInRange(lineNumber, targetRange)) {
				const row = makeVisionMotionRow(lineNumber, words, activeMotionCode, estimate, options, getToolRangeAtLine(toolRanges, lineNumber));
				attachVisionLineData(row, line, executionEntry);
				rows.push(row);
			}
		}

		if (!positionWasUpdated) {
			applyPositionUpdate(words, state, options);
			if (hasMotionAxisWords(words, options)) {
				state.positionCoordinateSystem = hasGCodeOperation(words, G_CODE_OPERATIONS.MACHINE_COORDINATE, options)
					? getGCodeWordForOperation(G_CODE_OPERATIONS.MACHINE_COORDINATE, options) || "G53"
					: state.coordinateSystem;
			}
		}
	}

	return {
		rows,
		range: targetRange,
		motionDisplayWords: getMotionDisplayWords(options)
	};
}

function attachVisionLineData(row, sourceLine, executionEntry) {
	row.sourceLine = sourceLine;
	if (executionEntry) {
		row.executionIndex = executionEntry.executionIndex;
		row.traceLine = executionEntry.traceLine;
		row.decompositionLineNumber = executionEntry.decompositionLineNumber;
	}
	return row;
}

function getToolRangeStartingAtLine(toolRanges, lineNumber) {
	return toolRanges.find(range => range.startLine === lineNumber);
}

function getPreviousToolRange(toolRanges, toolRange) {
	const index = toolRanges.indexOf(toolRange);

	return index > 0 ? toolRanges[index - 1] : undefined;
}

function getToolRangeAtLine(toolRanges, lineNumber) {
	return toolRanges.find(range => lineNumber >= range.startLine && lineNumber <= range.endLine);
}

function getToolColor(toolRange) {
	return toolRange ? TOOL_COLORS[toolRange.colorIndex % TOOL_COLORS.length] : "";
}

function normalizeLineRange(range, lineCount) {
	if (!range) {
		return {
			startLine: 0,
			endLine: Math.max(0, lineCount - 1)
		};
	}

	return {
		startLine: Math.max(0, Math.min(range.start.line, lineCount - 1)),
		endLine: Math.max(0, Math.min(range.end.line, lineCount - 1))
	};
}

function isLineInRange(lineNumber, range) {
	return lineNumber >= range.startLine && lineNumber <= range.endLine;
}

function getCannedCycleCode(words) {
	let cycleCode;

	for (const word of words) {
		if (word.letter !== "G" || !Number.isFinite(word.value)) {
			continue;
		}

		const code = Math.trunc(word.value);

		if (CANNED_CYCLE_CODES.has(code)) {
			cycleCode = code;
		}
	}

	return cycleCode;
}

function hasActiveCannedCycleOperation(words, state, cycleCode, options) {
	if (!state.cannedCycle || hasGCodeOperation(words, G_CODE_OPERATIONS.CYCLE_CANCEL, options)) {
		return false;
	}

	return Number.isFinite(cycleCode) || hasCycleSiteAxisWords(words, options);
}

function hasCycleSiteAxisWords(words, options) {
	return !isCoordinateSettingLine(words, options) && words.some(word => ["X", "Y", "U", "V"].includes(word.letter));
}

function hasMotionAxisWords(words, options) {
	return !isCoordinateSettingLine(words, options) && words.some(word => ["X", "Y", "Z", "U", "V", "W"].includes(word.letter));
}

function hasMCode(words, targetCode) {
	return words.some(word => word.letter === "M" && Number.isFinite(word.value) && Math.trunc(word.value) === targetCode);
}

function isProgramStopLine(words) {
	return [0, 1, 30].some(code => hasMCode(words, code));
}

function isProgramEndLine(words) {
	return hasMCode(words, 30);
}

function isOptionalStopLine(words) {
	return hasMCode(words, 0) || hasMCode(words, 1);
}

function isCompensationLine(words) {
	return hasAnyGCode(words, [40, 41, 42, 43, 44, 46, 49]);
}

function isCompensationCancelLine(words) {
	return hasAnyGCode(words, [40, 49]);
}

function isSpeedChangeLine(words) {
	return hasWord(words, "S");
}

function hasWord(words, letter) {
	return words.some(word => word.letter === letter && Number.isFinite(word.value));
}

function isDwellLine(words, options) {
	return hasGCodeOperation(words, G_CODE_OPERATIONS.DWELL, options);
}

function getDwellSeconds(words) {
	const secondsWord = lastWord(words, "X") || lastWord(words, "U");

	if (secondsWord && Number.isFinite(secondsWord.value) && secondsWord.value >= 0) {
		return secondsWord.value;
	}

	const millisecondsWord = lastWord(words, "P");

	if (millisecondsWord && Number.isFinite(millisecondsWord.value) && millisecondsWord.value >= 0) {
		return millisecondsWord.value / 1000;
	}

	return NaN;
}

function isCoordinateSettingLine(words, options) {
	return hasGCodeOperation(words, G_CODE_OPERATIONS.COORDINATE_SETTING, options);
}

function makeToolChangeRows(words, previousTool, options) {
	const tool = getLastTool(words);

	if (!tool) {
		return [];
	}

	return [{
		instruction: tool.label,
		timeSeconds: estimateToolChangeTime(previousTool, tool, options),
		warnings: []
	}];
}

function makeLabelReportRow(lineNumber, line, codeLine) {
	const match = codeLine.match(/^\s*(N\d+)/i);

	if (!match) {
		return undefined;
	}

	return {
		type: "label",
		lineNumber: lineNumber + 1,
		instruction: match[1].toUpperCase(),
		comment: getLineComments(line).join(" "),
		labelTotalTimeSeconds: 0,
		labelUnknownTimeRows: 0,
		start: "",
		end: "",
		distance: NaN,
		timeSeconds: 0,
		feed: NaN,
		feedMode: "",
		spindle: "",
		rpmUsed: "",
		warnings: []
	};
}

function getLineComments(line) {
	return getCommentRanges(line)
		.map(range => line.slice(range.start, range.end + 1).trim())
		.filter(Boolean);
}

function getLastTool(words) {
	const toolWord = lastWord(words, "T");

	if (!toolWord) {
		return undefined;
	}

	if (!Number.isFinite(toolWord.value)) {
		return {
			label: `T${toolWord.raw.trim()}`,
			station: undefined,
			offset: undefined
		};
	}

	const value = Math.abs(Math.trunc(toolWord.value));
	const toolDigits = /^\d{1,4}$/.test(toolWord.raw.trim())
		? toolWord.raw.trim()
		: String(value).slice(-4);

	return {
		label: `T${toolDigits}`,
		station: Number(toolDigits.length >= 4 ? toolDigits.slice(0, 2) : toolDigits),
		offset: toolDigits.length >= 4 ? Number(toolDigits.slice(2, 4)) : undefined
	};
}

function estimateToolChangeTime(previousTool, tool, options) {
	if (previousTool && previousTool.station === tool.station && previousTool.offset === tool.offset) {
		return 0;
	}

	const baseTime = Number.isFinite(options.toolChangeSeconds) ? options.toolChangeSeconds : 0;

	if (!previousTool || !Number.isFinite(previousTool.station) || !Number.isFinite(tool.station)) {
		return baseTime;
	}

	const stationGap = Math.abs(tool.station - previousTool.station);
	const extraStationSteps = Math.max(0, stationGap - 1);
	const extraStationTime = Number.isFinite(options.extraStationSeconds) ? options.extraStationSeconds : 0;

	return baseTime + extraStationSteps * extraStationTime;
}

function makeMotionReportRow(lineNumber, motionCode, estimate, options, toolRange) {
	const humanFormat = options && options.humanFormat;
	const showsFeed = motionCode >= 1 && motionCode <= 3;

	return {
		type: "motion",
		lineNumber: lineNumber + 1,
		instruction: estimate.motionWord || `G${motionCode}`,
		toolColor: getToolColor(toolRange),
		start: formatPosition(estimate.start, humanFormat),
		end: formatPosition(estimate.end, humanFormat),
		distance: estimate.distance,
		timeSeconds: estimate.timeSeconds,
		feed: showsFeed ? estimate.feed : NaN,
		feedMode: showsFeed ? estimate.feedMode : "",
		feedModeWord: showsFeed ? estimate.feedModeWord : "",
		spindle: formatSpindle(estimate, humanFormat),
		rpmUsed: formatRpmUsed(estimate, humanFormat),
		warnings: estimate.warnings || []
	};
}

function makeCustomEventTimeRows(words, options) {
	const customEventTimes = options && options.customEventTimes;

	if (!customEventTimes || typeof customEventTimes !== "object") {
		return [];
	}

	return words
		.filter(word => word.letter === "M" && Number.isInteger(word.value))
		.map(word => {
			const code = `M${Math.abs(word.value)}`;
			const timeSeconds = Number(customEventTimes[code]);
			return Number.isFinite(timeSeconds) && timeSeconds >= 0
				? { instruction: `M${String(Math.abs(word.value)).padStart(2, "0")}`, timeSeconds }
				: undefined;
		})
		.filter(Boolean);
}

function makeDwellReportRow(lineNumber, words, toolRange) {
	const timeSeconds = getDwellSeconds(words);

	return {
		type: "dwell",
		lineNumber: lineNumber + 1,
		instruction: "G4",
		toolColor: getToolColor(toolRange),
		start: "",
		end: "",
		distance: NaN,
		timeSeconds,
		feed: NaN,
		feedMode: "",
		spindle: "",
		rpmUsed: "",
		warnings: Number.isFinite(timeSeconds) ? [] : ["Dwell time is unknown."]
	};
}

function makeVisionMotionRow(lineNumber, words, motionCode, estimate, options, toolRange) {
	const toolColor = getToolColor(toolRange);
	const machineCoordinateWord = getGCodeWordForOperation(G_CODE_OPERATIONS.MACHINE_COORDINATE, options) || "G53";
	const coordinateSystem = estimate.machineCoordinate ? machineCoordinateWord : estimate.coordinateSystem || "";
	const startCoordinateSystem = estimate.startCoordinateSystem || estimate.coordinateSystem || "";
	const endCoordinateSystem = estimate.endCoordinateSystem || coordinateSystem;
	const start = clonePosition(estimate.start);
	const end = clonePosition(estimate.end);
	const marker = makeVisionEndpointMarker(words);

	return {
		type: "motion",
		lineNumber: lineNumber + 1,
		instruction: estimate.machineCoordinate
			? `${machineCoordinateWord} ${estimate.motionWord || `G${motionCode}`}`
			: estimate.motionWord || `G${motionCode}`,
		motionCode,
		tool: toolRange ? toolRange.tool : "",
		toolColor,
		coordinateSystem,
		start,
		end,
		startLabel: formatPosition(start, options.humanFormat),
		endLabel: formatPosition(end, options.humanFormat),
		distance: estimate.distance,
		timeSeconds: estimate.timeSeconds,
		points: (estimate.pathPoints || []).map((point, index) => toVisionPoint(
			point,
			options,
			index === 0 ? startCoordinateSystem : endCoordinateSystem,
			estimate.machineCoordinate && index > 0
		)),
		markerClass: marker.className,
		markerKind: marker.kind,
		warnings: estimate.warnings || []
	};
}

function makeVisionCycleRow(lineNumber, state, words, options, toolRange) {
	const cycle = state.cannedCycle || {};
	const site = makeCycleSitePosition(state.position, words, state.distanceMode);
	const top = clonePosition(site);
	const bottom = clonePosition(site);
	const warnings = collectUnresolvedWordWarnings(words, ["X", "Y", "Z", "R", "Q", "P", "U", "V", "F"]);
	const topZ = getCannedCycleTopZ(cycle, state.position);

	if (Number.isFinite(topZ)) {
		top.z = topZ;
	}

	if (Number.isFinite(cycle.z)) {
		bottom.z = cycle.z;
	} else {
		warnings.push(`G${cycle.code} cycle has no Z depth.`);
	}

	const hasDrawableDepth = Number.isFinite(top.x)
		&& Number.isFinite(top.y)
		&& Number.isFinite(top.z)
		&& Number.isFinite(bottom.z);
	const points = hasDrawableDepth
		? [toVisionPoint(top, options, state.coordinateSystem), toVisionPoint(bottom, options, state.coordinateSystem)]
		: [];

	return {
		type: "cycle",
		lineNumber: lineNumber + 1,
		instruction: `G${cycle.code}`,
		cycleCode: cycle.code,
		tool: toolRange ? toolRange.tool : "",
		toolColor: getToolColor(toolRange),
		coordinateSystem: state.coordinateSystem || "",
		point: toVisionPoint(bottom, options, state.coordinateSystem),
		start: top,
		end: bottom,
		startLabel: formatPosition(top, options.humanFormat),
		endLabel: formatPosition(bottom, options.humanFormat),
		distance: hasDrawableDepth ? getPhysicalDistance(top, bottom, options) : NaN,
		timeSeconds: NaN,
		points,
		warnings
	};
}

function makeVisionEventMarkerRow(lineNumber, words, position, coordinateSystem, options) {
	const marker = makeVisionEndpointMarker(words);

	return {
		type: "event",
		lineNumber: lineNumber + 1,
		instruction: marker.label || "Event",
		coordinateSystem: coordinateSystem || "",
		point: toVisionPoint(position, options, coordinateSystem),
		position: clonePosition(position),
		markerClass: marker.className,
		markerKind: marker.kind,
		distance: NaN,
		points: [],
		warnings: []
	};
}

function makeVisionToolChangeRow(lineNumber, toolRange, previousToolRange, position, coordinateSystem, options) {
	const toolColor = getToolColor(toolRange);
	const previousToolColor = getToolColor(previousToolRange);
	const previousTool = previousToolRange ? previousToolRange.tool : "";

	return {
		type: "tool",
		lineNumber: lineNumber + 1,
		instruction: previousTool ? `${previousTool} -> ${toolRange.tool}` : toolRange.tool,
		previousTool,
		tool: toolRange.tool,
		previousToolColor,
		toolColor,
		coordinateSystem: coordinateSystem || "",
		point: toVisionPoint(position, options, coordinateSystem),
		position: clonePosition(position),
		distance: NaN,
		points: [],
		warnings: []
	};
}

function makeVisionEndpointMarker(words) {
	if (isProgramEndLine(words)) {
		return { className: "endpoint endpoint-program-end", kind: "programEnd", label: getProgramStopLabel(words) };
	}

	if (isOptionalStopLine(words)) {
		return { className: "endpoint endpoint-optional-stop", kind: "optionalStop", label: getProgramStopLabel(words) };
	}

	if (isSpeedChangeLine(words)) {
		return { className: "endpoint endpoint-speed-change", kind: "speedChange", label: getSpeedChangeLabel(words) };
	}

	if (isCompensationCancelLine(words)) {
		return { className: "endpoint endpoint-compensation-cancel", kind: "compensationCancel", label: getCompensationLabel(words) };
	}

	if (isCompensationLine(words)) {
		return { className: "endpoint endpoint-compensation", kind: "compensation", label: getCompensationLabel(words) };
	}

	return { className: "endpoint", kind: "endpoint", label: "" };
}

function hasAnyGCode(words, codes) {
	return codes.some(code => hasGCode(words, code));
}

function getCompensationLabel(words) {
	for (const code of [40, 41, 42, 43, 44, 46, 49]) {
		if (hasGCode(words, code)) {
			return `G${code}`;
		}
	}

	return "Compensation";
}

function getSpeedChangeLabel(words) {
	return hasWord(words, "S") ? "S" : "Speed";
}

function getProgramStopLabel(words) {
	if (hasMCode(words, 0)) {
		return "M00";
	}

	if (hasMCode(words, 1)) {
		return "M01";
	}

	if (hasMCode(words, 30)) {
		return "M30";
	}

	return "Stop";
}

function makeCycleSitePosition(position, words, distanceMode) {
	const site = clonePosition(position);
	const axes = [
		{ position: "X", incremental: "U", key: "x" },
		{ position: "Y", incremental: "V", key: "y" }
	];

	for (const axis of axes) {
		const positionWord = lastWord(words, axis.position);
		const incrementalWord = lastWord(words, axis.incremental);

		if (positionWord && Number.isFinite(positionWord.value)) {
			if (distanceMode === "incremental" && Number.isFinite(site[axis.key])) {
				site[axis.key] += positionWord.value;
			} else {
				site[axis.key] = positionWord.value;
			}
		}

		if (incrementalWord && Number.isFinite(incrementalWord.value) && Number.isFinite(site[axis.key])) {
			site[axis.key] += incrementalWord.value;
		}
	}

	return site;
}

function applyCannedCyclePositionUpdate(words, state) {
	const site = makeCycleSitePosition(state.position, words, state.distanceMode);
	const cycle = state.cannedCycle || {};
	const retractZ = cycle.retractMode === "r" && Number.isFinite(cycle.r)
		? cycle.r
		: cycle.initialZ;

	state.position = Object.assign(site, {
		z: Number.isFinite(retractZ) ? retractZ : site.z
	});
}

function getCannedCycleTopZ(cycle, position) {
	if (Number.isFinite(cycle.r)) {
		return cycle.r;
	}

	return position.z;
}

function toVisionPoint(point, options, coordinateSystem, machineCoordinate = false) {
	const displayPoint = shiftVisionPosition(point, coordinateSystem, options, machineCoordinate);
	const physicalPoint = toPhysicalPoint(displayPoint, options);

	return {
		x: physicalPoint.x,
		y: physicalPoint.y,
		z: physicalPoint.z
	};
}

function shiftVisionPosition(point, coordinateSystem, options = {}, machineCoordinate = false) {
	const shifted = clonePosition(point || {});
	const offset = getVisionWorkOffset(machineCoordinate ? "G53" : coordinateSystem, options);

	if (!offset) {
		return shifted;
	}

	for (const axis of ["x", "y", "z"]) {
		if (Number.isFinite(shifted[axis]) && Number.isFinite(offset[axis])) {
			shifted[axis] += offset[axis];
		}
	}

	return shifted;
}

function rebaseVisionPositionForCoordinateSystem(state, coordinateSystem, options) {
	const previousCoordinateSystem = state.positionCoordinateSystem;

	if (!previousCoordinateSystem || previousCoordinateSystem === coordinateSystem) {
		return;
	}

	const previousOffset = getVisionWorkOffset(previousCoordinateSystem, options);
	const nextOffset = getVisionWorkOffset(coordinateSystem, options);
	for (const axis of ["x", "y", "z"]) {
		if (Number.isFinite(state.position[axis])) {
			state.position[axis] += (Number(previousOffset[axis]) || 0) - (Number(nextOffset[axis]) || 0);
		}
	}
	state.positionCoordinateSystem = coordinateSystem;
}

function getVisionWorkOffset(coordinateSystem, options = {}) {
	const offsets = options.workOffsets || {};
	const offset = offsets[coordinateSystem] || {};
	const referenceOffset = offsets[options.referenceFrame || "G53"] || {};

	return {
		x: (Number.isFinite(offset.x) ? offset.x : 0) - (Number.isFinite(referenceOffset.x) ? referenceOffset.x : 0),
		y: (Number.isFinite(offset.y) ? offset.y : 0) - (Number.isFinite(referenceOffset.y) ? referenceOffset.y : 0),
		z: (Number.isFinite(offset.z) ? offset.z : 0) - (Number.isFinite(referenceOffset.z) ? referenceOffset.z : 0)
	};
}
function summarizeVisionRows(rows) {
	const motionRows = rows.filter(row => row.type === "motion");

	return {
		moveCount: motionRows.length,
		totalDistance: motionRows.reduce((total, row) => total + (Number.isFinite(row.distance) ? row.distance : 0), 0),
		unknownRows: motionRows.filter(row => !Number.isFinite(row.distance) || !row.points.length).length
	};
}

function annotateLabelSectionTotals(rows) {
	let currentLabel;
	let sectionTimeSeconds = 0;
	let sectionUnknownTimeRows = 0;

	const flush = () => {
		if (!currentLabel) {
			return;
		}

		currentLabel.labelTotalTimeSeconds = sectionTimeSeconds;
		currentLabel.labelUnknownTimeRows = sectionUnknownTimeRows;
	};

	for (const row of rows) {
		if (row.type === "label") {
			flush();
			currentLabel = row;
			sectionTimeSeconds = 0;
			sectionUnknownTimeRows = 0;
			continue;
		}

		if (!currentLabel) {
			continue;
		}

		if (Number.isFinite(row.timeSeconds)) {
			sectionTimeSeconds += row.timeSeconds;
		} else {
			sectionUnknownTimeRows++;
		}
	}

	flush();
}

function summarizeChronobladeRows(rows) {
	const summary = {
		totalTimeSeconds: 0,
		unknownTimeRows: 0,
		totalDistance: 0,
		cuttingDistance: 0,
		rapidTimeSeconds: 0,
		cuttingTimeSeconds: 0,
		dwellTimeSeconds: 0,
		toolTimeSeconds: 0,
		otherTimeSeconds: 0
	};

	for (const row of rows) {
		if (row.type === "label") {
			continue;
		}

		if (Number.isFinite(row.distance)) {
			summary.totalDistance += row.distance;
			if (row.type === "motion" && row.instruction !== "G0") {
				summary.cuttingDistance += row.distance;
			}
		}

		if (!Number.isFinite(row.timeSeconds)) {
			summary.unknownTimeRows++;
			continue;
		}

		summary.totalTimeSeconds += row.timeSeconds;

		if (row.type === "tool") {
			summary.toolTimeSeconds += row.timeSeconds;
		} else if (row.type === "dwell") {
			summary.dwellTimeSeconds += row.timeSeconds;
		} else if (row.type === "other") {
			summary.otherTimeSeconds += row.timeSeconds;
		} else if (row.instruction === "G0") {
			summary.rapidTimeSeconds += row.timeSeconds;
		} else {
			summary.cuttingTimeSeconds += row.timeSeconds;
		}
	}

	return summary;
}

function formatSpindle(estimate, humanFormat) {
	if (estimate.spindleMode === "css") {
		return `${estimate.spindleModeWord || "G96"} S${formatCompactModalNumber(estimate.cssSurfaceSpeed, humanFormat)}${Number.isFinite(estimate.rpmLimit) ? ` [${estimate.rpmLimitWord || "limit"} S${formatCompactModalNumber(estimate.rpmLimit, humanFormat)}]` : ""}`;
	}

	if (Number.isFinite(estimate.rpm)) {
		return `${estimate.spindleModeWord || "G97"} S${formatCompactModalNumber(estimate.rpm, humanFormat)}`;
	}

	return "";
}

function formatRpmUsed(estimate, humanFormat) {
	if (Number.isFinite(estimate.minRpm) && Number.isFinite(estimate.maxRpm)) {
		if (Math.abs(estimate.minRpm - estimate.maxRpm) < 0.000000001) {
			return formatNumber(estimate.minRpm, humanFormat);
		}

		return `${formatNumber(estimate.minRpm, humanFormat)} - ${formatNumber(estimate.maxRpm, humanFormat)}`;
	}

	return "";
}

function formatCompactModalNumber(value, humanFormat) {
	const formatted = formatNumber(value, humanFormat);

	if (!String(formatted).includes(".")) {
		return formatted;
	}

	return String(formatted)
		.replace(/(\.\d*?)0+$/, "$1")
		.replace(/\.$/, "");
}

function formatPosition(position, options) {
	return formatHumanPosition(position, options);
}

function formatNumber(value, options) {
	return formatHumanNumber(value, options);
}

function formatTime(seconds) {
	return formatHumanTime(seconds);
}

module.exports = {
	estimateMotionAtLine,
	getMotionCodeForGCode,
	analyzeArcAtLine,
	analyzeArcsInDocument,
	// Read-only modal snapshot for the KAIJU Sense status bar.
	getModalStateAtLine,
	formatModalStateStatus,
	getStatusModalGroups,
	analyzeChronobladeRange,
	analyzeVisionRange,
	summarizeVisionRows,
	formatPosition,
	formatNumber,
	formatTime
};
