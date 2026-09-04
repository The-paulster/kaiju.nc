// Role: own KAIJU Chronoblade configuration reads. Keep report rendering and
// webview behavior in webview.js.
const vscode = require("vscode");
const {
	getMachineModeForDocument
} = require("../MetaMachineMode");

function getChronobladeOptions(document, rawOptions = {}) {
	const reportConfig = vscode.workspace.getConfiguration("kaijuNC.chronoblade", document.uri);
	const displayConfig = vscode.workspace.getConfiguration("kaijuNC.display", document.uri);
	const machineMode = getMachineModeForDocument(document);
	const profile = machineMode.profile;
	const timingProfiles = getTimingProfiles(reportConfig);
	const timingProfile = getTimingProfile(timingProfiles, rawOptions.timingProfile);

	return {
		analysisMode: rawOptions.analysisMode === "asWritten" ? "asWritten" : "trace",
		showTraceLine: rawOptions.showTraceLine === true,
		live: rawOptions.live === true,
		machineMode: profile.id,
		gCodeDialectId: machineMode.gCodeDialectId,
		defaultFeedMode: profile.defaultFeedMode,
		xAxisMode: machineMode.xAxisMode,
		cssSurfaceSpeedUnit: reportConfig.get("cssSurfaceSpeedUnit", "mPerMin"),
		samples: clampNumber(reportConfig.get("samples", 96), 12, 500),
		compactPanelWidth: clampNumber(reportConfig.get("compactPanelWidth", 0.45), 0.2, 0.7),
		timingProfiles,
		timingProfile: timingProfile.name,
		hasTimingOverrides: ["rapidRate", "toolChangeSeconds", "extraStationSeconds"].some(key => Object.prototype.hasOwnProperty.call(rawOptions, key)),
		rapidRate: clampNumber(coalesce(rawOptions.rapidRate, timingProfile.rapidRate), 0, Number.POSITIVE_INFINITY),
		toolChangeSeconds: clampNumber(coalesce(rawOptions.toolChangeSeconds, timingProfile.toolChangeSeconds), 0, Number.POSITIVE_INFINITY),
		extraStationSeconds: clampNumber(coalesce(rawOptions.extraStationSeconds, timingProfile.extraStationSeconds), 0, Number.POSITIVE_INFINITY),
		customEventTimes: timingProfile.customEventTimes,
		significantFiguresOnly: reportConfig.get("significantFiguresOnly", false) === true,
		hideZeroTimeLabels: reportConfig.get("hideZeroTimeLabels", true) !== false,
		humanFormat: {
			minimumDecimalPlaces: clampNumber(displayConfig.get("minimumDecimalPlaces", 3), 0, 9),
			maximumDecimalPlaces: clampNumber(displayConfig.get("maximumDecimalPlaces", 3), 0, 9)
		}
	};
}

function getTimingProfiles(reportConfig) {
	const defaultProfile = {
		name: "Default",
		rapidRate: clampNumber(reportConfig.get("rapidRate", 10000), 0, Number.POSITIVE_INFINITY),
		toolChangeSeconds: clampNumber(reportConfig.get("toolChangeSeconds", 4), 0, Number.POSITIVE_INFINITY),
		extraStationSeconds: clampNumber(reportConfig.get("extraStationSeconds", 0.5), 0, Number.POSITIVE_INFINITY),
		customEventTimes: {}
	};
	const configuredProfiles = reportConfig.get("timingProfiles", []);

	if (!Array.isArray(configuredProfiles)) {
		return [defaultProfile];
	}

	const names = new Set([defaultProfile.name.toLowerCase()]);
	const profiles = [defaultProfile];

	for (const configured of configuredProfiles) {
		if (!configured || typeof configured !== "object") continue;
		const name = String(configured.name || "").trim();
		if (!name || names.has(name.toLowerCase())) continue;
		names.add(name.toLowerCase());
		profiles.push({
			name,
			rapidRate: clampNumber(coalesce(configured.rapidRate, defaultProfile.rapidRate), 0, Number.POSITIVE_INFINITY),
			toolChangeSeconds: clampNumber(coalesce(configured.toolChangeSeconds, defaultProfile.toolChangeSeconds), 0, Number.POSITIVE_INFINITY),
			extraStationSeconds: clampNumber(coalesce(configured.extraStationSeconds, defaultProfile.extraStationSeconds), 0, Number.POSITIVE_INFINITY),
			customEventTimes: normalizeCustomEventTimes(configured.customTimes)
		});
	}

	return profiles;
}

function getTimingProfile(profiles, requestedName) {
	const requested = String(requestedName || "").trim().toLowerCase();
	return profiles.find(profile => profile.name.toLowerCase() === requested) || profiles[0];
}

function normalizeCustomEventTimes(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const customEventTimes = {};

	for (const [rawCode, rawSeconds] of Object.entries(value)) {
		const match = /^M0*(\d+)$/i.exec(String(rawCode).trim());
		const seconds = Number(rawSeconds);
		if (!match || !Number.isFinite(seconds) || seconds < 0) continue;
		customEventTimes[`M${Number(match[1])}`] = seconds;
	}

	return customEventTimes;
}

function coalesce(value, fallback) {
	return value === undefined || value === null || value === "" ? fallback : value;
}

function clampNumber(value, min, max) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return min;
	}

	return Math.max(min, Math.min(max, number));
}

module.exports = {
	getChronobladeOptions
};
