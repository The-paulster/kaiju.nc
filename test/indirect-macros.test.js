const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const {
	evaluateNumericExpression, findMacroAssignments, setMacroValue,
	readNumericValueToken, getExpressionMacroReferences
} = require("../src/MetaMacroEngine");
const { buildExecutionTrace, getMacroHistory } = require("../src/MetaExecutionTrace");
const { analyzeVisionRange, analyzeChronobladeRange, estimateMotionAtLine } = require("../src/MetaMotionEngine");
const { getToolRanges } = require("../src/MetaToolModel");
const { decomposeDocument } = require("../src/kaijuDecomposition");

test("indirect reads resolve expressions, aliases, signed values and nested addresses", () => {
	const values = new Map([["#100", 101], ["#101", 102], ["#102", -25]]);
	const aliases = new Map([["#POINTER", "#100"]]);
	assert.equal(evaluateNumericExpression("#[#100]", values), 102);
	assert.equal(evaluateNumericExpression("#[#[#100]]", values), -25);
	assert.equal(evaluateNumericExpression("[ABS[#[#POINTER+1]]+2]", values, aliases), 27);
	assert.equal(evaluateNumericExpression("-#[102]", values), 25);
	assert.deepEqual(getExpressionMacroReferences("X#[#[#100]]", values), ["#100", "#101", "#102"]);
	assert.equal(readNumericValueToken("-#[#100+1]Y2").text, "-#[#100+1]");
	for (const expression of ["#[#999]", "#[#100", "#[-1]", "#[1.5]", "#[1/0]"]) {
		assert.ok(Number.isNaN(evaluateNumericExpression(expression, values)), expression);
	}
});

test("indirect assignments tokenize and update the selected variable without overwriting the pointer", () => {
	const values = new Map([["#100", 101]]);
	assert.deepEqual(findMacroAssignments("#[#100]=25; #102=#[#100]+1"), [
		{ macro: "#[#100]", value: "25" }, { macro: "#102", value: "#[#100]+1" }
	]);
	setMacroValue(values, "#[#100]", 25, new Map());
	assert.equal(values.get("#101"), 25);
	assert.equal(values.get("#100"), 101);
	setMacroValue(values, "#[1.5]", 7, new Map());
	assert.equal(values.size, 2);
	assert.deepEqual(findMacroAssignments("#[#100=7"), []);
});

test("Vision, Chronoblade, motion hovers and tool ranges consume indirect words", () => {
	const document = makeDocument("#100=101\n#[#100]=25\nG0 X0 Y0 Z0\nG94 G1 X#[#100] Y[#[#100]+5] F#[#100]\nT#[#100]");
	const options = { machineMode: "mill", initialPosition: { x: 0, y: 0, z: 0 } };
	const trace = buildExecutionTrace(document, { includeExecutionEntries: true });
	for (const executionTrace of [undefined, trace]) {
		const runtime = { ...options, executionTrace };
		const vision = analyzeVisionRange(document, undefined, runtime);
		const row = vision.rows.filter(row => row.type === "motion").at(-1);
		assert.deepEqual(row.end, { x: 25, y: 30, z: 0 });
		assert.ok(!row.warnings.some(warning => /resolve/.test(warning)));
		const chrono = analyzeChronobladeRange(document, undefined, runtime);
		const motion = chrono.rows.find(row => row.type === "motion");
		assert.equal(motion.feed, 25);
		assert.ok(Number.isFinite(motion.timeSeconds));
		assert.equal(chrono.rows.find(row => row.type === "tool").instruction, "T25");
	}
	const hover = estimateMotionAtLine(document, 3, { code: 1 }, options);
	assert.deepEqual(hover.end, { x: 25, y: 30, z: 0 });
	assert.deepEqual(getToolRanges(document).map(range => range.tool), ["T25"]);
});

test("Trace and Decomposition follow changing indirect values through a loop", async () => {
	const document = makeDocument("#100=101\n#[#100]=0\nWHILE [#[#100] LT 2] DO1\n#[#100]=#[#100]+1\nG94 G1 X#[#100] F100\nEND1\nM30");
	const trace = buildExecutionTrace(document, { includeDecompositionData: true, includePlaybackData: true });
	assert.equal(trace.status, "ready");
	const moves = trace.executionEntries.filter(entry => entry.lineNumber === 4);
	assert.deepEqual(moves.map(entry => entry.macroValues["#101"]), [1, 2]);
	assert.deepEqual(moves.map(entry => entry.traceLine), ["G94 G1 X1 F100", "G94 G1 X2 F100"]);
	assert.deepEqual(getMacroHistory(trace, 4, "#101").values, [1, 2]);
	assert.deepEqual(trace.executionEntries.filter(entry => entry.lineNumber === 3)
		.map(entry => entry.macroChanges.find(change => change.macro === "#101").current), [1, 2]);
	const result = await decomposeDocument(document, { executionTrace: trace, promptForUnknownMacros: false });
	assert.match(result.text, /G01 X1\.000/);
	assert.match(result.text, /G01 X2\.000/);
	assert.doesNotMatch(result.text.split("\n").filter(line => /^G/.test(line)).join("\n"), /#\[/);
});

test("Trace reports assumed indirect inputs and rejects invalid write targets", () => {
	const trace = buildExecutionTrace(makeDocument("#100=101\nIF [#[#100] EQ 0] THEN #102=5\n#[1.5]=7\nM30"), { includeDecompositionData: true });
	assert.ok(trace.assumptions.has("#101"));
	assert.equal(trace.executionEntries[1].macroValues["#102"], 5);
	assert.match(trace.problems[0].message, /Could not resolve assignment target/);
	assert.deepEqual(trace.executionEntries[2].assignments, []);
});

test("indirect writes retain the actual target when assigning the pointer itself", () => {
	const trace = buildExecutionTrace(makeDocument("#100=100\n#[#100]=101\nM30"), { includePlaybackData: true, includeDecompositionData: true });
	const write = trace.executionEntries[1];
	assert.equal(write.assignments[0].resolvedMacro, "#100");
	assert.equal(write.macroValues["#100"], 101);
	assert.ok(write.macroDisplayPrecisionChanges.some(change => change.macro === "#100"));
});
