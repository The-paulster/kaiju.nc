const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { makeDocument, configurationValues, vscode } = require('./helpers');
const machine = require('../src/MetaMachineMode');
const viewer = require('../src/kaijuFileSettings');
const manifest = require('../package.json');

function owner(relativePath, variable) {
	const filename = path.resolve(__dirname, '..', relativePath);
	const loaded = new Module(filename, module);
	loaded.filename = filename;
	loaded.paths = Module._nodeModulePaths(path.dirname(filename));
	loaded._compile(fs.readFileSync(filename, 'utf8') + `\n${variable} = global.__fileSettingsContext;`, filename);
	return loaded.exports;
}

test('configuration inventory preserves resource/language layers and false/zero values', () => {
	const original = vscode.workspace.getConfiguration;
	const document = makeDocument('G0 X0');
	vscode.workspace.getConfiguration = (section, scope) => {
		assert.equal(section, undefined);
		assert.equal(scope, document);
		return {
			get: (key, fallback) => key === 'kaijuNC.sense.enabled' ? false : key === 'kaijuNC.format.decimalPlaces' ? 0 : fallback,
			inspect: key => key === 'kaijuNC.sense.enabled' ? { defaultValue: true, workspaceValue: true, globalLanguageValue: false } : undefined
		};
	};
	try {
		const rows = viewer.collectConfiguration(document);
		const keys = Object.keys(Object.assign({}, ...[].concat(manifest.contributes.configuration).map(section => section.properties))).filter(key => key.startsWith('kaijuNC.'));
		assert.equal(rows.length, keys.length);
		assert.equal(new Set(rows.map(row => row.key)).size, keys.length);
		const enabled = rows.find(row => row.key === 'kaijuNC.sense.enabled');
		assert.equal(enabled.value, false);
		assert.equal(enabled.source, 'User language override');
		assert.deepEqual(enabled.layers.map(layer => layer.value), [true, true, false]);
		assert.equal(rows.find(row => row.key === 'kaijuNC.format.decimalPlaces').value, 0);
	} finally { vscode.workspace.getConfiguration = original; }
});

test('owner snapshots preserve saved program choices and share machine overrides without writes', async () => {
	configurationValues.clear();
	const stored = new Map(); let writes = 0;
	const context = { subscriptions: [], workspaceState: {
		get: (key, fallback) => stored.get(key) ?? fallback,
		update: async (key, value) => { writes++; stored.set(key, value); }
	} };
	machine.initializeMachineMode(context);
	const document = makeDocument('G0 X0', { uri: 'first.nc' });
	await machine.setMachineProfile(document, 'generic');
	await machine.saveDocumentWorkOffsets(document, { G54: { x: 0, c: 90 } });
	stored.set('kaijuChronoblade.settingsByDocument', { 'first.nc': { analysisMode: 'asWritten', groupLabels: true, live: false } });
	stored.set('kaijuVision.settingsByDocument', { 'first.nc': { showLabels: false, plane: 'zx', gridSize: 0 } });
	stored.set('kaijuVision.referenceFramesByDocument', { 'first.nc': 'G55' });
	stored.set('kaijuVision.macroInputsByDocument', { 'first.nc': { '#100': { value: 0, override: false }, '#101': { value: 2, override: true } } });
	stored.set('kaijuOrphanKiller.settingsByDocument', { 'first.nc': { live: false } });
	global.__fileSettingsContext = context;
	try {
		const before = writes;
		const chrono = owner('src/kaijuChronoblade/webview.js', 'chronobladeContext').getChronobladeSettingsSnapshot(document);
		const vision = owner('src/kaijuVision/webview.js', 'visionContext').getVisionSettingsSnapshot(document);
		const orphan = owner('src/kaijuOrphanKiller/index.js', 'orphanContext').getOrphanSettingsSnapshot(document);
		assert.equal(chrono.effective.analysisMode, 'asWritten');
		assert.equal(chrono.effective.live, false);
		assert.equal(chrono.effective.groupLabels, true);
		assert.equal(vision.effective.showLabels, false);
		assert.equal(vision.effective.referenceFrame, 'G55');
		assert.equal(vision.effective.workOffsets.G54.c, 90);
		assert.deepEqual(vision.macroInputs, { initialValues: { '#100': 0 }, overrides: { '#101': 2 } });
		assert.equal(orphan.effective.live, false);
		assert.equal(machine.getDocumentMachineSettings(document).workOffsets.G54.x, 0);
		assert.equal(writes, before);
		const other = makeDocument('G0 X0', { uri: 'other.nc' });
		assert.deepEqual(machine.getDocumentMachineSettings(other).selection, {});
	} finally { delete global.__fileSettingsContext; }
});

test('panel escapes arbitrary values, compiles its emitted script and exposes overrides', () => {
	const snapshot = { file: '</script><img src=x onerror=alert(1)>', version: 1, capturedAt: 'now',
		machine: { machineModeSource: 'inferred', profile: { id: 'mill' }, motionOptions: { workOffsets: { G54: { x: 0 } } } },
		program: { selection: {}, workOffsets: { G54: { x: 0 } } },
		features: { Vision: { saved: { showLabels: false }, effective: { showLabels: false } } },
		configuration: [{ key: 'kaijuNC.test', value: '</script>', source: 'User', layers: [{ source: 'Default', value: true }, { source: 'User', value: '</script>' }] }] };
	const html = viewer.renderFileSettingsHtml(snapshot);
	assert.ok(!html.includes('<img'));
	assert.match(html, /&lt;\/script&gt;/);
	const start = html.indexOf('>', html.indexOf('<script')) + 1;
	const end = html.indexOf('</script>', start);
	new Function(html.slice(start, end));
	const rows = viewer.snapshotRows(snapshot);
	assert.equal(rows.find(row => row.key === 'motionOptions.workOffsets.G54.x').source, 'Saved program offsets');
	assert.match(rows.find(row => row.key === 'showLabels').source, /Saved program choice/);
	assert.match(html, /Configuration layers/);
	const menu = manifest.contributes.menus['editor/context'];
	assert.equal(menu.find(item => item.command === 'kaijuNC.fileSettings').group, 'z_kaijuGCodeDialect@3');
});

test('Refresh and Copy JSON remain bound to the inspected file after changing editors', async () => {
	const first = makeDocument('G0 X0', { uri: 'first.nc' });
	const other = makeDocument('G0 X0', { uri: 'other.nc' });
	let command, receive, copied, panelCount = 0;
	const original = { window: vscode.window, commands: vscode.commands, env: vscode.env, viewColumn: vscode.ViewColumn, textDocuments: vscode.workspace.textDocuments };
	const panel = { webview: { html: '', onDidReceiveMessage: fn => { receive = fn; return { dispose() {} }; }, postMessage: async () => {} },
		onDidDispose: () => ({ dispose() {} }), reveal() {}, dispose() {} };
	vscode.window = { activeTextEditor: { document: first }, createWebviewPanel: () => { panelCount++; return panel; }, showErrorMessage: message => { throw Error(message); } };
	vscode.commands = { registerCommand: (id, fn) => { command = fn; return { dispose() {} }; } };
	vscode.env = { clipboard: { writeText: async text => { copied = JSON.parse(text); } } };
	vscode.ViewColumn = { Beside: 2 };
	vscode.workspace.textDocuments = [first, other];
	try {
		viewer.registerFileSettings({ subscriptions: [] });
		await command();
		vscode.window.activeTextEditor = { document: other };
		first.version = 2;
		await receive({ type: 'refresh' });
		await receive({ type: 'copy' });
		assert.equal(copied.file, 'first.nc');
		assert.equal(copied.version, 2);
		assert.ok(copied.configuration.length > 0);
		vscode.window.activeTextEditor = { document: first };
		await command();
		assert.equal(panelCount, 1);
	} finally {
		Object.assign(vscode, { window: original.window, commands: original.commands, env: original.env, ViewColumn: original.viewColumn });
		vscode.workspace.textDocuments = original.textDocuments;
	}
});
