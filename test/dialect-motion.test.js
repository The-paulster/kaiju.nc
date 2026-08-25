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
