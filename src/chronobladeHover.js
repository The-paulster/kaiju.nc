const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");
const {
	estimateMotionAtLine,
	formatPosition,
	formatNumber,
	formatTime
} = require("./chronobladeEngine");

function registerChronobladeHover(context) {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ language: "gcode" }, {
			provideHover(document, position) {
				return provideChronobladeHover(document, position);
			}
		})
	);
}

function provideChronobladeHover(document, position) {
	if (document.languageId !== "gcode") {
		return undefined;
	}

	const hoveredMotion = getMotionAtPosition(document, position);

	if (!hoveredMotion) {
		return undefined;
	}

	const options = getChronobladeOptions(document);

	if (!options.enabled) {
		return undefined;
	}

	const estimate = estimateMotionAtLine(document, position.line, hoveredMotion, options);

	if (!estimate) {
		return undefined;
	}

	return new vscode.Hover(renderChronobladeHover(estimate));
}

function getChronobladeOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);

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

function renderChronobladeHover(estimate) {
	const md = new vscode.MarkdownString();

	md.appendMarkdown(`**KAIJU Chronoblade - G${String(estimate.motionCode).padStart(2, "0")}**\n\n`);
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

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	registerChronobladeHover
};
