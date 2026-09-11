const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { maskProtectedRanges } = require("../src/MetaTextRanges");
const { findMacroAssignments } = require("../src/MetaMacroEngine");
const { getToolRanges } = require("../src/MetaToolModel");
const { analyzeVisionRange } = require("../src/MetaMotionEngine");

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
