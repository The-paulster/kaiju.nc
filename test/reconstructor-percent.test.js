const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { formatDocumentText, getFormattingOptions } = require("../src/kaijuReconstructor/formatter");

test("percent insertion fills missing boundaries and remains stable with semicolon formatting", () => {
	for (const newline of ["\n", "\r\n"]) {
		for (const autoSemicolon of [false, true]) {
			const options = getFormattingOptions(makeDocument(""), { addPercentDelimiters: true, autoSemicolon });
			for (const source of ["O1000\nM30", "%\nO1000\nM30", "O1000\nM30\n%", "%\nO1000\nM30\n%", "%;\nO1000\nM30\n%;", "\n%\nO1000\nM30\n%\n\n"]) {
				const input = source.replace(/\n/g, newline);
				const output = formatDocumentText(input, options);
				const lines = output.trim().split(/\r?\n/);
				assert.equal(lines[0], "%");
				assert.equal(lines.at(-1), "%");
				assert.equal(lines.filter(line => line === "%").length, 2);
				assert.ok(!output.includes("%;"));
				assert.equal(output.endsWith(newline), input.endsWith(newline));
				assert.equal(formatDocumentText(output, options), output);
				if (newline === "\r\n") assert.ok(!/(?<!\r)\n/.test(output));
			}
		}
	}
});

test("outer delimiters preserve multiple programs and protected percent text", () => {
	const options = getFormattingOptions(makeDocument(""), { addPercentDelimiters: true });
	const source = "%\nO1000\n(comment % stays)\nM30\n%\nO2000\nM30\n%";
	const output = formatDocumentText(source, options);
	assert.equal(output.split("\n").filter(line => line === "%").length, 3);
	assert.ok(output.includes("(comment % stays)"));
	assert.equal(formatDocumentText(output, options), output);
	assert.equal(formatDocumentText("%", options), "%\n%");
});

test("disabled percent insertion leaves boundaries alone while semicolons respect standalone percent", () => {
	const options = getFormattingOptions(makeDocument(""), { addPercentDelimiters: false, autoSemicolon: true });
	assert.equal(formatDocumentText("%\nO1000\nM30\n%", options), "%\nO1000;\nM30;\n%");
	assert.ok(!formatDocumentText("O1000\nM30", options).includes("%"));
});
