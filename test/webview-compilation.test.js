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
	let cursor = 0, count = 0;
	while ((cursor = html.indexOf("<script", cursor)) !== -1) {
		const start = html.indexOf(">", cursor) + 1;
		const end = html.indexOf("</script>", start);
		assert.ok(start > 0 && end >= start);
		if (!html.slice(cursor, start).includes('type="application/json"')) {
			new Function(html.slice(start, end));
			count++;
		}
		cursor = end + "</script>".length;
	}
	assert.ok(count > 0);
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
	const html = render({ machineProfileLabel: 'Shop <lathe>', rapidRate: 1234, toolChangeSeconds: 8, extraStationSeconds: 2, humanFormat: {} }, { rows: [], summary: zeroSummary });
	compileEmbeddedScripts(html);
	assert.match(html, /<span class="machine-name" title="Shop &lt;lathe&gt;">Shop &lt;lathe&gt;<\/span>/);
	assert.match(html, /<button id="editMachineTiming"/);
	assert.match(html, /type: "editMachineTiming"/);
	assert.match(html, /<output[^>]*>1234<\/output>/);
	assert.doesNotMatch(html, /timingProfile|setChronobladeTiming|collectTimingOptions|hasTimingOverrides|<input id="(?:rapidRate|toolChangeSeconds|extraStationSeconds)"/);
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
	assert.match(html, /data-offset-axis="c"[^>]*value="0"/);
	assert.match(html, /<th>C \(degrees\)<\/th>/);
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
	assert.match(html, /value="xHorizontal">X horizontal[\s\S]*value="xVertical">X vertical[\s\S]*value="yHorizontal">Y horizontal[\s\S]*value="yVertical">Y vertical[\s\S]*value="zHorizontal">Z horizontal[\s\S]*value="zVertical">Z vertical/);
	assert.match(html, /function getDualPlanePair\(axisMode\)/);
	assert.match(html, /function getDualViewFitHeight\(viewportAspect = 1\)/);
	assert.match(html, /function getSharedAxisModeForPlane\(planeKey\)/);
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

test("Vision work-frame labels follow mode-specific bindings without changing frame keys", () => {
	const dialect = require("../src/MetaGCodeDialect");
	const render = loadPrivateRenderer("src/kaijuVision/webview.js", "renderVisionHtml");
	const operations = dialect.G_CODE_OPERATIONS;
	try {
		dialect.setCustomGCodeDialectProfiles([{ id: "vision-wcs", label: "Vision WCS", bindings: {
			mill: { [operations.WORK_COORDINATE_2]: { code: 155 }, [operations.WORK_COORDINATE_3]: null },
			lathe: { [operations.WORK_COORDINATE_2]: { code: 255 }, [operations.WORK_COORDINATE_3]: null }
		} }]);
		for (const [machineMode, word] of [["mill", "G155"], ["latheDiameter", "G255"]]) {
			const document = makeDocument(`${word} G0 X0 Y0 Z0`);
			const html = render(document, "document", { machineMode, gCodeDialectId: "vision-wcs", referenceFrame: "G55", initialPosition: { coordinateSystem: "G55" } }, {
				rows: [{ type: "motion", lineNumber: 1, coordinateSystem: "G55", instruction: "G0", distance: 0, warnings: [], points: [] }],
				range: { startLine: 0, endLine: 0 }
			});
			compileEmbeddedScripts(html);
			assert.ok(html.includes(`<tr data-offset-code="G55">\n\t\t\t<td><code>WCS2 (${word})</code></td>`));
			assert.ok(html.includes(`<option value="G55" selected>WCS2 (${word})</option>`));
			assert.ok(html.includes(`value="G55" checked> WCS2 (${word})</label>`));
			assert.ok(html.includes("<code>WCS3 (unbound)</code>"));
			assert.ok(html.includes("<code>WCS1 (G54)</code>"));
			assert.ok(html.includes("<code>WCS6 (G59)</code>"));
			const payloadStart = html.lastIndexOf("<script", html.indexOf('id="vision-data"'));
			const payload = JSON.parse(html.slice(html.indexOf(">", payloadStart) + 1, html.indexOf("</script>", payloadStart)));
			const scriptStart = html.lastIndexOf("<script nonce=");
			const script = html.slice(html.indexOf(">", scriptStart) + 1, html.indexOf("</script>", scriptStart));
			const keyHelper = script.slice(script.indexOf("function getRowWcsKey("), script.indexOf("function getOrderedOrientation("));
			const labelHelper = script.slice(script.indexOf("function getRowWcsLabel("), script.indexOf("function formatTableDistance("));
			const label = new Function("data", keyHelper + labelHelper + "return getRowWcsLabel;")(payload);
			assert.equal(label({ coordinateSystem: "G55" }), `WCS2 (${word})`);
			assert.equal(label({ coordinateSystem: "G56" }), "WCS3 (unbound)");
			assert.equal(label({ coordinateSystem: "G53" }), "G53");
			assert.equal(payload.rows[0].coordinateSystem, "G55");
			assert.equal(payload.options.referenceFrame, "G55");
		}
	} finally { dialect.setCustomGCodeDialectProfiles([]); }
});

test("H syntax covers full incremental C values and retains its scope", () => {
	const hWord = syntax.repository.hcodes.patterns[0];
	const matcher = new RegExp(hWord.match);
	assert.equal(hWord.name, "support.code.h.gcode");
	for (const word of ["H360.000", "H-45.5", "H+.25", "H#123"]) {
		assert.equal(word.match(matcher)?.[0], word);
	}
	assert.equal("SQRT[100]".match(matcher), null);
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
	const html = render([], "fanucIso", undefined, "Profiles saved.");
	compileEmbeddedScripts(html);
	assert.match(html, /id="saveProfile" class="primary" type="button" disabled>Save profiles/);
	assert.match(html, /id="useProfile" class="primary" type="button">Use for this program/);
	assert.doesNotMatch(html, /Save and use for this program|Save as fallback/);
	assert.match(html, /function markDirty\(\) \{ dirty = true; saveProfile\.disabled = false; \}/);
	assert.match(html, /type: 'useGCodeProfile', profiles: customProfiles, profileId: selected\.id/);
	assert.match(html, /initial\.notice \|\| ''/);
});

test("Vision reference changes preserve G53 offsets across edits and reopening", () => {
	const render = loadPrivateRenderer("src/kaijuVision/webview.js", "renderVisionHtml");
	const workOffsets = {
		G53: { x: 0, y: 0, z: 0, c: 0 },
		G54: { x: 100, y: -20, z: 30, c: 90 },
		G55: { x: 140, y: 10, z: -5, c: 180 }
	};
	function open(offsets, referenceFrame) {
		const sourceDocument = makeDocument("G0 X0");
		const html = render(sourceDocument, "document", { workOffsets: offsets, referenceFrame }, {
			rows: [], range: { startLine: 0, endLine: 0 }
		});
		const scriptStart = html.lastIndexOf("<script nonce=");
		const script = html.slice(html.indexOf(">", scriptStart) + 1, html.indexOf("</script>", scriptStart));
		new Function(script);
		const rows = [...html.matchAll(/<tr data-offset-code="([^"]+)">([\s\S]*?)<\/tr>/g)].map(match => {
			const inputs = {};
			for (const axis of ["x", "y", "z", "c"]) {
				const tag = match[2].match(new RegExp('data-offset-axis="' + axis + '"[^>]*'))[0];
				inputs[axis] = { value: tag.match(/value="([^"]*)"/)[1], disabled: tag.includes(" disabled") };
			}
			return {
				code: match[1], inputs,
				getAttribute: () => match[1],
				querySelector: selector => selector.includes("data-offset-axis")
					? inputs[selector.match(/='([^']+)'/)[1]]
					: selector.includes("data-offset-zero") ? { checked: false } : { value: "" }
			};
		});
		const document = { querySelectorAll: () => rows };
		const origin = script.slice(script.indexOf("const offsetReferenceOrigin ="), script.indexOf("function collectWorkOffsets()"));
		const collect = script.slice(script.indexOf("function collectWorkOffsets()"), script.indexOf("function collectReferenceFrame()"));
		const select = script.slice(script.indexOf("function selectOffsetReference("), script.indexOf("function getVisibilityState()"));
		return { rows, ...new Function("data", "document", "previewOffsets", origin + collect + select + "return { collectWorkOffsets, selectOffsetReference };")(
			{ options: { workOffsets: offsets, referenceFrame } }, document, () => {}
		) };
	}
	const panel = open(workOffsets, "G54");
	const row = code => panel.rows.find(entry => entry.code === code);
	assert.equal(Number(row("G53").inputs.x.value), -100);
	assert.equal(Number(row("G54").inputs.x.value), 0);
	assert.equal(Number(row("G55").inputs.c.value), 90);
	panel.selectOffsetReference({ closest: () => row("G55") });
	assert.equal(Number(row("G53").inputs.x.value), -140);
	assert.equal(Number(row("G54").inputs.x.value), -40);
	assert.equal(Number(row("G55").inputs.c.value), 0);
	for (const code of Object.keys(workOffsets)) {
		for (const axis of ["x", "y", "z", "c"]) assert.equal(panel.collectWorkOffsets()[code][axis], workOffsets[code][axis]);
	}
	row("G54").inputs.x.value = "-35";
	const saved = panel.collectWorkOffsets();
	assert.equal(saved.G54.x, 105);
	const reopened = open(saved, "G55");
	assert.equal(Number(reopened.rows.find(entry => entry.code === "G54").inputs.x.value), -35);
	reopened.selectOffsetReference({ closest: () => reopened.rows.find(entry => entry.code === "G53") });
	assert.equal(Number(reopened.rows.find(entry => entry.code === "G54").inputs.x.value), 105);
	assert.equal(reopened.collectWorkOffsets().G55.c, 180);
});
