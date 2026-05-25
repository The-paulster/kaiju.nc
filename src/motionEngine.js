const {
	getCommentRanges,
	getAngleBracketRanges
} = require("./textRanges");
const {
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	setMacroValue
} = require("./macroExpressions");

const HOVER_MOTION_CODES = new Set([0, 1, 2, 3]);
const REPORT_MOTION_CODES = new Set([0, 1, 2, 3]);

function estimateMotionAtLine(document, targetLineNumber, hoveredMotion, options) {
	const state = makeInitialState();
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

		applyPositionUpdate(words, state);
	}

	return undefined;
}

function makeInitialState() {
	return {
		position: {},
		motionCode: undefined,
		feed: undefined,
		feedMode: "perRev",
		spindleMode: "fixed",
		rpm: undefined,
		cssSurfaceSpeed: undefined,
		rpmLimit: undefined
	};
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

	for (const word of words) {
		if (word.letter !== "G" || !Number.isFinite(word.value)) {
			continue;
		}

		const code = Math.trunc(word.value);

		if (code === 94) {
			state.feedMode = "perMinute";
		} else if (code === 95) {
			state.feedMode = "perRev";
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
	const end = makeEndPosition(start, words);

	if (!hasKnownPosition(start) || !hasKnownPosition(end)) {
		applyPositionUpdate(words, state);
		return makeUnavailableEstimate(motionCode, start, end, "Start or end position is incomplete.");
	}

	const path = buildPathPoints(motionCode, start, end, words, options);
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

	applyPositionUpdate(words, state);

	return {
		motionCode,
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
		start,
		end,
		distance: NaN,
		timeSeconds: NaN,
		warnings: [reason]
	};
}

function applyPositionUpdate(words, state) {
	state.position = makeEndPosition(state.position, words);
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

function makeEndPosition(start, words) {
	const end = clonePosition(start);
	const axisWords = [
		{ absolute: "X", incremental: "U", key: "x" },
		{ absolute: "Y", incremental: "V", key: "y" },
		{ absolute: "Z", incremental: "W", key: "z" }
	];

	for (const axis of axisWords) {
		const absoluteWord = lastWord(words, axis.absolute);
		const incrementalWord = lastWord(words, axis.incremental);

		if (absoluteWord && Number.isFinite(absoluteWord.value)) {
			end[axis.key] = absoluteWord.value;
		}

		if (incrementalWord && Number.isFinite(incrementalWord.value) && Number.isFinite(end[axis.key])) {
			end[axis.key] += incrementalWord.value;
		}
	}

	return end;
}

function buildPathPoints(motionCode, start, end, words, options) {
	if (motionCode === 0 || motionCode === 1) {
		return buildLinearPathPoints(start, end, options);
	}

	return buildArcPathPoints(motionCode, start, end, words, options);
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

function buildArcPathPoints(motionCode, start, end, words, options) {
	const iWord = lastWord(words, "I");
	const jWord = lastWord(words, "J");
	const kWord = lastWord(words, "K");
	const rWord = lastWord(words, "R");
	const useXzPlane = Number.isFinite(start.x)
		&& Number.isFinite(start.z)
		&& Number.isFinite(end.x)
		&& Number.isFinite(end.z)
		&& iWord
		&& kWord
		&& Number.isFinite(iWord.value)
		&& Number.isFinite(kWord.value);

	if (useXzPlane) {
		return buildPlanarArcPath(
			motionCode,
			start,
			end,
			"x",
			"z",
			iWord.value,
			kWord.value,
			options
		);
	}

	const useXzRadius = Number.isFinite(start.x)
		&& Number.isFinite(start.z)
		&& Number.isFinite(end.x)
		&& Number.isFinite(end.z)
		&& rWord
		&& Number.isFinite(rWord.value);

	if (useXzRadius) {
		const path = buildRadiusArcPath(
			motionCode,
			start,
			end,
			"x",
			"z",
			rWord.value,
			options
		);

		if (path) {
			return path;
		}
	}

	const useXyPlane = Number.isFinite(start.x)
		&& Number.isFinite(start.y)
		&& Number.isFinite(end.x)
		&& Number.isFinite(end.y)
		&& iWord
		&& jWord
		&& Number.isFinite(iWord.value)
		&& Number.isFinite(jWord.value);

	if (useXyPlane) {
		return buildPlanarArcPath(
			motionCode,
			start,
			end,
			"x",
			"y",
			iWord.value,
			jWord.value,
			options
		);
	}

	const useXyRadius = Number.isFinite(start.x)
		&& Number.isFinite(start.y)
		&& Number.isFinite(end.x)
		&& Number.isFinite(end.y)
		&& rWord
		&& Number.isFinite(rWord.value);

	if (useXyRadius) {
		const path = buildRadiusArcPath(
			motionCode,
			start,
			end,
			"x",
			"y",
			rWord.value,
			options
		);

		if (path) {
			return path;
		}
	}

	return {
		points: [start, end],
		kind: "arc",
		usedArcFallback: true
	};
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
	const state = makeInitialState();
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
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
			for (const toolChange of makeToolChangeRows(words, previousTool, options)) {
				rows.push({
					type: "tool",
					lineNumber: lineNumber + 1,
					instruction: toolChange.instruction,
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
				rows.push(makeMotionReportRow(lineNumber, activeMotionCode, estimate));
			}
		}

		if (!positionWasUpdated) {
			applyPositionUpdate(words, state);
		}
	}

	return {
		rows,
		range: targetRange,
		summary: summarizeChronobladeRows(rows)
	};
}

function analyzeVisionRange(document, range, options) {
	const state = makeInitialState();
	const macroValues = new Map();
	const macroAliases = buildMacroAliasMap(document);
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

		const activeMotionCode = Number.isFinite(motionCode) ? motionCode : state.motionCode;

		if (REPORT_MOTION_CODES.has(activeMotionCode) && hasMotionAxisWords(words)) {
			const estimate = estimateMotion(words, activeMotionCode, state, options);
			positionWasUpdated = true;

			if (isLineInRange(lineNumber, targetRange)) {
				rows.push(makeVisionMotionRow(lineNumber, activeMotionCode, estimate, options));
			}
		}

		if (!positionWasUpdated) {
			applyPositionUpdate(words, state);
		}
	}

	return {
		rows,
		range: targetRange
	};
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

function hasMotionAxisWords(words) {
	return words.some(word => ["X", "Y", "Z", "U", "V", "W"].includes(word.letter));
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

function getLastTool(words) {
	const toolWord = lastWord(words, "T");

	if (!toolWord || !Number.isFinite(toolWord.value)) {
		return undefined;
	}

	const value = Math.abs(Math.trunc(toolWord.value));
	const toolDigits = String(value).padStart(4, "0").slice(-4);

	return {
		label: `T${toolDigits}`,
		station: Number(toolDigits.slice(0, 2)),
		offset: Number(toolDigits.slice(2, 4))
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

function makeMotionReportRow(lineNumber, motionCode, estimate) {
	return {
		type: "motion",
		lineNumber: lineNumber + 1,
		instruction: `G${motionCode}`,
		start: formatPosition(estimate.start),
		end: formatPosition(estimate.end),
		distance: estimate.distance,
		timeSeconds: estimate.timeSeconds,
		feed: estimate.feed,
		feedMode: estimate.feedMode,
		spindle: formatSpindle(estimate),
		rpmUsed: formatRpmUsed(estimate),
		warnings: estimate.warnings || []
	};
}

function makeVisionMotionRow(lineNumber, motionCode, estimate, options) {
	return {
		lineNumber: lineNumber + 1,
		instruction: `G${motionCode}`,
		motionCode,
		start: clonePosition(estimate.start),
		end: clonePosition(estimate.end),
		startLabel: formatPosition(estimate.start),
		endLabel: formatPosition(estimate.end),
		distance: estimate.distance,
		timeSeconds: estimate.timeSeconds,
		points: (estimate.pathPoints || []).map(point => toVisionPoint(point, options)),
		warnings: estimate.warnings || []
	};
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
	return {
		moveCount: rows.length,
		totalDistance: rows.reduce((total, row) => total + (Number.isFinite(row.distance) ? row.distance : 0), 0),
		unknownRows: rows.filter(row => !Number.isFinite(row.distance) || !row.points.length).length
	};
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

function formatSpindle(estimate) {
	if (estimate.spindleMode === "css") {
		return `G96 S${formatNumber(estimate.cssSurfaceSpeed)}${Number.isFinite(estimate.rpmLimit) ? ` / limit ${formatNumber(estimate.rpmLimit)}` : ""}`;
	}

	if (Number.isFinite(estimate.rpm)) {
		return `G97 ${formatNumber(estimate.rpm)} rpm`;
	}

	return "";
}

function formatRpmUsed(estimate) {
	if (Number.isFinite(estimate.minRpm) && Number.isFinite(estimate.maxRpm)) {
		return `${formatNumber(estimate.minRpm)} - ${formatNumber(estimate.maxRpm)}`;
	}

	return "";
}

function formatPosition(position) {
	return ["x", "y", "z"]
		.filter(axis => Number.isFinite(position[axis]))
		.map(axis => `${axis.toUpperCase()}${formatNumber(position[axis])}`)
		.join(" ");
}

function formatNumber(value) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	const rounded = Math.abs(value) >= 100
		? value.toFixed(2)
		: value.toFixed(4);

	return rounded.replace(/\.?0+$/, "");
}

function formatTime(seconds) {
	if (!Number.isFinite(seconds)) {
		return "unknown";
	}

	if (seconds < 60) {
		return `${seconds.toFixed(2)} s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds - minutes * 60;

	return `${minutes} min ${remainingSeconds.toFixed(1)} s`;
}

module.exports = {
	estimateMotionAtLine,
	analyzeChronobladeRange,
	analyzeVisionRange,
	summarizeVisionRows,
	formatPosition,
	formatNumber,
	formatTime
};
