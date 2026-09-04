const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { makeDocument } = require("./helpers");

function loadPrivateRenderer(relativePath, functionName) {
	const filename = path.resolve(__dirname, "..", relativePath);
	const source = `${fs.readFileSync(filename, "utf8")}\nmodule.exports.__privateRenderer = ${functionName};`;
	const loaded = new Module(filename, module);
	loaded.filename = filename;
	loaded.paths = Module._nodeModulePaths(path.dirname(filename));
	loaded._compile(source, filename);
	return loaded.exports.__privateRenderer;
}

function compileEmbeddedScripts(html) {
	const scripts = [...String(html).matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
		.filter(match => !/type=["']application\/json["']/i.test(match[1]))
		.map(match => match[2]);
	assert.ok(scripts.length > 0);
	for (const script of scripts) new Function(script);
}

test("Chronoblade generated webview scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuChronoblade/webview.js", "renderChronobladeHtml");
	const zeroSummary = {
		totalTimeSeconds: 0, cuttingTimeSeconds: 0, rapidTimeSeconds: 0,
		dwellTimeSeconds: 0, toolTimeSeconds: 0, otherTimeSeconds: 0,
		totalDistance: 0, cuttingDistance: 0
	};
	compileEmbeddedScripts(render({ timingProfiles: [], humanFormat: {} }, { rows: [], summary: zeroSummary }));
});

test("Vision generated webview scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuVision/webview.js", "renderVisionHtml");
	const document = makeDocument("G0 X0\nG1 X1");
	const html = render(document, "document", {}, {
		rows: [],
		range: { startLine: 0, endLine: document.lineCount - 1 },
		motionDisplayWords: { rapid: "G0", cutting: ["G1", "G2", "G3"] }
	});
	compileEmbeddedScripts(html);
	assert.match(html, /<button id="viewToggle">View<\/button>\s*<button id="offsetsToggle">Offsets<\/button>\s*<button id="macrosToggle">Macro<\/button>/);
	assert.doesNotMatch(html, /id="dataToggle"|id="dataPanel"/);
	assert.match(html, /data-offset-code="G53"[\s\S]*?data-offset-reference type="radio" name="offsetReference" value="G53" checked/);
	assert.match(html, /data-offset-code="G53"[\s\S]*?data-offset-zero type="checkbox" checked/);
	assert.match(html, /data-offset-code="G53"[\s\S]*?data-offset-axis="x"[^>]* disabled/);
	assert.doesNotMatch(html, /data-offset-enabled/);
	assert.match(html, /Assumed start[\s\S]*?data-start-frame[\s\S]*?G53/);
	assert.match(html, /data-start-axis="x"[^>]*value="0"/);
	assert.match(html, /savedWebviewState = vscode\.getState\(\) \|\| \{\}/);
	assert.match(html, /viewport: \{ plane: planeSelect\.value, zoom, pan: \{ x: pan\.x, y: pan\.y \} \}/);
});

test("G-code profile editor scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuMachineMode/profileEditor.js", "renderGCodeProfilesHtml");
	compileEmbeddedScripts(render([], "fanucIso"));
});
