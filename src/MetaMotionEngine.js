// Role: interpret G-code motion/modal state and provide shared motion analysis
// primitives. UI modules may read snapshots from here, but editor rendering and
// product UI belong in the KAIJU feature modules. Status bar modal definitions
// are data-driven from MetaModalDefs.json.
const {
	getCommentRanges,
	getAngleBracketRanges
} = require("./MetaTextRanges");
const {
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
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
const STATUS_MODAL_GROUPS = require("./MetaModalDefs.json");

const HOVER_MOTION_CODES = new Set([0, 1, 2, 3]);
const REPORT_MOTION_CODES = new Set([0, 1, 2, 3]);
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
		const motionCode = getMotionCode(words);

		applyModalState(words, motionCode, state);

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
// position. Status-only modal groups live in MetaModalDefs.json so
// future built-in or custom modal codes can be added without touching
// Chronoblade, Vision, or Sense hover timing.
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
		const motionCode = getMotionCode(words);

		applyModalState(words, motionCode, state);
		applyStatusModalState(words, statusState);
	}

	return {
		motionCode: state.motionCode,
		feedMode: state.feedMode,
		spindleMode: state.spindleMode,
		modalGroups: getStatusModalEntries(statusState)
	};
}

function makeInitialState(options = {}) {
	return {
		position: {},
		motionCode: undefined,
		arcPlane: "xy",
		distanceMode: "absolute",
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
	const defaultFeedModeCode = options.defaultFeedMode === "perMinute" ? 94 : 95;

	setStatusModalEntry(statusState, "feedMode", defaultFeedModeCode);
	setStatusModalEntry(statusState, "spindleSpeedMode", 97);

	return statusState;
}

function trackMacroAssignments(codeLine, macroValues, macroAliases) {
	for (const assignment of findAssignments(codeLine)) {
		const value = evaluateNumericExpression(assignment.value, macroValues, macroAliases);
		setMacroValue(macroValues, assignment.macro, value, macroAliases);
	}
}

function findAssignments(codeLine) {
	const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g;
	const matches = [...codeLine.matchAll(assignmentRegex)];

	return matches.map((match, index) => {
		const nextMatch = matches[index + 1];
		const valueStart = match.index + match[0].length;
		const semicolonStart = codeLine.indexOf(";", valueStart);
		const valueEnd = Math.min(
			nextMatch ? nextMatch.index : codeLine.length,
			semicolonStart === -1 ? codeLine.length : semicolonStart
		);

		return {
			macro: normalizeMacro(match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0]),
			value: codeLine.slice(valueStart, valueEnd).trim()
		};
	});
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

function getMotionCode(words) {
	let motionCode;

	for (const word of words) {
		if (word.letter !== "G" || !Number.isFinite(word.value)) {
			continue;
		}

		const code = Math.trunc(word.value);

		if (code >= 0 && code <= 3) {
			motionCode = code;
		}
	}

	return motionCode;
}

function applyModalState(words, motionCode, state) {
	const sWord = lastWord(words, "S");
	const dWord = lastWord(words, "D");
	const fWord = lastWord(words, "F");
	let hasG50 = false;
	let cycleCode;
	let cancelCycle = false;

	for (const word of words) {
		if (word.letter !== "G" || !Number.isFinite(word.value)) {
			continue;
		}

		const code = Math.trunc(word.value);

		if (word.value === 90) {
			state.distanceMode = "absolute";
		} else if (word.value === 91) {
			state.distanceMode = "incremental";
		} else if (code === 98) {
			state.cannedCycleRetractMode = "initial";
		} else if (code === 94) {
			state.feedMode = "perMinute";
		} else if (code === 95) {
			state.feedMode = "perRev";
		} else if (code === 99) {
			state.feedMode = "perRev";
			state.cannedCycleRetractMode = "r";
		} else if (code === 17) {
			state.arcPlane = "xy";
		} else if (code === 18) {
			state.arcPlane = "xz";
		} else if (code === 19) {
			state.arcPlane = "yz";
		} else if (code === 80) {
			cancelCycle = true;
		} else if (CANNED_CYCLE_CODES.has(code)) {
			cycleCode = code;
		} else if (code === 96) {
			state.spindleMode = "css";
		} else if (code === 97) {
			state.spindleMode = "fixed";
		} else if (code === 50 && sWord && Number.isFinite(sWord.value)) {
			hasG50 = true;
			state.rpmLimit = sWord.value;
		}
	}

	if (sWord && Number.isFinite(sWord.value) && !hasG50) {
		if (state.spindleMode === "css") {
			state.cssSurfaceSpeed = sWord.value;
		} else {
			state.rpm = sWord.value;
		}
	}

	if (dWord && Number.isFinite(dWord.value)) {
		state.rpmLimit = dWord.value;
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

function applyStatusModalState(words, statusState) {
	for (const group of STATUS_MODAL_GROUPS) {
		for (const word of words) {
			if (word.letter !== group.letter || !Number.isFinite(word.value)) {
				continue;
			}

			setStatusModalEntry(statusState, group.key, Math.trunc(word.value), word, words);
		}
	}
}

function setStatusModalEntry(statusState, groupKey, code, word, words = []) {
	const group = STATUS_MODAL_GROUPS.find(candidate => candidate.key === groupKey);
	const definition = group && group.codes[code];

	if (!group || !definition) {
		return;
	}

	const entry = definition.formatter
		? makeFormattedStatusModalEntry(definition.formatter, word, words, group, definition)
		: makeStatusModalEntry(group, definition);

	if (entry) {
		statusState.set(group.key, entry);
	}
}

function makeFormattedStatusModalEntry(formatter, word, words, group, definition) {
	if (formatter === "speedLimitS") {
		return makeSpeedLimitStatusEntry(word, words, group, definition);
	}

	return undefined;
}

function makeStatusModalEntry(group, definition) {
	return {
		key: group.key,
		order: group.order,
		code: definition.code,
		label: definition.label
	};
}

function makeSpeedLimitStatusEntry(word, words, group, definition) {
	const sWord = lastWord(words, "S");

	if (!sWord || !Number.isFinite(sWord.value)) {
		return undefined;
	}

	return {
		key: group.key,
		order: group.order,
		code: `G50 S${formatCodeNumber(sWord.value)}`,
		label: definition.label
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
		machineCoordinate: hasGCode(words, 53),
		start,
		end,
		distance,
		timeSeconds: timing.timeSeconds,
		minRpm: timing.minRpm,
		maxRpm: timing.maxRpm,
		feed: state.feed,
		feedMode: state.feedMode,
		spindleMode: state.spindleMode,
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
	if (isCoordinateSettingLine(words)) {
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
	const g53Position = hasGCode(words, 53) ? options.g53Position : undefined;

	for (const axis of axisWords) {
		const positionWord = lastWord(words, axis.position);
		const incrementalWord = lastWord(words, axis.incremental);

		if (positionWord && Number.isFinite(positionWord.value)) {
			if (g53Position && Number.isFinite(g53Position[axis.key])) {
				end[axis.key] = g53Position[axis.key];
			} else if (distanceMode === "incremental" && Number.isFinite(end[axis.key])) {
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
	const points = [];

	for (let step = 0; step <= options.samples; step++) {
		const fraction = step / options.samples;

		points.push({
			x: interpolateAxis(start.x, end.x, fraction),
			y: interpolateAxis(start.y, end.y, fraction),
			z: interpolateAxis(start.z, end.z, fraction)
		});
	}

	return {
		points,
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
	const centerPrimary = startPoint[primaryAxis] + primaryOffset;
	const centerSecondary = startPoint[secondaryAxis] + secondaryOffset;
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
	let timeSeconds = 0;
	let minRpm = Infinity;
	let maxRpm = -Infinity;

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

		if (Number.isFinite(rpm)) {
			minRpm = Math.min(minRpm, rpm);
			maxRpm = Math.max(maxRpm, rpm);
		}

		timeSeconds += distance / feedRate * 60;
	}

	return {
		timeSeconds: timeSeconds > 0 ? timeSeconds : NaN,
		minRpm: minRpm === Infinity ? NaN : minRpm,
		maxRpm: maxRpm === -Infinity ? NaN : maxRpm
	};
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

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of protectedRanges) {
		for (let index = range.start; index <= range.end; index++) {
			characters[index] = " ";
		}
	}

	return characters.join("");
}

function analyzeChronobladeRange(document, range, options) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const toolRanges = getToolRanges(document);
	const rows = [];
	const targetRange = normalizeLineRange(range, document.lineCount);
	let previousTool;

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);
		let positionWasUpdated = false;

		trackMacroAssignments(codeLine, macroValues, macroAliases);

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words);

		applyModalState(words, motionCode, state);

		if (isLineInRange(lineNumber, targetRange)) {
			const toolRange = getToolRangeAtLine(toolRanges, lineNumber);
			const labelRow = makeLabelReportRow(lineNumber, line, codeLine);

			if (labelRow) {
				labelRow.toolColor = getToolColor(toolRange);
				rows.push(labelRow);
			}

			for (const toolChange of makeToolChangeRows(words, previousTool, options)) {
				rows.push({
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
				});
			}
		}

		const nextTool = getLastTool(words);

		if (nextTool) {
			previousTool = nextTool;
		}

		const activeMotionCode = Number.isFinite(motionCode) ? motionCode : state.motionCode;

		if (REPORT_MOTION_CODES.has(activeMotionCode) && hasMotionAxisWords(words)) {
			const estimate = estimateMotion(words, activeMotionCode, state, options);
			positionWasUpdated = true;

			if (isLineInRange(lineNumber, targetRange)) {
				rows.push(makeMotionReportRow(lineNumber, activeMotionCode, estimate, options, getToolRangeAtLine(toolRanges, lineNumber)));
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

function analyzeVisionRange(document, range, options) {
	const state = makeInitialState(options);
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
	const toolRanges = getToolRanges(document);
	const rows = [];
	const targetRange = normalizeLineRange(range, document.lineCount);

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const codeLine = maskProtectedRanges(line);
		let positionWasUpdated = false;

		trackMacroAssignments(codeLine, macroValues, macroAliases);

		const words = parseWords(codeLine, macroValues, macroAliases);
		const motionCode = getMotionCode(words);

		applyModalState(words, motionCode, state);

		if (isLineInRange(lineNumber, targetRange)) {
			const toolRange = getToolRangeAtLine(toolRanges, lineNumber);
			const labelRow = makeLabelReportRow(lineNumber, line, codeLine);

			if (labelRow) {
				labelRow.toolColor = getToolColor(toolRange);
				rows.push(labelRow);
			}
		}

		const toolRange = getToolRangeStartingAtLine(toolRanges, lineNumber);

		if (toolRange && isLineInRange(lineNumber, targetRange)) {
			rows.push(makeVisionToolChangeRow(lineNumber, toolRange, getPreviousToolRange(toolRanges, toolRange), state.position, options));
		}

		const activeMotionCode = Number.isFinite(motionCode) ? motionCode : state.motionCode;
		const activeCycleCode = getCannedCycleCode(words);
		const hasCycleOperation = hasActiveCannedCycleOperation(words, state, activeCycleCode);

		if (hasCycleOperation) {
			const cycleRow = makeVisionCycleRow(lineNumber, state, words, options, getToolRangeAtLine(toolRanges, lineNumber));
			positionWasUpdated = true;

			if (isLineInRange(lineNumber, targetRange)) {
				rows.push(cycleRow);
			}

			applyCannedCyclePositionUpdate(words, state);
		} else if (REPORT_MOTION_CODES.has(activeMotionCode) && hasMotionAxisWords(words)) {
			const estimate = estimateMotion(words, activeMotionCode, state, options);
			positionWasUpdated = true;

			if (isLineInRange(lineNumber, targetRange)) {
				rows.push(makeVisionMotionRow(lineNumber, activeMotionCode, estimate, options, getToolRangeAtLine(toolRanges, lineNumber)));
			}
		}

		if (!positionWasUpdated) {
			applyPositionUpdate(words, state, options);
		}
	}

	return {
		rows,
		range: targetRange
	};
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

function hasActiveCannedCycleOperation(words, state, cycleCode) {
	if (!state.cannedCycle || hasGCode(words, 80)) {
		return false;
	}

	return Number.isFinite(cycleCode) || hasCycleSiteAxisWords(words);
}

function hasCycleSiteAxisWords(words) {
	return !isCoordinateSettingLine(words) && words.some(word => ["X", "Y", "U", "V"].includes(word.letter));
}

function hasMotionAxisWords(words) {
	return !isCoordinateSettingLine(words) && words.some(word => ["X", "Y", "Z", "U", "V", "W"].includes(word.letter));
}

function isCoordinateSettingLine(words) {
	return hasGCode(words, 10);
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

	return {
		type: "motion",
		lineNumber: lineNumber + 1,
		instruction: `G${motionCode}`,
		toolColor: getToolColor(toolRange),
		start: formatPosition(estimate.start, humanFormat),
		end: formatPosition(estimate.end, humanFormat),
		distance: estimate.distance,
		timeSeconds: estimate.timeSeconds,
		feed: estimate.feed,
		feedMode: estimate.feedMode,
		spindle: formatSpindle(estimate, humanFormat),
		rpmUsed: formatRpmUsed(estimate, humanFormat),
		warnings: estimate.warnings || []
	};
}

function makeVisionMotionRow(lineNumber, motionCode, estimate, options, toolRange) {
	const toolColor = getToolColor(toolRange);

	return {
		type: "motion",
		lineNumber: lineNumber + 1,
		instruction: estimate.machineCoordinate ? `G53 G${motionCode}` : `G${motionCode}`,
		motionCode,
		tool: toolRange ? toolRange.tool : "",
		toolColor,
		start: clonePosition(estimate.start),
		end: clonePosition(estimate.end),
		startLabel: formatPosition(estimate.start, options.humanFormat),
		endLabel: formatPosition(estimate.end, options.humanFormat),
		distance: estimate.distance,
		timeSeconds: estimate.timeSeconds,
		points: (estimate.pathPoints || []).map(point => toVisionPoint(point, options)),
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
		? [toVisionPoint(top, options), toVisionPoint(bottom, options)]
		: [];

	return {
		type: "cycle",
		lineNumber: lineNumber + 1,
		instruction: `G${cycle.code}`,
		cycleCode: cycle.code,
		tool: toolRange ? toolRange.tool : "",
		toolColor: getToolColor(toolRange),
		point: toVisionPoint(bottom, options),
		start: clonePosition(top),
		end: clonePosition(bottom),
		startLabel: formatPosition(top, options.humanFormat),
		endLabel: formatPosition(bottom, options.humanFormat),
		distance: hasDrawableDepth ? getPhysicalDistance(top, bottom, options) : NaN,
		timeSeconds: NaN,
		points,
		warnings
	};
}

function makeVisionToolChangeRow(lineNumber, toolRange, previousToolRange, position, options) {
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
		point: toVisionPoint(position, options),
		distance: NaN,
		points: [],
		warnings: []
	};
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

function toVisionPoint(point, options) {
	const physicalPoint = toPhysicalPoint(point, options);

	return {
		x: physicalPoint.x,
		y: physicalPoint.y,
		z: physicalPoint.z
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
		rapidTimeSeconds: 0,
		cuttingTimeSeconds: 0,
		toolTimeSeconds: 0
	};

	for (const row of rows) {
		if (row.type === "label") {
			continue;
		}

		if (Number.isFinite(row.distance)) {
			summary.totalDistance += row.distance;
		}

		if (!Number.isFinite(row.timeSeconds)) {
			summary.unknownTimeRows++;
			continue;
		}

		summary.totalTimeSeconds += row.timeSeconds;

		if (row.type === "tool") {
			summary.toolTimeSeconds += row.timeSeconds;
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
		return `G96 S${formatNumber(estimate.cssSurfaceSpeed, humanFormat)}${Number.isFinite(estimate.rpmLimit) ? ` / limit ${formatNumber(estimate.rpmLimit, humanFormat)}` : ""}`;
	}

	if (Number.isFinite(estimate.rpm)) {
		return `G97 ${formatNumber(estimate.rpm, humanFormat)} rpm`;
	}

	return "";
}

function formatRpmUsed(estimate, humanFormat) {
	if (Number.isFinite(estimate.minRpm) && Number.isFinite(estimate.maxRpm)) {
		return `${formatNumber(estimate.minRpm, humanFormat)} - ${formatNumber(estimate.maxRpm, humanFormat)}`;
	}

	return "";
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
