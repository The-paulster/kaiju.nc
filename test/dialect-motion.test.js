const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const dialect = require("../src/MetaGCodeDialect");
const motion = require("../src/MetaMotionEngine");
const modalDefinitions = require("../src/MetaModalDefs.json");

test("keybinding collisions unbind the previous operation", () => {
	const operations = dialect.G_CODE_OPERATIONS;
	const g98 = dialect.createGCodeBinding(98);
	const table = dialect.createGCodeBindingTable(
		{ [operations.CYCLE_RETURN_INITIAL]: g98 },
		{ [operations.FEED_PER_MINUTE]: g98 }
	);
	assert.equal(table[operations.CYCLE_RETURN_INITIAL], null);
	assert.equal(table[operations.FEED_PER_MINUTE].code, 98);
});

test("companion-word bindings cannot coexist with another meaning for the same G word", () => {
	const operations = dialect.G_CODE_OPERATIONS;
	const table = dialect.createGCodeBindingTable(
		{ [operations.COORDINATE_SETTING]: dialect.createGCodeBinding(50) },
		{ [operations.SPINDLE_RPM_LIMIT]: dialect.createGCodeBinding(50, { requiredWords: ["S"], argumentWord: "S" }) }
	);
	assert.equal(table[operations.COORDINATE_SETTING], null);
	assert.deepEqual(table[operations.SPINDLE_RPM_LIMIT].requiredWords, ["S"]);
});

test("custom profiles normalize into independent mill and lathe binding tables", () => {
	const operations = dialect.G_CODE_OPERATIONS;
	try {
		dialect.setCustomGCodeDialectProfiles([{
			id: "shop-turning",
			label: "Shop Turning",
			bindings: {
				lathe: {
					[operations.FEED_PER_MINUTE]: { code: 98 },
					[operations.FEED_PER_REVOLUTION]: { code: 99 }
				},
				mill: {
					[operations.FEED_PER_MINUTE]: { code: 94 },
					[operations.FEED_PER_REVOLUTION]: { code: 95 }
				}
			}
		}]);
		assert.equal(dialect.getGCodeDialectProfile("shop-turning").bindings.lathe[operations.FEED_PER_MINUTE].code, 98);
		assert.equal(dialect.getGCodeDialectProfile("shop-turning").bindings.mill[operations.FEED_PER_MINUTE].code, 94);
	} finally {
		dialect.setCustomGCodeDialectProfiles([]);
	}
});

test("motion analysis consumes a custom profile binding", () => {
	const operations = dialect.G_CODE_OPERATIONS;
	try {
		dialect.setCustomGCodeDialectProfiles([{
			id: "custom-feed-word",
			label: "Custom Feed Word",
			bindings: { lathe: { [operations.FEED_PER_MINUTE]: { code: 77 } }, mill: {} }
		}]);
		const result = motion.analyzeChronobladeRange(makeDocument("G77\nG97 S1000\nG0 Z0\nG1 Z100 F100"), undefined, {
			machineMode: "lathe", gCodeDialectId: "custom-feed-word", defaultFeedMode: "perRev", xAxisMode: "radius"
		});
		const row = result.rows.find(candidate => candidate.type === "motion");
		assert.equal(row.feedMode, "perMinute");
		assert.equal(row.feedModeWord, "G77");
		assert.equal(row.timeSeconds, 60);
	} finally {
		dialect.setCustomGCodeDialectProfiles([]);
	}
});

test("DMG turning timing and presentation both use G98 feed per minute", () => {
	const document = makeDocument("G98\nG97 S1000\nG0 Z0\nG1 Z100 F100");
	const result = motion.analyzeChronobladeRange(document, undefined, {
		machineMode: "lathe",
		gCodeDialectId: "dmgMori",
		defaultFeedMode: "perRev",
		xAxisMode: "radius"
	});
	const row = result.rows.find(candidate => candidate.type === "motion");
	assert.equal(row.feedMode, "perMinute");
	assert.equal(row.feedModeWord, "G98");
	assert.equal(row.timeSeconds, 60);
});

test("dialect-owned status groups do not duplicate word meanings", () => {
	for (const key of ["distanceMode", "cannedCycleReturn", "plane", "spindleSpeedMode", "speedLimit"]) {
		assert.deepEqual(modalDefinitions.find(group => group.key === key).codes, {});
	}
	assert.deepEqual(Object.keys(modalDefinitions.find(group => group.key === "feedMode").codes), ["93"]);
});

test("status presentation resolves profile-owned collisions through the dialect", () => {
	const dmgState = motion.getModalStateAtLine(makeDocument("G98"), 0, {
		machineMode: "lathe", gCodeDialectId: "dmgMori", defaultFeedMode: "perRev"
	});
	const isoState = motion.getModalStateAtLine(makeDocument("G98"), 0, {
		machineMode: "mill", gCodeDialectId: "fanucIso", defaultFeedMode: "perMinute"
	});
	assert.equal(dmgState.modalGroups.find(entry => entry.key === "feedMode").code, "G98");
	assert.equal(isoState.modalGroups.find(entry => entry.key === "cannedCycleReturn").code, "G98");
});

test("Vision applies coordinate-frame offsets relative to the selected reference", () => {
	const document = makeDocument("G54 G0 X0\nG0 X10\nG55 G0 X0\nG0 X10");
	const result = motion.analyzeVisionRange(document, undefined, {
		workOffsets: {
			G54: { x: -100, y: 0, z: 0 },
			G55: { x: 100, y: 0, z: 0 }
		},
		referenceFrame: "G54"
	});
	const rows = result.rows.filter(row => row.type === "motion");

	assert.equal(rows[0].coordinateSystem, "G54");
	assert.equal(rows[0].end.x, 10);
	assert.equal(rows[2].coordinateSystem, "G55");
	assert.equal(rows[2].end.x, 10);
	assert.equal(rows[2].points.at(-1).x, 210);
});

test("Vision applies the G53 frame offset", () => {
	const document = makeDocument("G54 G0 X0\nG0 X10\nG53 G0 X500");
	const result = motion.analyzeVisionRange(document, undefined, {
		workOffsets: {
			G53: { x: -200, y: 0, z: 0 },
			G54: { x: 100, y: 0, z: 0 }
		},
		referenceFrame: "G54"
	});
	const g53Row = result.rows.find(row => row.type === "motion" && row.coordinateSystem === "G53");

	assert.equal(g53Row.end.x, 500);
	assert.equal(g53Row.points.at(-1).x, 200);
});

test("Vision draws its assumed start in the selected coordinate frame", () => {
	const document = makeDocument("G54 G0 X10");
	const result = motion.analyzeVisionRange(document, undefined, {
		initialPosition: { coordinateSystem: "G53", x: 0, y: 0, z: 0 },
		workOffsets: {
			G53: { x: 0, y: 0, z: 0 },
			G54: { x: 100, y: 0, z: 0 }
		},
		referenceFrame: "G53"
	});
	const row = result.rows.find(candidate => candidate.type === "motion");
	assert.equal(row.start.x, -100);
	assert.equal(row.end.x, 10);
	assert.equal(row.points[0].x, 0);
	assert.equal(row.points.at(-1).x, 110);
});

test("Vision preserves physical axes when the next move resumes the active work frame after G53", () => {
	const document = makeDocument("G53 G0 Z-250\nG0 X100");
	const result = motion.analyzeVisionRange(document, undefined, {
		workOffsets: {
			G53: { x: 0, y: 0, z: 0 },
			G54: { x: 50, y: 0, z: 100 }
		},
		referenceFrame: "G53"
	});
	const row = result.rows.find(candidate => candidate.type === "motion" && candidate.coordinateSystem === "G54");
	assert.equal(row.start.z, -350);
	assert.equal(row.end.z, -350);
	assert.equal(row.points[0].z, -250);
	assert.equal(row.points.at(-1).z, -250);
	assert.equal(row.points.at(-1).x, 150);
});

test("Vision preserves the prior work frame at the start of a G53 move", () => {
	const document = makeDocument("G54 G0 X0\nG0 X10\nG53 G0 X0");
	const result = motion.analyzeVisionRange(document, undefined, {
		workOffsets: {
			G53: { x: 0, y: 0, z: 0 },
			G54: { x: 100, y: 0, z: 0 }
		},
		referenceFrame: "G53"
	});
	const g53Row = result.rows.find(row => row.type === "motion" && row.coordinateSystem === "G53");

	assert.equal(g53Row.start.x, 10);
	assert.equal(g53Row.end.x, 0);
	assert.equal(g53Row.points[0].x, 110);
	assert.equal(g53Row.points.at(-1).x, 0);
});

test("only the profile G50 S binding supplies a CSS RPM limit", () => {
	const document = makeDocument("G50 S800\nG96 S550\nG0 X100 Z0\nG1 Z-10 F0.1 D1");
	const result = motion.analyzeChronobladeRange(document, undefined, {
		machineMode: "lathe", gCodeDialectId: "dmgMori", defaultFeedMode: "perRev",
		xAxisMode: "diameter", cssUnit: "metersPerMinute"
	});
	const row = result.rows.find(candidate => candidate.type === "motion");
	assert.match(row.spindle, /^G96 S550 \[G50 S800\]$/);
	assert.doesNotMatch(row.spindle, /S1(?:\D|$)/);
});
