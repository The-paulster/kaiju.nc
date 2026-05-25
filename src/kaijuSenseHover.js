const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");
const {
	estimateMotionAtLine,
	formatNumber,
	formatTime
} = require("./motionEngine");

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

	return new vscode.Hover(renderKaijuSenseHover(estimate));
}

function getSenseOptions(document) {
	const senseConfig = vscode.workspace.getConfiguration("kaijuNC.sense", document.uri);
	const chronobladeConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);

	return {
		enabled: senseConfig.get("enabled", chronobladeConfig.get("enabled", true)),
		xAxisMode: senseConfig.get("xAxisMode", chronobladeConfig.get("xAxisMode", "diameter")),
		cssSurfaceSpeedUnit: senseConfig.get("cssSurfaceSpeedUnit", chronobladeConfig.get("cssSurfaceSpeedUnit", "mPerMin")),
		samples: clampNumber(senseConfig.get("samples", chronobladeConfig.get("samples", 96)), 12, 500),
		rapidRate: clampNumber(senseConfig.get("rapidRate", chronobladeConfig.get("rapidRate", 10000)), 0, Number.POSITIVE_INFINITY)
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

function renderKaijuSenseHover(estimate) {
	const md = new vscode.MarkdownString();
	const geometry = estimate.geometry || {};

	md.appendMarkdown(`**KAIJU Sense - G${String(estimate.motionCode).padStart(2, "0")}**\n\n`);
	md.appendMarkdown(`**Start:** \`${formatPosition(estimate.start)}\`\n\n`);
	md.appendMarkdown(`**End:** \`${formatPosition(estimate.end)}\`\n\n`);
	md.appendMarkdown(`**Delta:** \`${formatDelta(geometry.delta)}\`\n\n`);
	md.appendMarkdown(`**Path length:** \`${formatNumber(estimate.distance)}\`\n\n`);

	if (geometry.kind === "arc") {
		appendArcGeometry(md, geometry);
	} else {
		appendLinearGeometry(md, geometry);
	}

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

function appendLinearGeometry(md, geometry) {
	if (Number.isFinite(geometry.angleFromXDegrees)) {
		md.appendMarkdown(`**Angle from X:** \`${formatNumber(geometry.angleFromXDegrees)} deg\`\n\n`);
	}
}

function appendArcGeometry(md, geometry) {
	if (geometry.direction) {
		md.appendMarkdown(`**Arc direction:** \`${geometry.direction}\`\n\n`);
	}

	if (geometry.plane) {
		md.appendMarkdown(`**Arc plane:** \`${geometry.plane}\`\n\n`);
	}

	if (geometry.center) {
		md.appendMarkdown(`**Center:** \`${formatPosition(geometry.center)}\`\n\n`);
	}

	if (Number.isFinite(geometry.radius)) {
		md.appendMarkdown(`**Radius:** \`${formatNumber(geometry.radius)}\`\n\n`);
	}

	if (Number.isFinite(geometry.sweepDegrees)) {
		md.appendMarkdown(`**Sweep:** \`${formatNumber(geometry.sweepDegrees)} deg\`\n\n`);
	}

	if (Number.isFinite(geometry.arcLength)) {
		md.appendMarkdown(`**Circle length:** \`${formatNumber(geometry.arcLength)}\`\n\n`);
	}

}

function formatPosition(position) {
	return ["x", "y", "z"]
		.filter(axis => Number.isFinite(position[axis]))
		.map(axis => `${axis.toUpperCase()}${formatNumber(position[axis])}`)
		.join(" ") || "unknown";
}

function formatDelta(delta) {
	if (!delta) {
		return "unknown";
	}

	const parts = ["x", "y", "z"]
		.filter(axis => Number.isFinite(delta[axis]))
		.map(axis => `${axis.toUpperCase()}${formatSignedNumber(delta[axis])}`);

	return parts.length ? parts.join(" ") : "unknown";
}

function formatSignedNumber(value) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	const formatted = formatNumber(value);
	return value > 0 ? `+${formatted}` : formatted;
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	registerKaijuSenseHover
};
