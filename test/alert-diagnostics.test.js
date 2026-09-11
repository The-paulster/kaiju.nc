const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { updateDiagnostics } = require("../src/kaijuAlert/diagnostics");

function getDiagnostics(document) {
	let warnings = [];
	updateDiagnostics(document, {
		set(uri, value) { warnings = value; },
		delete() {}
	});
	return warnings;
}

test("unresolved GOTO targets are checked with or without a separating space", () => {
	const warnings = getDiagnostics(makeDocument("GOTO 110\nGOTO110\nN100"));

	assert.equal(warnings.length, 2);
	assert.deepEqual(
		warnings.map(warning => ({
			line: warning.range.start.line,
			start: warning.range.start.character,
			end: warning.range.end.character,
			message: warning.message
		})),
		[
			{ line: 0, start: 5, end: 8, message: 'GOTO target "110" has no matching N label.' },
			{ line: 1, start: 4, end: 7, message: 'GOTO target "110" has no matching N label.' }
		]
	);
});

test("spaceless GOTO targets accept matching N labels", () => {
	const warnings = getDiagnostics(makeDocument("GOTO110\nN110"));

	assert.equal(warnings.length, 0);
});
