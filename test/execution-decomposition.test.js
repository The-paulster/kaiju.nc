const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { buildExecutionTrace } = require("../src/MetaExecutionTrace");
const { decomposeDocument } = require("../src/kaijuDecomposition");

const LOOP_PROGRAM = `(#100 counter {0})
#101=2
WHILE [#100 LT #101 AND #101 EQ 2] DO1
#100=#100+1
G1 X#100
END1
IF [#100 LT 0] THEN #3000=1
M30`;

test("Trace is the authoritative loop and conditional execution stream", () => {
	const trace = buildExecutionTrace(makeDocument(LOOP_PROGRAM), { includeDecompositionData: true });
	assert.equal(trace.status, "ready");
	assert.equal(trace.executionEntries.filter(entry => entry.lineNumber === 4).length, 2);
	const falseAlarm = trace.executionEntries.find(entry => entry.lineNumber === 6);
	assert.equal(falseAlarm.control.kind, "ifThen");
	assert.equal(falseAlarm.control.taken, false);
	assert.equal(trace.stopReason, "complete");
});

test("Decomposition formats the shared Trace occurrences", async () => {
	const result = await decomposeDocument(makeDocument(LOOP_PROGRAM), { promptForUnknownMacros: false });
	assert.equal((result.text.match(/G01 X/g) || []).length, 2);
	assert.match(result.text, /#100=2, #101=2; 2 LT 2 AND 2 EQ 2; FALSE; DO1/);
	assert.doesNotMatch(result.text, /#3000 alarm, stopped execution/);
});
