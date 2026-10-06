const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument, configurationValues } = require("./helpers");
const motion = require("../src/MetaMotionEngine");
const machine = require("../src/MetaMachineMode");
const { getSenseOptions } = require("../src/kaijuSense/options");
const { getVisionOptions } = require("../src/kaijuVision/options");
const { getChronobladeOptions } = require("../src/kaijuChronoblade/options");
const BASE = { machineMode: "latheRadius", xAxisMode: "radius", gCodeDialectId: "fanucIso", defaultFeedMode: "perMinute", rapidRate: 1000,
	samples: 96, cssSurfaceSpeedUnit: "mPerMin", initialPosition: { x: 0, y: 0, z: 0 } };
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
test("work frames and G53 use physical travel for both reports without moving on frame selection", () => {
	const source = "G54 G0 X10 Y5 Z20\nG55\nG0 X0\nG53 G0 X0\nG0 X10";
	const options = { ...BASE, workOffsets: { G54: { x: 100, y: 0, z: 0 }, G55: { x: 200, y: 50, z: 30 } } };
	const document = makeDocument(source);
	const vision = motion.analyzeVisionRange(document, undefined, options).rows.filter(row => row.type === "motion");
	const chrono = motion.analyzeChronobladeRange(document, undefined, options).rows.filter(row => row.type === "motion");
	assert.equal(chrono.length, 3);
	for (const [index, seconds] of [5.4, 12, 12.6].entries()) {
		close(chrono[index].timeSeconds, seconds); close(vision[index + 1].timeSeconds, seconds);
	}
	assert.equal(vision[2].points.at(-1).y, 5);
	assert.equal(vision[2].points.at(-1).z, 20);
	close(vision[2].points[0].x, 200); close(vision[2].points.at(-1).x, 0);
	close(motion.estimateMotionAtLine(document, 3, {code: 0}, options).timeSeconds, 12);
});

test("C work offsets preserve physical angle at frame changes and affect rotary timing", () => {
	const source = "G54 G0 X20 C0\nG55\nG1 C0 F100";
	const options = { ...BASE, workOffsets: { G54: {c: 90}, G55: {c: 180} } };
	const document = makeDocument(source);
	const vision = motion.analyzeVisionRange(document, undefined, options).rows.filter(row => row.type === "motion").at(-1);
	const chrono = motion.analyzeChronobladeRange(document, undefined, options).rows.filter(row => row.type === "motion").at(-1);
	close(vision.timeSeconds, 54); close(chrono.timeSeconds, 54);
	close(vision.points[0].x, 0); close(vision.points[0].y, 20);
	close(vision.points.at(-1).x, -20); close(vision.points.at(-1).y, 0);
});
function rows(source, options = {}) {
	return motion.analyzeVisionRange(makeDocument(source), undefined, { ...BASE, ...options }).rows.filter(row => row.type === "motion");
}
function estimate(source, options = {}) {
	const document = makeDocument(source);
	return motion.estimateMotionAtLine(document, document.lineCount - 1, { code: 1 }, { ...BASE, ...options });
}

test("rapid axis rates use the longest axis time, physical diameter X, and ignore stationary zero-rate axes", () => {
	const options = { rapidRates: { x: 600, y: 6000, z: 60, c: 360 } };
	close(rows("G0 X100 Y50 Z10", options)[0].timeSeconds, 10);
	close(rows("G0 X100", { ...options, xAxisMode: "diameter" })[0].timeSeconds, 5);
	close(rows("G0 X100", { rapidRates: { x: 600, y: 0 } })[0].timeSeconds, 10);
	assert.ok(Number.isNaN(rows("G0 Y50", { rapidRates: { y: 0 } })[0].timeSeconds));
	// The existing scalar model remains active when no linear axis rates are set.
	close(rows("G0 X100 Y100")[0].timeSeconds, Math.hypot(100, 100) / 1000 * 60);
});

test("C rapid timing uses angular travel and synchronizes with linear axes", () => {
	const options = { rapidRates: { x: 600, c: 360 } };
	const rotary = rows("G0 X20 C0\nG0 H180 X120", options).at(-1);
	close(rotary.timeSeconds, 30);
	close(rows("G0 X20 C0\nG0 H180", options).at(-1).timeSeconds, 30);
	assert.ok(Number.isNaN(rows("G0 X20 C0\nG0 H180").at(-1).timeSeconds));
});

test("C travel rules choose direct, shortest, positive, and negative paths while incremental turns remain full", () => {
	const source = "G0 X20 C350\nG1 C10 F100";
	close(rows(source)[1].timeSeconds, 204);
	for (const cAxisTravel of ["shortest", "positive"]) close(rows(source, { cAxisTravel })[1].timeSeconds, 12);
	close(rows(source, { cAxisTravel: "negative" })[1].timeSeconds, 204);
	const reverse = rows("G0 X20 C10\nG1 C350 F100", { cAxisTravel: "negative", cAxisCoordinates: "continuous" })[1];
	close(reverse.end.c, -10); close(reverse.timeSeconds, 12);
	for (const command of ["H720", "G91 C720"]) close(rows("G0 X20 C0\nG1 " + command + " F100", { cAxisTravel: "shortest" })[1].timeSeconds, 432);
	const polar = rows("G0 X20 C350\nG12.1\nG1 C10 F100", { cAxisTravel: "shortest" }).at(-1);
	close(polar.points.at(-1).y, 10);
});

test("rotary feed rules produce distinct controller lengths and sample-independent physical timing", () => {
	const source = "G0 X20 C0\nG1 H90 F100";
	close(rows(source)[1].timeSeconds, 54);
	close(rows(source, { rotaryFeedRule: "scaledDegrees", rotaryFeedScale: 2 })[1].timeSeconds, 108);
	const physical = rows(source, { rotaryFeedRule: "physical" })[1];
	close(physical.timeSeconds, 10 * Math.PI / 100 * 60);
	assert.ok(Number.isNaN(rows(source, { rotaryFeedRule: "linearOnly" })[1].timeSeconds));
	close(rows("G0 X20 C0\nG1 H90 W10 F100", { rotaryFeedRule: "linearOnly" })[1].timeSeconds, 6);
	const helix = "G0 X20 C0\nG1 H90 W10 F100";
	close(rows(helix, { rotaryFeedRule: "physical" })[1].timeSeconds, Math.hypot(10 * Math.PI, 10) / 100 * 60);
	const changingRadius = "G0 X20 C0\nG1 X40 H720 W10 F100";
	close(rows(changingRadius, { rotaryFeedRule: "physical", samples: 12 })[1].timeSeconds,
		rows(changingRadius, { rotaryFeedRule: "physical", samples: 500 })[1].timeSeconds, 1e-12);
	close(rows(source.replace("F100", "G97 S1000 G99 F0.1"), { rotaryFeedRule: "physical" })[1].timeSeconds, physical.timeSeconds);
});

test("turret timings wrap by station count and respect indexing direction", () => {
	function toolTime(source, turretIndexing) {
		return motion.analyzeChronobladeRange(makeDocument(source), undefined, { ...BASE, toolChangeSeconds: 4, extraStationSeconds: 0.5,
			turretStationCount: 12, turretIndexing }).rows.filter(row => row.type === "tool").at(-1).timeSeconds;
	}
	close(toolTime("T1200\nT0100", "shortest"), 4);
	close(toolTime("T1200\nT0100", "increasing"), 4);
	close(toolTime("T1200\nT0100", "decreasing"), 9);
	close(toolTime("T0100\nT0400", "shortest"), 5);
	close(toolTime("T0101\nT0102", "shortest"), 4);
});

test("physical spindle limit caps fixed and CSS RPM without inventing a program limit", () => {
	const fixed = estimate("G0 X10\nG97 S6000 G99 G1 X20 F1", { maxSpindleRpm: 3000 });
	close(fixed.minRpm, 3000); close(fixed.timeSeconds, 0.2);
	const css = estimate("G0 X10\nG96 S10000 G99 G1 X20 F1", { maxSpindleRpm: 3000 });
	close(css.minRpm, 3000); close(css.timeSeconds, 0.2);
	assert.equal(css.rpmLimit, undefined);
	assert.ok(!css.warnings.some(warning => warning.includes("unclamped")));
	const lowerProgramLimit = estimate("G0 X10\nG50 S1000\nG96 S10000 G99 G1 X20 F1", { maxSpindleRpm: 3000 });
	close(lowerProgramLimit.minRpm, 1000); close(lowerProgramLimit.timeSeconds, 0.6);
	const higherProgramLimit = estimate("G0 X10\nG50 S6000\nG96 S10000 G99 G1 X20 F1", { maxSpindleRpm: 3000 });
	close(higherProgramLimit.minRpm, 3000);
	const physical = estimate("G0 X20 C0\nG96 S10000 G99 G1 H90 F1", { maxSpindleRpm: 3000, rotaryFeedRule: "physical" });
	close(physical.timeSeconds, 10 * Math.PI / 3000 * 60);
});

test("startup modes initialize shared state and explicit commands override them", () => {
	const initialPosition = { x: 10, y: 0, z: 0 };
	close(rows("G1 X5 F60", { startupDistanceMode: "incremental", initialPosition })[0].end.x, 15);
	close(rows("G90 G1 X5 F60", { startupDistanceMode: "incremental", initialPosition })[0].end.x, 5);
	const arc = motion.analyzeArcsInDocument(makeDocument("G2 X0 Z10 I-10 K0"), { ...BASE, initialPosition, startupPlane: "xz" });
	assert.equal(arc.get(0).validation.valid, true);
	const override = motion.analyzeArcsInDocument(makeDocument("G17 G3 X0 Y10 I-10 J0"), { ...BASE, initialPosition, startupPlane: "xz" });
	assert.equal(override.get(0).validation.valid, true);
	assert.equal(estimate("G1 X10 F1 S100", { startupSpindleMode: "css" }).spindleMode, "css");
	assert.equal(estimate("G97 G1 X10 F1 S100", { startupSpindleMode: "css" }).spindleMode, "fixed");
	assert.equal(estimate("G98 G1 X10 F60", { defaultFeedMode: "perRev" }).feedMode, "perMinute");
});

test("machine behavior settings persist and reach every analysis consumer", async () => {
	configurationValues.clear();
	const stored = new Map();
	machine.initializeMachineMode({ workspaceState: { get: (key, fallback) => stored.get(key) || fallback, update: async (key, value) => stored.set(key, value) } });
	const document = makeDocument("G1 X10");
	await machine.saveMachineProfiles(document, [{ ...machine.GENERIC_MACHINE_PROFILE, id: "configured", label: "Configured", machineMode: "mill",
		rapidRates: { x: 1234, y: null, z: 789, c: 360 }, turretStationCount: 12, turretIndexing: "decreasing", cAxisTravel: "shortest",
		rotaryFeedRule: "scaledDegrees", rotaryFeedScale: 2, maxSpindleRpm: 3000, cssSurfaceSpeedUnit: "sfm",
		startupFeedMode: "perRev", startupPlane: "xz", startupDistanceMode: "incremental", startupSpindleMode: "css" }]);
	await machine.setMachineProfile(document, "configured");
	for (const options of [getSenseOptions(document), getVisionOptions(document), getChronobladeOptions(document)]) {
		assert.equal(options.rapidRates.x, 1234); assert.equal(options.rapidRates.y, null);
		assert.equal(options.turretStationCount, 12); assert.equal(options.cAxisTravel, "shortest");
		assert.equal(options.maxSpindleRpm, 3000); assert.equal(options.cssSurfaceSpeedUnit, "sfm");
		assert.equal(options.defaultFeedMode, "perRev"); assert.equal(options.startupPlane, "xz");
	}
	for (const change of [{ turretStationCount: 2.5 }, { rapidRates: { c: -1 } }, { startupPlane: "bad" }, { rotaryFeedRule: "scaledDegrees", rotaryFeedScale: 0 }]) {
		assert.throws(() => machine.normalizeMachineProfiles([{ ...machine.GENERIC_MACHINE_PROFILE, id: "invalid", label: "Invalid", ...change }]));
	}
});
