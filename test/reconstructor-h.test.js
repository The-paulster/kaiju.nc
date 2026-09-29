const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { formatDocumentText, getFormattingOptions } = require("../src/kaijuReconstructor/formatter");

test("Reconstructor formats incremental C H but preserves same-block tool-length H", () => {
	const options = getFormattingOptions(makeDocument(""));
	const source = [
		"G01 H90 W-1",
		"G43 H01 Z4",
		"G44 H[#100+1] Z5",
		"G01 H[#100+1] W-2",
		"G43 H02 (offset H99)",
		"G01 H-45.5",
		"G01 H#100",
		"G43 H#100",
		"T0303 H90",
		"#H100 = 1 (named macro)"
	].join("\n");
	const formatted = formatDocumentText(source, options);

	assert.deepEqual(formatted.split("\n"), [
		"G01 H90.000 W-1.000",
		"G43 H01 Z4.000",
		"G44 H[#100 + 1] Z5.000",
		"G01 H[#100 + 1.000] W-2.000",
		"G43 H02 (offset H99)",
		"G01 H-45.500",
		"G01 H#100",
		"G43 H#100",
		"T0303 H90.000",
		"#H100 = 1.000 (named macro)"
	]);
	assert.equal(formatDocumentText(formatted, options), formatted);
});

test("Reconstructor honors disabled missing decimals for motion H", () => {
	const options = getFormattingOptions(makeDocument(""), { addMissingDecimal: false });
	assert.equal(formatDocumentText("G01 H90\nG01 H.5\nG43 H01", options),
		"G01 H90\nG01 H0.500\nG43 H01");
});
