const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { buildExecutionTrace, buildConditionalStructures } = require("../src/MetaExecutionTrace");
const { decomposeDocument } = require("../src/kaijuDecomposition");
const { analyzeChronobladeRange } = require("../src/MetaMotionEngine");

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

test("Trace executes only selected nested IF THEN / ELSE / ENDIF branches", () => {
	const document = makeDocument(`#100=1
IF [#100 EQ 1] THEN
G0 X10
IF [#100 EQ 2] THEN
G0 X20
ELSE
G0 X30
ENDIF
ELSE
G0 X40
ENDIF
IF [#100 EQ 0] THEN G0 X50 ELSE G0 X60
M30`);
	const trace = buildExecutionTrace(document, { includeExecutionEntries: true, includeDecompositionData: true });
	const executed = trace.executionEntries.map(entry => entry.effectiveCodeLine).filter(Boolean);

	assert.deepEqual(executed, ["#100=1", "G0 X10", "G0 X30", "G0 X60", "M30"]);
	assert.equal(trace.executionEntries.some(entry => entry.effectiveCodeLine === "G0 X20"), false);
	assert.equal(trace.executionEntries.some(entry => entry.effectiveCodeLine === "G0 X40"), false);
	assert.equal(trace.stopReason, "complete");
});

test("Trace exposes only the selected inline conditional action to motion analysis", () => {
	const document = makeDocument(`G0 X0
IF [#100 EQ 0] THEN G1 X10 F100 ELSE G1 X20 F100
M30`);
	const trace = buildExecutionTrace(document, { includeExecutionEntries: true });
	const result = analyzeChronobladeRange(document, undefined, {
		executionTrace: trace,
		machineMode: "mill",
		gCodeDialectId: "fanucIso",
		defaultFeedMode: "perMinute",
		xAxisMode: "radius"
	});
	const cuttingRow = result.rows.find(row => row.type === "motion");

	assert.equal(trace.executionEntries.find(entry => entry.lineNumber === 1).effectiveCodeLine, "G1 X10 F100");
	assert.equal(cuttingRow.end, "X10.000");
});

test("Decomposition prints the selected inline conditional action", async () => {
	const result = await decomposeDocument(makeDocument(`IF [#100 EQ 0] THEN G0 X10 ELSE G0 X20
M30`), { promptForUnknownMacros: false });

	assert.match(result.text, /G00 X10/);
	assert.doesNotMatch(result.text, /G00 X20/);
});

test("Structured conditional matching reports invalid block markers", () => {
	const structures = buildConditionalStructures(makeDocument(`ELSE
IF [#100 EQ 1] THEN
ELSE
ELSE
ENDIF
ENDIF
IF [#100 EQ 1] THEN`));

	assert.deepEqual(structures.problems.map(problem => problem.message), [
		"ELSE has no matching IF THEN before it.",
		"IF THEN block already has an ELSE.",
		"ENDIF has no matching IF THEN before it.",
		"IF THEN has no matching ENDIF."
	]);
});
