const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { makeDocument, configurationValues, vscode } = require('./helpers');
const machine = require('../src/MetaMachineMode');
const { getChronobladeOptions } = require('../src/kaijuChronoblade/options');

function setup() {
	configurationValues.clear();
	const stored = new Map();
	const context = { subscriptions: [], workspaceState: {
		get: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
		update: async (key, value) => stored.set(key, value)
	} };
	machine.initializeMachineMode(context);
	const filename = path.resolve(__dirname, '../src/kaijuChronoblade/webview.js');
	const loaded = new Module(filename, module);
	loaded.filename = filename;
	loaded.paths = Module._nodeModulePaths(path.dirname(filename));
	loaded._compile(fs.readFileSync(filename, 'utf8') + `
module.exports = {
 initialize(context) { chronobladeContext = context; },
 options: makeChronobladeOptions, save: saveDocumentChronobladeSettings,
 show: showChronobladePanel, refresh: refreshMachineModeChronoblade,
 state: () => chronobladeState
};`, filename);
	loaded.exports.initialize(context);
	return { context, report: loaded.exports };
}

function profile(id, settings = {}) {
	return { ...machine.GENERIC_MACHINE_PROFILE, id, label: id, machineMode: 'mill', ...settings };
}

test('reopened reports ignore old timing settings and discard overrides when controls are saved', async () => {
	const { context, report } = setup();
	const document = makeDocument('G0 X0\nG0 X100\nM5', { uri: 'reopened-timing.nc' });
	const old = { timingProfile: 'Measured', rapidRate: 1, toolChangeSeconds: 99, extraStationSeconds: 99,
		analysisMode: 'asWritten', showTraceLine: true, live: false, groupLabels: true };
	await context.workspaceState.update('kaijuChronoblade.settingsByDocument', { 'reopened-timing.nc': old, 'other.nc': { live: true } });
	for (const key of ['rapidRate', 'toolChangeSeconds', 'extraStationSeconds']) configurationValues.set(`kaijuNC.chronoblade.${key}`, 999);
	configurationValues.set('kaijuNC.chronoblade.timingProfiles', [{ name: 'Measured', rapidRate: 1, customTimes: { M5: 99 } }]);
	// Unassigned programs use Generic Machine's timing too.
	assert.equal(report.options(document).rapidRate, machine.GENERIC_MACHINE_PROFILE.rapidRate);
	assert.deepEqual(report.options(document).customEventTimes, {});
	await machine.saveMachineProfiles(document, [profile('shop', { rapidRate: 3000, toolChangeSeconds: 0, extraStationSeconds: 0, customTimes: { M5: 2 } })]);
	await machine.setDefaultMachineProfile(document, 'shop');
	const reopened = makeDocument(document.lineAt(0).text, { uri: document.uri.toString() });
	const options = report.options(reopened, old);
	assert.equal(options.rapidRate, 3000);
	assert.equal(options.toolChangeSeconds, 0);
	assert.equal(options.extraStationSeconds, 0);
	assert.deepEqual(options.customEventTimes, { M5: 2 });
	assert.equal(options.analysisMode, 'asWritten');
	assert.equal(options.groupLabels, true);
	await report.save(reopened, old);
	const saved = context.workspaceState.get('kaijuChronoblade.settingsByDocument');
	assert.deepEqual(saved['reopened-timing.nc'], { analysisMode: 'asWritten', showTraceLine: true, live: false, groupLabels: true });
	assert.deepEqual(saved['other.nc'], { live: true });
	const manifest = require('../package.json');
	for (const key of ['rapidRate', 'toolChangeSeconds', 'extraStationSeconds', 'timingProfiles']) {
		assert.ok(!manifest.contributes.configuration.some(section => Object.hasOwn(section.properties, `kaijuNC.chronoblade.${key}`)));
	}
});

test('machine edits and switches refresh report timing; Edit opens the source machine when another file is active', async () => {
	const { report } = setup();
	const source = makeDocument('G0 X0\nG0 X100\nM5', { uri: 'source-timing.nc' });
	const other = makeDocument('G0 X1', { uri: 'other-timing.nc' });
	await machine.saveMachineProfiles(source, [profile('first', { rapidRate: 1000 }), profile('second', { rapidRate: 2000 })]);
	await machine.setMachineProfile(source, 'first');
	let receive;
	const commands = [];
	const panel = { webview: { onDidReceiveMessage(handler) { receive = handler; }, html: '' }, onDidDispose() {}, reveal() {} };
	vscode.ViewColumn = { Beside: 2 };
	vscode.window.createWebviewPanel = () => panel;
	vscode.commands = { async executeCommand(...args) { commands.push(args); } };
	const editor = { document: source, selection: { isEmpty: true } };
	vscode.window.activeTextEditor = editor;
	vscode.window.visibleTextEditors = [editor];
	vscode.workspace.textDocuments = [source, other];
	await report.show(editor, 'whole', getChronobladeOptions(source, { analysisMode: 'asWritten' }));
	await report.save(source, { analysisMode: 'asWritten', groupLabels: true });
	await machine.saveMachineProfiles(source, [profile('first', { rapidRate: 4000, customTimes: { M5: 3 } }), profile('second', { rapidRate: 2000 })]);
	await report.refresh(source);
	assert.equal(report.state().options.rapidRate, 4000);
	assert.deepEqual(report.state().options.customEventTimes, { M5: 3 });
	assert.equal(report.state().options.groupLabels, true);
	assert.match(panel.webview.html, /<output[^>]*>4000<\/output>/);
	await machine.setMachineProfile(source, 'second');
	await report.refresh(source);
	assert.equal(report.state().options.rapidRate, 2000);
	assert.deepEqual(report.state().options.customEventTimes, {});
	vscode.window.activeTextEditor = { document: other };
	vscode.window.visibleTextEditors = [];
	await receive({ type: 'editMachineTiming' });
	assert.deepEqual(commands.at(-1), ['kaijuNC.machineProfiles.manage', { document: source, tab: 'timing' }]);
});
