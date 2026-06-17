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

	return new vscode.Hover(renderKaijuSenseHover(estimate, options.humanFormat));
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

function renderKaijuSenseHover(estimate, humanFormat) {
	const md = new vscode.MarkdownString();
	const geometry = estimate.geometry || {};

	md.appendMarkdown(`**KAIJU Sense - G${String(estimate.motionCode).padStart(2, "0")}**\n\n`);
	md.appendMarkdown(`**Start:** \`${formatPosition(estimate.start, humanFormat)}\`\n\n`);
	md.appendMarkdown(`**End:** \`${formatPosition(estimate.end, humanFormat)}\`\n\n`);
	md.appendMarkdown(`**Delta:** \`${formatDelta(geometry.delta, humanFormat)}\`\n\n`);
	md.appendMarkdown(`**Path length:** \`${formatNumber(estimate.distance, humanFormat)}\`\n\n`);

	if (geometry.kind === "arc") {
		appendArcGeometry(md, geometry, humanFormat);
	} else {
		appendLinearGeometry(md, geometry, humanFormat);
	}

	md.appendMarkdown(`**Estimated time:** \`${formatTime(estimate.timeSeconds)}\`\n\n`);

	if (Number.isFinite(estimate.feed)) {
		md.appendMarkdown(`**Feed:** \`${formatNumber(estimate.feed, humanFormat)} ${estimate.feedMode === "perRev" ? "per rev" : "per min"}\`\n\n`);
	}

	if (estimate.spindleMode === "css") {
		md.appendMarkdown(`**Spindle:** \`G96 S${formatNumber(estimate.cssSurfaceSpeed, humanFormat)}${Number.isFinite(estimate.rpmLimit) ? `, limit ${formatNumber(estimate.rpmLimit, humanFormat)} rpm` : ""}\`\n\n`);
	} else if (Number.isFinite(estimate.rpm)) {
		md.appendMarkdown(`**Spindle:** \`G97 ${formatNumber(estimate.rpm, humanFormat)} rpm\`\n\n`);
	}

	if (Number.isFinite(estimate.minRpm) && Number.isFinite(estimate.maxRpm)) {
		md.appendMarkdown(`**RPM used:** \`${formatNumber(estimate.minRpm, humanFormat)} - ${formatNumber(estimate.maxRpm, humanFormat)}\`\n\n`);
	}

	if (estimate.usedArcFallback) {
		md.appendMarkdown("`Arc center not found; using chord distance.`\n\n");
	}

	for (const warning of estimate.warnings || []) {
		md.appendMarkdown(`\`${warning}\`\n\n`);
	}

	return md;
}

function appendLinearGeometry(md, geometry, humanFormat) {
	if (Number.isFinite(geometry.angleFromXDegrees)) {
		md.appendMarkdown(`**Angle from X:** \`${formatNumber(geometry.angleFromXDegrees, humanFormat)} deg\`\n\n`);
	}
}

function appendArcGeometry(md, geometry, humanFormat) {
	if (geometry.direction) {
		md.appendMarkdown(`**Arc direction:** \`${geometry.direction}\`\n\n`);
	}

	if (geometry.plane) {
		md.appendMarkdown(`**Arc plane:** \`${geometry.plane}\`\n\n`);
	}

	if (geometry.center) {
		md.appendMarkdown(`**Center:** \`${formatPosition(geometry.center, humanFormat)}\`\n\n`);
	}

	if (Number.isFinite(geometry.radius)) {
		md.appendMarkdown(`**Radius:** \`${formatNumber(geometry.radius, humanFormat)}\`\n\n`);
	}

	if (Number.isFinite(geometry.sweepDegrees)) {
		md.appendMarkdown(`**Sweep:** \`${formatNumber(geometry.sweepDegrees, humanFormat)} deg\`\n\n`);
	}

	if (Number.isFinite(geometry.arcLength)) {
		md.appendMarkdown(`**Circle length:** \`${formatNumber(geometry.arcLength, humanFormat)}\`\n\n`);
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
