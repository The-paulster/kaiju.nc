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
	compileEmbeddedScripts(render(document, "document", {}, {
		rows: [],
		range: { startLine: 0, endLine: document.lineCount - 1 },
		motionDisplayWords: { rapid: "G0", cutting: ["G1", "G2", "G3"] }
	}));
});

test("G-code profile editor scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuMachineMode/profileEditor.js", "renderGCodeProfilesHtml");
	compileEmbeddedScripts(render([], "fanucIso"));
});
