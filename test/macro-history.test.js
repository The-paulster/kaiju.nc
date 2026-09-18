const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const {
	buildMacroHistoryPayload,
	makeMacroStateCheckpoints,
	restoreMacroState,
	renderMacroHistoryHtml
} = require("../src/kaijuSense/macroHistory");

test("Macro History retains every loop occurrence and restores its full state", () => {
	const document = makeDocument(`(#1 counter {0})
#1=0
WHILE [#1 LT 3] DO1
#1=[#1+1]
END1
M30`);
	const payload = buildMacroHistoryPayload(document, 3);
	const occurrences = payload.entries.filter(entry => entry.lineNumber === 3);
	assert.equal(occurrences.length, 3);
	assert.deepEqual(occurrences[0].macroReads, ["#1"]);
	const checkpoints = makeMacroStateCheckpoints(payload.entries, payload.initialMacroValues, 2);
	assert.equal(restoreMacroState(payload.entries, payload.initialMacroValues, checkpoints, payload.entries.indexOf(occurrences[0]), 2).get("#1"), 1);
	assert.equal(restoreMacroState(payload.entries, payload.initialMacroValues, checkpoints, payload.entries.indexOf(occurrences[2]), 2).get("#1"), 3);
});

test("Macro History webview exposes pinning and all-occurrence values", () => {
	const html = renderMacroHistoryHtml();
	assert.match(html, /setPinned/);
	assert.doesNotMatch(html, /<strong>Macro history<\/strong>/);
	assert.match(html, /class="toolbar"[\s\S]*?Occurrence[\s\S]*?id="pin"/);
	assert.match(html, /class="pin"/);
	assert.match(html, /id="occurrence"/);
	assert.match(html, /addEventListener\('wheel'/);
	assert.match(html, /Most recently read or assigned first/);
	assert.match(html, /accessCheckpointCache/);
	assert.doesNotMatch(html, /max-height: 300px/);
	assert.match(html, /id="horizontalScroll"/);
	assert.match(html, /connectHorizontalScroll/);
	assert.match(html, /scrollWidth > stateTable\.clientWidth \+ 1/);
	assert.match(html, /Pinned to L/);
	assert.match(html, /value-increased/);
	assert.match(html, /value-decreased/);
	assert.match(html, /value-increased code.*!important/);
	assert.match(html, /<th title="Most recently read or assigned first">Macro<\/th><th class="value-column">Value<\/th><th>Name<\/th>/);
	assert.doesNotMatch(html, /⚠/);
	assert.match(html, /across all occurrences/);
	new Function([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]);
});
