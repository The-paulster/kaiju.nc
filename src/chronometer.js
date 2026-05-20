const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");
const {
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	setMacroValue
} = require("./macroExpressions");

const MOTION_CODES = new Set([1, 2, 3]);

function registerChronometer(context) {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ language: "gcode" }, {
			provideHover(document, position) {
				return provideChronometerHover(document, position);
			}
		})
	);
}

function provideChronometerHover(document, position) {
	if (document.languageId !== "gcode") {
		return undefined;
	}

	const hoveredMotion = getMotionAtPosition(document, position);

	if (!hoveredMotion) {
		return undefined;
	}

	const options = getChronometerOptions(document);

	if (!options.enabled) {
		return undefined;
	}

	const estimate = estimateMotionAtLine(document, position.line, hoveredMotion, options);

	if (!estimate) {
		return undefined;
	}

	return new vscode.Hover(renderChronometerHover(estimate));
}

function getChronometerOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.chronometer", document.uri);

	return {
		enabled: config.get("enabled", true),
		xAxisMode: config.get("xAxisMode", "diameter"),
		cssSurfaceSpeedUnit: config.get("cssSurfaceSpeedUnit", "mPerMin"),
		samples: clampNumber(config.get("samples", 96), 12, 500)
	};
}

function getMotionAtPosition(document, position) {
	const line = document.lineAt(position.line).text;
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	if (isInsideRange(position.character, protectedRanges)) {
		return undefined;
	}

	const motionRegex = /\bG0?([123])\b/gi;
	let match;

	while ((match = motionRegex.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		if (position.character >= start && position.character <= end) {
			return {
				code: Number(match[1]),
				text: match[0].toUpperCase()
			};
		}
	}

	return undefined;
}

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
			if (motionCode !== hoveredMotion.code || !MOTION_CODES.has(motionCode)) {
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

	if (motionCode === 0) {
		return;
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
		return makeUnavailableEstimate(motionCode, start, end, "Start or end position is incomplete.");
	}

	const path = buildPathPoints(motionCode, start, end, words, options);
	const distance = sumPathDistance(path, options);
	const timing = estimatePathTime(path, state, options);
	const warnings = [];

	if (distance <= 0) {
		warnings.push("Move distance is zero.");
	}

	if (!Number.isFinite(state.feed) || state.feed <= 0) {
		warnings.push("Feed is unknown or zero.");
	}

	if (state.feedMode === "perRev" && state.spindleMode === "fixed" && (!Number.isFinite(state.rpm) || state.rpm <= 0)) {
		warnings.push("Fixed RPM is unknown or zero.");
	}

	if (state.feedMode === "perRev" && state.spindleMode === "css" && (!Number.isFinite(state.cssSurfaceSpeed) || state.cssSurfaceSpeed <= 0)) {
		warnings.push("CSS surface speed is unknown or zero.");
	}

	if (state.spindleMode === "css" && !Number.isFinite(state.rpmLimit)) {
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

function makeEndPosition(start, words) {
	const end = clonePosition(start);

	for (const axis of ["X", "Y", "Z"]) {
		const word = lastWord(words, axis);

		if (word && Number.isFinite(word.value)) {
			end[axis.toLowerCase()] = word.value;
		}
	}

	return end;
}

function buildPathPoints(motionCode, start, end, words, options) {
	if (motionCode === 1) {
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
		usedArcFallback: false
	};
}

function buildArcPathPoints(motionCode, start, end, words, options) {
	const iWord = lastWord(words, "I");
	const jWord = lastWord(words, "J");
	const kWord = lastWord(words, "K");
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

	return {
		points: [start, end],
		usedArcFallback: true
	};
}

function buildPlanarArcPath(motionCode, start, end, primaryAxis, secondaryAxis, primaryOffset, secondaryOffset, options) {
	const startPoint = toPhysicalPoint(start, options);
	const endPoint = toPhysicalPoint(end, options);
	const centerPrimary = startPoint[primaryAxis] + primaryOffset;
	const centerSecondary = startPoint[secondaryAxis] + secondaryOffset;
	const startAngle = Math.atan2(startPoint[secondaryAxis] - centerSecondary, startPoint[primaryAxis] - centerPrimary);
	const endAngle = Math.atan2(endPoint[secondaryAxis] - centerSecondary, endPoint[primaryAxis] - centerPrimary);
	const sweep = getArcSweep(motionCode, startAngle, endAngle);
	const steps = Math.max(8, Math.ceil(options.samples * Math.min(1, sweep / (Math.PI * 2))));
	const points = [];

	for (let step = 0; step <= steps; step++) {
		const fraction = step / steps;
		const angle = motionCode === 2
			? startAngle - sweep * fraction
			: startAngle + sweep * fraction;
		const physicalPoint = {
			x: interpolateAxis(startPoint.x, endPoint.x, fraction),
			y: interpolateAxis(startPoint.y, endPoint.y, fraction),
			z: interpolateAxis(startPoint.z, endPoint.z, fraction)
		};
		const radius = Math.hypot(
			startPoint[primaryAxis] - centerPrimary,
			startPoint[secondaryAxis] - centerSecondary
		);

		physicalPoint[primaryAxis] = centerPrimary + Math.cos(angle) * radius;
		physicalPoint[secondaryAxis] = centerSecondary + Math.sin(angle) * radius;
		points.push(fromPhysicalPoint(physicalPoint, options));
	}

	return {
		points,
		usedArcFallback: false
	};
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

function renderChronometerHover(estimate) {
	const md = new vscode.MarkdownString();

	md.appendMarkdown(`**KAIJU Chronometer - G${String(estimate.motionCode).padStart(2, "0")}**\n\n`);
	md.appendMarkdown(`**Start:** \`${formatPosition(estimate.start)}\`\n\n`);
	md.appendMarkdown(`**End:** \`${formatPosition(estimate.end)}\`\n\n`);
	md.appendMarkdown(`**Distance:** \`${formatNumber(estimate.distance)}\`\n\n`);
	md.appendMarkdown(`**Estimated time:** \`${formatTime(estimate.timeSeconds)}\`\n\n`);

	if (Number.isFinite(estimate.feed)) {
		md.appendMarkdown(`**Feed:** \`${formatNumber(estimate.feed)} ${estimate.feedMode === "perRev" ? "per rev" : "per min"}\`\n\n`);
	}

	if (estimate.spindleMode === "css") {
		md.appendMarkdown(`**Spindle:** \`G96 S${formatNumber(estimate.cssSurfaceSpeed)}${Number.isFinite(estimate.rpmLimit) ? `, limit ${formatNumber(estimate.rpmLimit)} rpm` : ""}\`\n\n`);
	} else if (Number.isFinite(estimate.rpm)) {
		md.appendMarkdown(`**Spindle:** \`G97 ${formatNumber(estimate.rpm)} rpm\`\n\n`);
	}

	if (Number.isFinite(estimate.minRpm) && Number.isFinite(estimate.maxRpm)) {
		md.appendMarkdown(`**RPM used:** \`${formatNumber(estimate.minRpm)} - ${formatNumber(estimate.maxRpm)}\`\n\n`);
	}

	if (estimate.usedArcFallback) {
		md.appendMarkdown("`Arc center not found; using chord distance.`\n\n");
	}

	for (const warning of estimate.warnings || []) {
		md.appendMarkdown(`\`${warning}\`\n\n`);
	}

	return md;
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

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	registerChronometer,
	estimateMotionAtLine
};
