const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { maskProtectedRanges } = require("../src/MetaTextRanges");
const { findMacroAssignments } = require("../src/MetaMacroEngine");
const { getToolRanges } = require("../src/MetaToolModel");

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
