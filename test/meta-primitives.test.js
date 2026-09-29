const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { maskProtectedRanges } = require("../src/MetaTextRanges");
const { findMacroAssignments } = require("../src/MetaMacroEngine");
const { getToolRanges } = require("../src/MetaToolModel");
const { analyzeChronobladeRange, analyzeVisionRange } = require("../src/MetaMotionEngine");

test("protected text is masked once without changing source offsets", () => {
	const source = "G1 X1 (G0 X9) <G95> Z2";
	const masked = maskProtectedRanges(source);
	assert.equal(masked.length, source.length);
	assert.match(masked, /^G1 X1\s+Z2$/);
	assert.doesNotMatch(masked, /G0|G95/);
});

test("macro assignments use the shared tokenizer", () => {
	assert.deepEqual(findMacroAssignments("#100=1+2; #TOOL=ROUND[1.6]"), [
		{ macro: "#100", value: "1+2" },
		{ macro: "#TOOL", value: "ROUND[1.6]" }
	]);
});

test("tool ranges use the full shared macro evaluator", () => {
	const document = makeDocument("#100=ROUND[1.6]\nT#100\nG1 X1");
	assert.deepEqual(getToolRanges(document), [
		{ tool: "T2", colorIndex: 0, startLine: 1, endLine: 2 }
	]);
});

test("Chronoblade does not read SQRT and TAN assignments as tool words", () => {
	const document = makeDocument(`T0303
#111 = 2.0000 * 3.14159265 * 7.000
#112 = #111 * TAN[3.000]
#113 = SQRT[#111 * #111 + #112 * #112]
#114 = SQRT[360.000 * 360.000 + #112 * #112]
#115 = 300.000 * #114 / #113
G01 X14.000 F[#115]`);
	const result = analyzeChronobladeRange(document, undefined, {
		machineMode: "latheDiameter",
		defaultFeedMode: "perMinute",
		toolChangeSeconds: 4,
		extraStationSeconds: 0.5
	});

	assert.deepEqual(result.rows.filter(row => row.type === "tool").map(row => row.instruction), ["T0303"]);
	assert.equal(result.summary.toolTimeSeconds, 4);
});

test("Vision classifies G46 as a compensation marker on standalone and motion blocks", () => {
	const standaloneRows = analyzeVisionRange(makeDocument("G0 X0\nG46\nG1 X1"), undefined, { initialPosition: { x: 0, y: 0, z: 0 } }).rows;
	const motionRows = analyzeVisionRange(makeDocument("G0 X0\nG46 G1 X1"), undefined, { initialPosition: { x: 0, y: 0, z: 0 } }).rows;

	assert.deepEqual(
		standaloneRows.map(row => ({ type: row.type, markerKind: row.markerKind, markerClass: row.markerClass })),
		[
			{ type: "motion", markerKind: "endpoint", markerClass: "endpoint" },
			{ type: "event", markerKind: "compensation", markerClass: "endpoint endpoint-compensation" },
			{ type: "motion", markerKind: "endpoint", markerClass: "endpoint" }
		]
	);
	assert.deepEqual(
		motionRows.map(row => ({ type: row.type, markerKind: row.markerKind, markerClass: row.markerClass })),
		[
			{ type: "motion", markerKind: "endpoint", markerClass: "endpoint" },
			{ type: "motion", markerKind: "compensation", markerClass: "endpoint endpoint-compensation" }
		]
	);
});
