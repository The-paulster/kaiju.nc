// Role: provide KAIJU Sense motion hovers for G00-G03 moves. Keep status bar
// rendering in statusBar.js and keep macro hovers in macro.js.
const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("../MetaTextRanges");
const {
	estimateMotionAtLine,
	formatNumber,
	formatTime
} = require("../MetaMotionEngine");
const { getSenseOptions } = require("./options");

function registerKaijuSenseHover(context) {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ language: "gcode" }, {
			provideHover(document, position) {
				return provideKaijuSenseHover(document, position);
			}
		})
	);
}

function provideKaijuSenseHover(document, position) {
	if (document.languageId !== "gcode") {
		return undefined;
	}

	const hoveredMotion = getMotionAtPosition(document, position);

	if (!hoveredMotion) {
		return undefined;
	}

	const options = getSenseOptions(document);

	if (!options.enabled) {
		return undefined;
	}

	const estimate = estimateMotionAtLine(document, position.line, hoveredMotion, options);

	if (!estimate) {
		return undefined;
	}

	return new vscode.Hover(renderKaijuSenseHover(estimate, options));
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

	const motionRegex = /\bG0?([0123])\b/gi;
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

function renderKaijuSenseHover(estimate, options = {}) {
	const md = new vscode.MarkdownString();
	const geometry = estimate.geometry || {};
	const humanFormat = options.humanFormat;
	const coloredValues = options.syntaxColoredHoverValues === true;

	md.appendMarkdown(`**KAIJU Sense - G${String(estimate.motionCode).padStart(2, "0")}**\n\n`);
	appendHoverValue(md, "Start", formatPosition(estimate.start, humanFormat), coloredValues);
	appendHoverValue(md, "End", formatPosition(estimate.end, humanFormat), coloredValues);
	appendHoverValue(md, "Delta", formatDelta(geometry.delta, humanFormat), coloredValues);
	appendHoverValue(md, "Path length", formatNumber(estimate.distance, humanFormat), coloredValues);

	if (geometry.kind === "arc") {
		appendArcGeometry(md, geometry, humanFormat, coloredValues);
	} else {
		appendLinearGeometry(md, geometry, humanFormat, coloredValues);
	}

	appendHoverValue(md, "Estimated time", formatTime(estimate.timeSeconds), coloredValues);

	if (Number.isFinite(estimate.feed)) {
		appendHoverValue(md, "Feed", `F${formatNumber(estimate.feed, humanFormat)} (${estimate.feedMode === "perRev" ? "per rev" : "per min"})`, coloredValues);
	}

	if (estimate.spindleMode === "css") {
		appendHoverValue(md, "Spindle", `G96 S${formatNumber(estimate.cssSurfaceSpeed, humanFormat)}${Number.isFinite(estimate.rpmLimit) ? ` G50 S${formatNumber(estimate.rpmLimit, humanFormat)}` : ""}`, coloredValues);
	} else if (Number.isFinite(estimate.rpm)) {
		appendHoverValue(md, "Spindle", `G97 S${formatNumber(estimate.rpm, humanFormat)}`, coloredValues);
	}

	if (Number.isFinite(estimate.minRpm) && Number.isFinite(estimate.maxRpm)) {
		appendHoverValue(md, "RPM used", `S${formatNumber(estimate.minRpm, humanFormat)} - S${formatNumber(estimate.maxRpm, humanFormat)}`, coloredValues);
	}

	if (estimate.usedArcFallback) {
		md.appendMarkdown("`Arc center not found; using chord distance.`\n\n");
	}

	for (const warning of estimate.warnings || []) {
		md.appendMarkdown(`\`${warning}\`\n\n`);
	}

	return md;
}

function appendHoverValue(md, label, value, coloredValues) {
	md.appendMarkdown(`**${label}:**`);

	if (coloredValues) {
		md.appendMarkdown("\n\n");
		md.appendCodeblock(value, "gcode");
		md.appendMarkdown("\n");
		return;
	}

	md.appendMarkdown(` \`${value}\`\n\n`);
}

function appendLinearGeometry(md, geometry, humanFormat, coloredValues) {
	if (Number.isFinite(geometry.angleFromXDegrees)) {
		appendHoverValue(md, "Angle from X", `${formatNumber(geometry.angleFromXDegrees, humanFormat)} deg`, coloredValues);
	}
}

function appendArcGeometry(md, geometry, humanFormat, coloredValues) {
	if (geometry.direction) {
		appendHoverValue(md, "Arc direction", geometry.direction, coloredValues);
	}

	if (geometry.plane) {
		appendHoverValue(md, "Arc plane", geometry.plane, coloredValues);
	}

	if (geometry.center) {
		appendHoverValue(md, "Center", formatPosition(geometry.center, humanFormat), coloredValues);
	}

	if (Number.isFinite(geometry.radius)) {
		appendHoverValue(md, "Radius", formatNumber(geometry.radius, humanFormat), coloredValues);
	}

	if (Number.isFinite(geometry.sweepDegrees)) {
		appendHoverValue(md, "Sweep", `${formatNumber(geometry.sweepDegrees, humanFormat)} deg`, coloredValues);
	}

	if (Number.isFinite(geometry.arcLength)) {
		appendHoverValue(md, "Circle length", formatNumber(geometry.arcLength, humanFormat), coloredValues);
	}

}

function formatPosition(position, humanFormat) {
	return ["x", "y", "z"]
		.filter(axis => Number.isFinite(position[axis]))
		.map(axis => `${axis.toUpperCase()}${formatNumber(position[axis], humanFormat)}`)
		.join(" ") || "unknown";
}

function formatDelta(delta, humanFormat) {
	if (!delta) {
		return "unknown";
	}

	const parts = ["x", "y", "z"]
		.filter(axis => Number.isFinite(delta[axis]))
		.map(axis => `${axis.toUpperCase()}${formatSignedNumber(delta[axis], humanFormat)}`);

	return parts.length ? parts.join(" ") : "unknown";
}

function formatSignedNumber(value, humanFormat) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	const formatted = formatNumber(value, humanFormat);
	return value > 0 ? `+${formatted}` : formatted;
}

module.exports = {
	registerKaijuSenseHover
};
