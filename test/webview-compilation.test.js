const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { makeDocument } = require("./helpers");

const syntax = require("../syntaxes/gcode.tmLanguage.json");

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

test("G-code grammar accepts decimal G words", () => {
	const repositories = syntax.repository;
	const rapid = new RegExp(repositories.rapidgcodes.patterns[0].match);
	const cutting = new RegExp(repositories.cuttinggcodes.patterns[0].match);
	const general = new RegExp(repositories.gcodes.patterns[0].match);
	assert.match("G0.0", rapid);
	assert.match("G1.0", cutting);
	assert.match("G12.1", general);
	assert.match("G0.5", general);
	assert.doesNotMatch("G1.2", cutting);
});

test("Chronoblade generated webview scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuChronoblade/webview.js", "renderChronobladeHtml");
	const zeroSummary = {
		totalTimeSeconds: 0, cuttingTimeSeconds: 0, rapidTimeSeconds: 0,
		dwellTimeSeconds: 0, toolTimeSeconds: 0, otherTimeSeconds: 0,
		totalDistance: 0, cuttingDistance: 0
	};
	const html = render({ timingProfiles: [], humanFormat: {} }, { rows: [], summary: zeroSummary });
	compileEmbeddedScripts(html);
	assert.match(html, /formatVirtualTime\(row\.labelTotalTimeSeconds\)/);
	assert.match(html, /formatVirtualAccumulatedTime\(entry\.accumulatedLabelTimeSeconds\)/);
	assert.match(html, /<td colspan="7"><button class="section-toggle"/);
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
	assert.match(html, /<button id="viewToggle">View<\/button>\s*<button id="dualViewToggle"[^>]*>Dual View<\/button>\s*<label id="sharedAxisControl"[^>]*>Shared axis[\s\S]*?<\/label>\s*<button id="offsetsToggle">Offsets<\/button>\s*<button id="macrosToggle">Macro<\/button>/);
	assert.doesNotMatch(html, /id="dataToggle"|id="dataPanel"/);
	assert.match(html, /data-offset-code="G53"[\s\S]*?data-offset-reference type="radio" name="offsetReference" value="G53" checked/);
	assert.match(html, /data-offset-code="G53"[\s\S]*?data-offset-zero type="checkbox" checked/);
	assert.match(html, /data-offset-code="G53"[\s\S]*?data-offset-axis="x"[^>]* disabled/);
	assert.doesNotMatch(html, /data-offset-enabled/);
	assert.match(html, /Assumed start[\s\S]*?data-start-frame[\s\S]*?G53/);
	assert.match(html, /data-start-axis="x"[^>]*value="0"/);
	assert.match(html, /savedWebviewState = vscode\.getState\(\) \|\| \{\}/);
	assert.match(html, /viewport: \{ plane: getPrimaryPlaneKey\(\), zoom, pan: getProjectedPan\(planes\[getPrimaryPlaneKey\(\)\] \|\| planes\.xz\) \}/);
	assert.match(html, /function getDisplayedVisionLineNumber\(row\)/);
	assert.match(html, /"L" \+ getDisplayedVisionLineNumber\(row\)/);
	assert.match(html, /"L" \+ getDisplayedVisionLineNumber\(cycle\) \+ " " \+ cycle\.instruction/);
	assert.match(html, /G\(\?:41\|42\|43\|44\|46\)/);
	assert.match(html, /G\(\?:40\|49\)/);
	assert.match(html, /id="grid" type="checkbox"/);
	assert.match(html, /id="gridSize" type="number" min="0\.001"/);
	assert.match(html, /<section id="viewPanel" class="control-panel">[\s\S]*?visibility-group-title">Tools[\s\S]*?visibility-group-title">WCS[\s\S]*?<\/section>/);
	assert.doesNotMatch(html, /id="visibilityToggle"|id="visibilityPanel"/);
	assert.match(html, /function drawGrid\(context, bounds, transform, size, showGrid\)/);
	assert.match(html, /data-tooltip-merged="true"/);
	assert.match(html, /function togglePinnedTooltip\(event\)/);
	assert.match(html, /if \(!target\) \{\s*if \(pinnedTooltip\) clearPinnedTooltip\(\);/);
	assert.match(html, /pinned-tooltip-list/);
	assert.match(html, /id="dualViewToggle"/);
	assert.match(html, /id="sharedAxis"/);
	assert.match(html, /function getDualPlanePair\(axis\)/);
	assert.match(html, /function getDualViewFitHeight\(viewportAspect = 1\)/);
	assert.match(html, /function getSharedAxisForPlane\(planeKey\)/);
	assert.match(html, /worldPan: \{ x: worldPan\.x, y: worldPan\.y, z: worldPan\.z \}/);
	assert.match(html, /sharedAxis/);
	assert.match(html, /renderViewport\(viewer, getPrimaryPlaneKey\(\), "primary"\)/);
	assert.match(html, /renderViewport\(secondaryViewer, getSecondaryPlaneKey\(\), "secondary"\)/);
	assert.match(html, /state && state\.canvasId \? state\.canvasId : "vision-canvas"/);
	assert.match(html, /function drawWebglLayer\(canvas, state\)/);
	assert.match(html, /function previewWebglPan\(state, projectedPan\)/);
	const embeddedScript = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
		.filter(match => !/type=["']application\/json["']/i.test(match[1]))[0][2];
	const webglColorStart = embeddedScript.indexOf("function webglColor(");
	const webglColorEnd = embeddedScript.indexOf("\n\t\t}", webglColorStart) + "\n\t\t}".length;
	const embeddedWebglColor = new Function(`${embeddedScript.slice(webglColorStart, webglColorEnd)}\nreturn webglColor("hsl(120 100% 50%)");`);
	assert.deepEqual(Array.from(embeddedWebglColor()), [0, 1, 0, 1], "generated Vision script must preserve its HSL tool-colour parser");
	assert.match(html, /motionIndexByExecutionIndex/);
});

test("Vision playback only shows C when the program commands C", () => {
	const getVisionProgramAxes = loadPrivateRenderer("src/kaijuVision/webview.js", "getVisionProgramAxes");
	assert.deepEqual(getVisionProgramAxes(makeDocument("G0 X0 H1\nG1 Z-2\n(C90)")), ["x", "z"]);
	assert.deepEqual(getVisionProgramAxes(makeDocument("G0 X0\nG1 C90")), ["x", "c"]);
});

test("Orphan Killer generated webview scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuOrphanKiller/index.js", "renderOrphanHtml");
	const document = makeDocument("#100 = 1");
	const html = render(document, {
		undefinedUses: [{ macro: "#101", name: "", lines: [1] }],
		unusedDefinitions: [{ macro: "#100", name: "", lines: [1] }]
	}, true);
	compileEmbeddedScripts(html);
	assert.match(html, /id="live" type="checkbox" checked/);
	assert.match(html, /type: "setLive", live: event\.target\.checked/);
	assert.match(html, /class="summary-grid"/);
	assert.doesNotMatch(html, /test\.nc/);
});

test("G-code profile editor scripts compile", () => {
	const render = loadPrivateRenderer("src/kaijuMachineMode/profileEditor.js", "renderGCodeProfilesHtml");
	compileEmbeddedScripts(render([], "fanucIso"));
});
