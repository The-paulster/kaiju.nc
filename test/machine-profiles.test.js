const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { makeDocument, configurationValues, vscode } = require("./helpers");
const machine = require("../src/MetaMachineMode");
const motion = require("../src/MetaMotionEngine");
const { buildExecutionTrace } = require("../src/MetaExecutionTrace");
const { getFormattingOptions, formatDocumentText } = require("../src/kaijuReconstructor/formatter");
const { getSenseOptions } = require("../src/kaijuSense/options");
const { getVisionOptions } = require("../src/kaijuVision/options");
const { getAlertOptions } = require("../src/kaijuAlert/options");
const { getChronobladeOptions } = require("../src/kaijuChronoblade/options");
const { registerMachineProfileEditor, renderMachineProfilesHtml } = require("../src/kaijuMachineMode/machineProfileEditor");

function setup() {
	configurationValues.clear();
	const stored = new Map();
	const context = { subscriptions: [], workspaceState: {
		get: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
		update: async (key, value) => stored.set(key, value)
	} };
	machine.initializeMachineMode(context);
	return context;
}
function profile(id, options = {}) {
	return { ...machine.GENERIC_MACHINE_PROFILE, id, label: id, machineMode: "latheRadius", gCodeDialectId: "dmgMori", ...options };
}

test("work-offset defaults are shared and program overrides survive machine changes and reset", async () => {
	const context = setup();
	const document = makeDocument("G54 G0 X0\nG55 G0 X0", {uri: "offsets.nc"});
	await machine.saveMachineProfiles(document, [profile("first", {workOffsets: {G55: {x: 100, c: 90}}}), profile("second", {workOffsets: {G55: {x: -50}}})]);
	await machine.setMachineProfile(document, "first");
	assert.equal(getVisionOptions(document).workOffsets.G55.x, 100);
	assert.equal(getChronobladeOptions(document).workOffsets.G55.c, 90);
	assert.equal(getVisionOptions(document, {workOffsets: {G55: {x: 0}}}).workOffsets.G55.x, 0);
	await machine.saveDocumentWorkOffsets(document, {G55: {x: 25, c: -90}});
	await machine.setMachineProfile(document, "second");
	machine.initializeMachineMode(context);
	assert.equal(getVisionOptions(document).workOffsets.G55.x, 25);
	assert.equal(getChronobladeOptions(document).workOffsets.G55.x, 25);
	await machine.saveDocumentWorkOffsets(document, undefined);
	assert.equal(getChronobladeOptions(document).workOffsets.G55.x, -50);
	await context.workspaceState.update("kaijuVision.workOffsetsByDocument", {"offsets.nc": {G55: {x: 77}}});
	assert.equal(getChronobladeOptions(document).workOffsets.G55.x, 77);
	await machine.saveDocumentWorkOffsets(document, undefined);
	assert.equal(getChronobladeOptions(document).workOffsets.G55.x, -50);
	for (const workOffsets of [{G60: {x: 1}}, {G54: {c: NaN}}, {G54: {x: "1"}}, null]) assert.throws(() => machine.normalizeMachineProfiles([profile("bad", {workOffsets})]));
});

test("default machines apply to unassigned code while saved machine selections survive reopen and default changes", async () => {
	const context = setup();
	const document = makeDocument("G1 X10", { uri: "saved-machine.nc" });
	await machine.saveMachineProfiles(document, [profile("turner"), profile("mill", { machineMode: "mill", gCodeDialectId: "fanucIso" })]);
	await machine.setDefaultMachineProfile(document, "turner");
	assert.equal(machine.getMachineModeForDocument(document).profile.id, "latheRadius");
	assert.equal(machine.getMachineModeForDocument(document).gCodeDialectId, "dmgMori");
	await machine.setMachineProfile(document, "turner");
	await machine.setDefaultMachineProfile(document, "mill");
	machine.initializeMachineMode(context);
	const reopened = makeDocument("G1 X10", { uri: "saved-machine.nc" });
	assert.equal(machine.getMachineModeForDocument(reopened).machineProfile.id, "turner");
	assert.equal(machine.getMachineModeForDocument(makeDocument("G1 X10", { uri: "new-machine.nc" })).machineProfile.id, "mill");
	await machine.setGCodeDialect(reopened, "fanucIso");
	assert.equal(machine.getMachineModeForDocument(reopened).machineProfile.id, "turner");
	assert.equal(machine.getMachineModeForDocument(reopened).gCodeDialectId, "fanucIso");
	await machine.setMachineProfile(reopened, "turner");
	assert.equal(machine.getMachineModeForDocument(reopened).gCodeDialectId, "dmgMori");
});

test("legacy selections keep their type and settings until a named machine is applied", async () => {
	setup();
	const document = makeDocument("G1 X10");
	configurationValues.set("kaijuNC.sense.rapidRate", 1234);
	await machine.setMachineMode(document, "mill");
	await machine.saveMachineProfiles(document, [profile("turner")]);
	await machine.setDefaultMachineProfile(document, "turner");
	assert.equal(machine.getMachineModeForDocument(document).profile.id, "mill");
	assert.equal(machine.getMachineModeForDocument(document).machineProfile.id, "generic");
	assert.equal(getSenseOptions(document).rapidRate, 1234);
	await machine.setMachineProfile(document, "turner");
	assert.equal(machine.getMachineModeForDocument(document).profile.id, "latheRadius");
	await machine.setMachineMode(document, "latheDiameter");
	assert.equal(machine.getMachineModeForDocument(document).machineSettings, undefined);
});

test("a G-code override retains a machine inherited from the default profile", async () => {
	const context = setup();
	const document = makeDocument("G0 X10", { uri: "inherited-machine.nc" });
	await machine.saveMachineProfiles(document, [profile("shop", {rapidRate: 321, workOffsets: {G54: {z: -100}}}), profile("other")]);
	await machine.setDefaultMachineProfile(document, "shop");
	await machine.setGCodeDialect(document, "fanucIso");
	machine.initializeMachineMode(context);
	const reopened = makeDocument("G0 X10", {uri: "inherited-machine.nc"});
	assert.equal(machine.getMachineModeForDocument(reopened).machineProfile.id, "shop");
	assert.equal(getVisionOptions(reopened).rapidRate, 321);
	assert.equal(getChronobladeOptions(reopened).workOffsets.G54.z, -100);
	assert.equal(machine.getMachineModeForDocument(reopened).gCodeDialectId, "fanucIso");
	await machine.setDefaultMachineProfile(reopened, "other");
	assert.equal(machine.getMachineModeForDocument(reopened).machineProfile.id, "shop");
});

test("Vision retains its chosen plane on machine setting edits and resets it on a type change", async () => {
	const context = setup();
	const document = makeDocument("G0 X10", {uri: "view-profile.nc"});
	await machine.saveMachineProfiles(document, [profile("shop")]);
	await machine.setMachineProfile(document, "shop");
	const path = require("node:path"), fs = require("node:fs"), Module = require("node:module");
	const filename = path.resolve(__dirname, "../src/kaijuVision/webview.js");
	const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
	mod._compile(fs.readFileSync(filename, "utf8") + `\nmodule.exports = {
		initialize(context, state) { visionContext = context; visionState = state; },
		refresh: resetVisionPlaneForMachineMode, state: () => visionState
	};`, filename);
	mod.exports.initialize(context, {documentUriText: document.uri.toString(), mode: "whole", playbackLocked: true,
		options: {...getVisionOptions(document), plane: "xy"}});
	await machine.saveMachineProfiles(document, [profile("shop", {rapidRate: 321, workOffsets: {G54: {z: -100}}})]);
	await mod.exports.refresh(document);
	assert.equal(mod.exports.state().options.plane, "xy");
	assert.equal(mod.exports.state().options.rapidRate, 321);
	assert.equal(mod.exports.state().options.workOffsets.G54.z, -100);
	await machine.saveMachineProfiles(document, [profile("shop", {machineMode: "mill"})]);
	await mod.exports.refresh(document);
	assert.equal(mod.exports.state().options.plane, "xy");
	mod.exports.state().options.plane = "yz";
	await machine.saveMachineProfiles(document, [profile("shop", {machineMode: "latheRadius"})]);
	await mod.exports.refresh(document);
	assert.equal(mod.exports.state().options.plane, "zx");
});

test("explicitly choosing Generic Machine as default uses its displayed settings", async () => {
	setup();
	const document = makeDocument("G1 X10");
	configurationValues.set("kaijuNC.sense.rapidRate", 1234);
	assert.equal(getSenseOptions(document).rapidRate, 1234);
	await machine.setDefaultMachineProfile(document, "generic");
	assert.equal(getSenseOptions(document).rapidRate, 10000);
});

test("a removed controller leaves the machine editable but must be replaced before saving", () => {
	setup();
	configurationValues.set("kaijuNC.machineProfiles.customProfiles", [profile("orphan", { gCodeDialectId: "removed-controller" })]);
	assert.equal(machine.getMachineProfiles(makeDocument("G1 X10"))[1].gCodeDialectId, "removed-controller");
	assert.throws(() => machine.normalizeMachineProfiles([profile("orphan", { gCodeDialectId: "removed-controller" })]), /unavailable/);
});

test("machine behavior reaches all motion consumers and ignores obsolete report timing overrides", async () => {
	setup();
	const document = makeDocument("G0 X10 C0\nG98 G1 H720 F100\nM46\nG1 C0");
	await machine.saveMachineProfiles(document, [profile("continuous", { rapidRate: 20000, toolChangeSeconds: 8, extraStationSeconds: 1.5,
		cAxisCoordinates: "continuous", cAxisResetOnDisable: false })]);
	await machine.setMachineProfile(document, "continuous");
	for (const options of [getSenseOptions(document), getVisionOptions(document), getAlertOptions(document), getChronobladeOptions(document)]) {
		assert.equal(options.cAxisCoordinates, "continuous");
		assert.equal(options.cAxisResetOnDisable, false);
		assert.equal(options.gCodeDialectId, "dmgMori");
	}
	for (const options of [getSenseOptions(document), getVisionOptions(document), getChronobladeOptions(document)]) assert.equal(options.rapidRate, 20000);
	assert.equal(getChronobladeOptions(document).toolChangeSeconds, 8);
	assert.equal(getChronobladeOptions(document, { rapidRate: 500 }).rapidRate, 20000);
	configurationValues.set("kaijuNC.chronoblade.timingProfiles", [{ name: "Measured", rapidRate: 999 }]);
	assert.equal(getChronobladeOptions(document, { timingProfile: "Measured" }).rapidRate, 20000);
	const vision = motion.analyzeVisionRange(document, undefined, getVisionOptions(document));
	const rows = vision.rows.filter(row => row.type === "motion" && row.motionCode === 1);
	assert.equal(rows[0].end.c, 720);
	assert.equal(rows[1].start.c, 720);
	assert.equal(rows[1].end.c, 0);
	assert.equal(vision.positionEvents.length, 1);
	assert.equal(vision.positionEvents[0].position.c, 720);
	const wrapped = motion.analyzeVisionRange(document, undefined, { ...getVisionOptions(document), cAxisCoordinates: "wrapped", cAxisResetOnDisable: true });
	assert.equal(wrapped.rows.filter(row => row.type === "motion" && row.motionCode === 1)[0].end.c, 0);
	assert.equal(wrapped.positionEvents.length, 1);
});

test("profile validation rejects collisions, missing controllers, invalid numbers, and preserves false and zero", () => {
	setup();
	for (const value of [[profile("generic")], [profile("same"), profile("same")], [profile("bad", { rapidRate: -1 })],
		[profile("bad", { label: " " })], [profile("bad", { gCodeDialectId: "missing" })], [profile("bad", { toolChangeSeconds: null })]]) {
		assert.throws(() => machine.normalizeMachineProfiles(value));
	}
	const result = machine.normalizeMachineProfiles([profile("zero", { rapidRate: 0, cAxisResetOnDisable: false })]);
	assert.equal(result[0].rapidRate, 0);
	assert.equal(result[0].cAxisResetOnDisable, false);
});

function runPage(data) {
	const html = renderMachineProfilesHtml(data);
	const dataStart = html.indexOf('id="profileData">') + 'id="profileData">'.length;
	const dataEnd = html.indexOf('</script>', dataStart);
	const start = html.lastIndexOf('<script nonce=');
	const scriptStart = html.indexOf('>', start) + 1;
	const script = html.slice(scriptStart, html.indexOf('</script>', scriptStart));
	new Function(script);
	const elements = new Map();
	function element() {
		return { value: '', checked: false, disabled: false, children: [], handlers: {}, parentElement: {},
			classList: { toggle() {} }, append(...children) { this.children.push(...children); }, setAttribute(name, value) { this[name] = value; },
			replaceChildren() { this.children = []; }, addEventListener(type, listener) { this.handlers[type] = listener; },
			focus() {}, reportValidity() { return true; } };
	}
	const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
	document.getElementById('profileData').textContent = html.slice(dataStart, dataEnd);
	const messages = [], listeners = {};
	vm.runInNewContext(script, { document, window: { addEventListener: (type, listener) => { listeners[type] = listener; } }, acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }) });
	return { html, elements, messages, listeners };
}

test("percent profile settings survive persistence, honor false, and default off for legacy profiles", async () => {
	const context = setup();
	const document = makeDocument("O1000\nM30", { uri: "percent-profile.nc" });
	const legacy = profile("legacy"); delete legacy.requiresPercentDelimiters;
	assert.equal(machine.normalizeMachineProfiles([legacy])[0].requiresPercentDelimiters, false);
	assert.throws(() => machine.normalizeMachineProfiles([profile("bad", { requiresPercentDelimiters: "true" })]));
	assert.equal(getFormattingOptions(document).addPercentDelimiters, false);
	await machine.saveMachineProfiles(document, [profile("wrapped", { requiresPercentDelimiters: true }), legacy]);
	await machine.setMachineProfile(document, "wrapped");
	machine.initializeMachineMode(context);
	assert.equal(getFormattingOptions(document).addPercentDelimiters, true);
	assert.equal(getFormattingOptions(document, { addPercentDelimiters: false }).addPercentDelimiters, false);
	const { decomposeDocument } = require("../src/kaijuDecomposition");
	const trace = await decomposeDocument(document, { promptForUnknownMacros: false });
	assert.ok(!trace.text.split(/\r?\n/).includes("%"));
	for (const entry of trace.decompositionLines) {
		assert.equal(trace.text.split(/\r?\n/)[entry.lineNumber - 1], entry.line);
	}
	await machine.setMachineProfile(document, "legacy");
	assert.equal(getFormattingOptions(document).addPercentDelimiters, false);
});

test("percent checkbox loads, copies, and saves independent machine settings", () => {
	setup();
	const page = runPage({ profiles: [machine.GENERIC_MACHINE_PROFILE, profile("source")], dialects: [{ id: "dmgMori", label: "DMG MORI" }], currentId: "source", defaultId: "generic" });
	assert.ok(page.html.includes('Requires % delimiters'));
	const node = id => page.elements.get(id);
	assert.equal(node('requiresPercentDelimiters').checked, false);
	node('requiresPercentDelimiters').checked = true;
	node('requiresPercentDelimiters').handlers.input();
	node('copyProfile').onclick(); node('newName').value = 'Copy'; node('createProfile').onclick();
	assert.equal(node('requiresPercentDelimiters').checked, true);
	node('requiresPercentDelimiters').checked = false;
	node('requiresPercentDelimiters').handlers.input();
	node('save').onclick();
	assert.equal(page.messages[0].profiles.find(profile => profile.id === 'source').requiresPercentDelimiters, true);
	assert.equal(page.messages[0].profiles.find(profile => profile.id === page.messages[0].selectedId).requiresPercentDelimiters, false);
});

test("machine timing lists normalize M codes and charge every executed occurrence", async () => {
	setup();
	const document = makeDocument("#100=0\nWHILE [#100 LT 2] DO1\nM86\n#100=#100+1\nEND1");
	await machine.saveMachineProfiles(document, [profile("timed", { customTimes: { m086: 3, M05: 0 } })]);
	await machine.setMachineProfile(document, "timed");
	const options = getChronobladeOptions(document);
	assert.deepEqual(options.customEventTimes, { M86: 3, M5: 0 });
	const result = motion.analyzeChronobladeRange(document, undefined, { ...options, executionTrace: buildExecutionTrace(document, { includeExecutionEntries: true }) });
	assert.equal(result.summary.otherTimeSeconds, 6);
	assert.equal(result.rows.filter(row => row.type === "other").length, 2);
	configurationValues.set("kaijuNC.chronoblade.timingProfiles", [{ name: "Measured", rapidRate: 999, customTimes: { M05: 4 } }]);
	assert.deepEqual(getChronobladeOptions(document, { timingProfile: "Measured" }).customEventTimes, { M86: 3, M5: 0 });
	for (const customTimes of [{ M05: 1, M5: 2 }, { G1: 1 }, { M86: -1 }, { M86: null }]) assert.throws(() => machine.normalizeMachineProfiles([profile("bad", { customTimes })]));
	const legacy = profile("legacy"); delete legacy.customTimes; delete legacy.requiresSemicolons;
	const normalized = machine.normalizeMachineProfiles([legacy])[0];
	assert.deepEqual(normalized.customTimes, {});
	assert.equal(normalized.requiresSemicolons, false);
});

test("machine semicolon settings reach Reconstructor while explicit command overrides remain available", async () => {
	setup();
	const document = makeDocument("G1 X10 (cut)");
	await machine.saveMachineProfiles(document, [profile("semicolon", { requiresSemicolons: true }), profile("plain", { requiresSemicolons: false })]);
	await machine.setMachineProfile(document, "semicolon");
	assert.equal(getFormattingOptions(document).autoSemicolon, true);
	assert.match(formatDocumentText("G1 X10 (cut)", getFormattingOptions(document)), /;\s*\(cut\)/);
	assert.equal(getFormattingOptions(document, { autoSemicolon: false }).autoSemicolon, false);
	await machine.setMachineProfile(document, "plain");
	assert.equal(getFormattingOptions(document).autoSemicolon, false);
});

test("Timing tab supports add/remove entries and independent copies without exposing a document path", () => {
	setup();
	const page = runPage({ profiles: [machine.GENERIC_MACHINE_PROFILE, profile("source", { customTimes: { M86: 2 } })], dialects: [{ id: "dmgMori", label: "DMG MORI" }],
		currentId: "source", defaultId: "generic", program: "C:/private/source.nc" });
	assert.ok(!page.html.includes("C:/private/source.nc"));
	assert.ok(!page.html.includes('id="program"'));
	const node = id => page.elements.get(id);
	node('timingTab').onclick();
	assert.equal(node('machinePane').hidden, true);
	assert.equal(node('timingPane').hidden, false);
	node('addTiming').onclick();
	let row = node('customTimes').children[1];
	row.children[0].value = 'M05'; row.children[0].handlers.input();
	row.children[1].value = '3'; row.children[1].handlers.input();
	node('requiresSemicolons').checked = true; node('requiresSemicolons').handlers.input();
	node('copyProfile').onclick(); node('newName').value = 'Copy'; node('createProfile').onclick();
	row = node('customTimes').children[1]; row.children[1].value = '7'; row.children[1].handlers.input();
	node('save').onclick();
	const output = page.messages[0].profiles;
	assert.deepEqual(JSON.parse(JSON.stringify(output.find(profile => profile.id === 'source').customTimes)), { M86: 2, M5: 3 });
	assert.equal(output.find(profile => profile.id === page.messages[0].selectedId).customTimes.M5, 7);
	assert.equal(output.find(profile => profile.id === page.messages[0].selectedId).requiresSemicolons, true);
	page.listeners.message({ data: { type: 'saved', currentId: 'source', defaultId: 'generic' } });
	node('customTimes').children[1].children[2].onclick();
	assert.equal(node('customTimes').children.length, 1);
	node('addTiming').onclick(); row = node('customTimes').children[1];
	row.children[0].value = 'M086'; row.children[0].handlers.input();
	node('save').onclick();
	assert.equal(page.messages.length, 1);
	assert.match(node('notice').textContent, /Duplicate/);
});

test("generated page creates independent copies, selects their controller, and submits save/use/default actions", () => {
	setup();
	const source = profile("source", { label: 'Machine </script><script>bad()</script>', rapidRate: 2222 });
	const page = runPage({ profiles: [machine.GENERIC_MACHINE_PROFILE, source], dialects: [{ id: "fanucIso", label: "FANUC / ISO" }, { id: "dmgMori", label: "DMG MORI" }],
		currentId: "source", defaultId: "generic", program: "source.nc" });
	assert.ok(!page.html.includes('<script>bad()'));
	const node = id => page.elements.get(id);
	node('newProfile').onclick();
	node('copyFrom').value = "source"; node('newName').value = "Copied machine"; node('createProfile').onclick();
	assert.equal(node('rapidRate').value, 2222);
	assert.equal(node('gCodeDialectId').value, "dmgMori");
	node('rapidRate').value = "3333"; node('rapidRate').handlers.input();
	node('rapidX').value = "600"; node('rapidX').handlers.input();
	node('rapidC').value = "360"; node('rapidC').handlers.input();
	node('rotaryFeedRule').value = "scaledDegrees"; node('rotaryFeedRule').handlers.input();
	assert.equal(node('rotaryFeedScale').parentElement.hidden, false);
	node('rotaryFeedScale').value = "2"; node('rotaryFeedScale').handlers.input();
	node('turretStationCount').value = "12"; node('turretStationCount').handlers.input();
	node('startupPlane').value = "xz"; node('startupPlane').handlers.input();
	node('cssSurfaceSpeedUnit').value = "sfm"; node('cssSurfaceSpeedUnit').handlers.input();
	node('offsetsTab').onclick(); assert.equal(node('offsetsPane').hidden, false);
	node('offset-G55-x').value = "-100"; node('offset-G55-x').handlers.input();
	node('offset-G55-c').value = "90"; node('offset-G55-c').handlers.input();
	node('use').onclick();
	assert.equal(page.messages[0].type, "use");
	assert.equal(page.messages[0].profiles.find(profile => profile.id === "source").rapidRate, 2222);
	assert.equal(page.messages[0].profiles.find(profile => profile.id === page.messages[0].selectedId).rapidRate, 3333);
	const copied = page.messages[0].profiles.find(profile => profile.id === page.messages[0].selectedId);
	assert.equal(copied.rapidRates.x, 600); assert.equal(copied.rapidRates.c, 360);
	assert.equal(copied.rotaryFeedScale, 2); assert.equal(copied.turretStationCount, 12);
	assert.equal(copied.startupPlane, "xz"); assert.equal(copied.cssSurfaceSpeedUnit, "sfm");
	assert.equal(copied.workOffsets.G55.x, -100); assert.equal(copied.workOffsets.G55.c, 90);
	assert.equal(page.messages[0].profiles.find(profile => profile.id === "source").workOffsets.G55, undefined);
	assert.equal(page.messages[0].profiles.find(profile => profile.id === "source").rapidRates.x, null);
	page.listeners.message({ data: { type: "saved", currentId: page.messages[0].selectedId, defaultId: "generic", notice: "Saved" } });
	node('default').onclick();
	assert.equal(page.messages[1].type, "default");
	page.listeners.message({ data: { type: "error", notice: "Failed to save" } });
	assert.equal(node('notice').textContent, "Failed to save");
	assert.equal(node('use').disabled, false);
});

test("webview actions remain bound to their source document when another editor becomes active", async () => {
	const context = setup();
	const source = makeDocument("G1 X10", { uri: "source-editor.nc" });
	const other = makeDocument("G1 X10", { uri: "other-editor.nc" });
	let open, receive;
	vscode.commands = { registerCommand(id, callback) { open = callback; return { dispose() {} }; } };
	vscode.ViewColumn = { Beside: 2 };
	vscode.window.activeTextEditor = { document: source };
	vscode.window.createWebviewPanel = () => ({ onDidDispose() {}, dispose() {}, webview: { onDidReceiveMessage(callback) { receive = callback; }, postMessage: async () => true } });
	registerMachineProfileEditor(context);
	open();
	vscode.window.activeTextEditor = { document: other };
	await receive({ type: "use", selectedId: "test-machine", profiles: [profile("test-machine")] });
	assert.equal(machine.getMachineModeForDocument(source).machineProfile.id, "test-machine");
	assert.equal(machine.getMachineModeForDocument(other).machineProfile.id, "generic");
});
