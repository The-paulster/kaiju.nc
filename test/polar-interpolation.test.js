const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const dialect = require("../src/MetaGCodeDialect");
const motion = require("../src/MetaMotionEngine");

const OPTIONS = {
	machineMode: "lathe",
	gCodeDialectId: "fanucIso",
	defaultFeedMode: "perMinute",
	xAxisMode: "diameter",
	cssSurfaceSpeedUnit: "mPerMin",
	samples: 96,
	rapidRate: 10000
};

function motionRows(result) {
	return result.rows.filter(row => row.type === "motion");
}

function closeTo(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);
}

test("built-in lathe profiles bind G12.1/G13.1 polar interpolation", () => {
	const operations = dialect.G_CODE_OPERATIONS;
	for (const profileId of ["fanucIso", "dmgMori"]) {
		const profile = dialect.getGCodeDialectProfile(profileId);
		assert.equal(profile.bindings.lathe[operations.POLAR_INTERPOLATION_ENABLE].code, 12.1);
		assert.equal(profile.bindings.lathe[operations.POLAR_INTERPOLATION_DISABLE].code, 13.1);
		assert.equal(profile.bindings.mill[operations.POLAR_INTERPOLATION_ENABLE], null);
	}
});

test("polar interpolation is modal and G13.1 cancels it", () => {
	const document = makeDocument("G12.1\nG1 C20 F100\nG13.1");
	assert.equal(motion.getModalStateAtLine(document, 0, OPTIONS).polarInterpolation, true);
	assert.equal(motion.getModalStateAtLine(document, 1, OPTIONS).polarInterpolation, true);
	assert.equal(motion.getModalStateAtLine(document, 2, OPTIONS).polarInterpolation, false);
});

test("polar X/C linear interpolation produces Cartesian face geometry", () => {
	const document = makeDocument("G0 X100\nG12.1\nG1 X80 C30 F100");
	const row = motionRows(motion.analyzeVisionRange(document, undefined, OPTIONS)).at(-1);
	assert.ok(row);
	closeTo(row.points[0].x, 50);
	closeTo(row.points[0].y, 0);
	closeTo(row.points.at(-1).x, 40);
	closeTo(row.points.at(-1).y, 30);
	closeTo(row.distance, Math.hypot(10, 30));
});

test("C outside polar mode is not treated as Cartesian motion", () => {
	const document = makeDocument("G0 X100\nG1 C20 F100\nG1 X80 F100");
	const rows = motionRows(motion.analyzeVisionRange(document, undefined, OPTIONS));
	assert.equal(rows.length, 1);
	closeTo(rows[0].points.at(-1).x, 40);
	assert.equal(rows[0].points.at(-1).y, undefined);
});

test("H is incremental motion on the polar C axis", () => {
	const document = makeDocument("G0 X100\nG12.1\nG1 C10 F100\nG1 H5");
	const rows = motionRows(motion.analyzeVisionRange(document, undefined, OPTIONS));
	assert.equal(rows.length, 2);
	closeTo(rows[0].points.at(-1).y, 10);
	closeTo(rows[1].points.at(-1).y, 15);
});

test("polar I/J arcs are sampled as curved geometry", () => {
	const document = makeDocument("G0 X100\nG12.1\nG3 X80 C10 I-10 J0 F100");
	const row = motionRows(motion.analyzeVisionRange(document, undefined, OPTIONS)).at(-1);
	assert.ok(row);
	assert.ok(row.points.length > 2);
	closeTo(row.points[0].x, 50);
	closeTo(row.points.at(-1).x, 40);
	closeTo(row.points.at(-1).y, 10);
	closeTo(row.distance, Math.PI * 10 / 2, 0.02);
	assert.equal(motion.analyzeArcsInDocument(document, OPTIONS).get(2).validation.valid, true);
});

test("polar R arcs are sampled rather than reduced to a chord", () => {
	const document = makeDocument("G0 X100\nG12.1\nG3 X80 C10 R10 F100");
	const row = motionRows(motion.analyzeVisionRange(document, undefined, OPTIONS)).at(-1);
	assert.ok(row);
	assert.ok(row.points.length > 2);
	assert.ok(row.distance > Math.hypot(10, 10));
});

test("Chronoblade uses Cartesian polar distance", () => {
	const document = makeDocument("G0 X100\nG12.1\nG1 C20 F100");
	const row = motionRows(motion.analyzeChronobladeRange(document, undefined, OPTIONS)).at(-1);
	assert.ok(row);
	closeTo(row.distance, 20);
	closeTo(row.timeSeconds, 12);
});

test("polar control blocks do not create motion rows", () => {
	const document = makeDocument("G0 X100\nG12.1\nG1 C20 F100\nG13.1");
	const rows = motionRows(motion.analyzeVisionRange(document, undefined, OPTIONS));
	assert.equal(rows.length, 1);
	assert.equal(rows[0].lineNumber, 3);
});
