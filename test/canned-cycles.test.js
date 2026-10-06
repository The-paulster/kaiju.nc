const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument } = require('./helpers');
const cycles = require('../src/MetaCannedCycles');
const dialect = require('../src/MetaGCodeDialect');
const motion = require('../src/MetaMotionEngine');
const { buildExecutionTrace } = require('../src/MetaExecutionTrace');
const Module = require('node:module');
const vm = require('node:vm');
const drilling = 'cycle.mill.fanuc.drilling';
const options = { machineMode: 'mill', xAxisMode: 'radius', defaultFeedMode: 'perMinute', rapidRate: 600, gCodeDialectId: 'fanucIso' };
const program = 'G17 G90 G94\nG0 X0 Y0 Z10\nG99 G81 X10 Y0 Z-10 R2 F100\nX20\nG98 X30\nG80\nG1 Z0 F100';

test('cycle catalog has distinct mill/lathe entries and packaged Codex pages', () => {
	assert.equal(cycles.getCannedCycles('mill').length, 12);
	assert.equal(cycles.getCannedCycles('lathe').length, 7);
	for (const entry of cycles.CANNED_CYCLES) {
		const filename = path.join(__dirname, '..', 'codex', 'canned-cycles', entry.mode, entry.id.split('.').at(-1) + '.md');
		assert.ok(fs.existsSync(filename), filename);
		assert.ok(fs.readFileSync(filename, 'utf8').includes(`G${entry.commonCode}`));
	}
	assert.notEqual(cycles.getCannedCycles('mill').find(e => e.commonCode === 76).id, cycles.getCannedCycles('lathe').find(e => e.commonCode === 76).id);
});

test('FANUC defaults bind every runtime mill entry; reference lathe entries are unavailable', () => {
	const profile = dialect.getGCodeDialectProfile('fanucIso');
	for (const entry of cycles.getCannedCycles('mill')) assert.equal(profile.bindings.mill[entry.id].code, entry.commonCode);
	for (const entry of cycles.getCannedCycles('lathe')) assert.equal(profile.bindings.lathe[entry.id], undefined);
	assert.throws(() => dialect.normalizeCustomGCodeDialectProfiles([{ id: 'wrong-mode', label: 'Wrong mode', bindings: { mill: {}, lathe: { [drilling]: { code: 81 } } } }]), /requires mill mode/);
});

test('G81 expands shared geometry and time with modal holes, G99 and G98', () => {
	const doc = makeDocument(program);
	const vision = motion.analyzeVisionRange(doc, undefined, options);
	const chrono = motion.analyzeChronobladeRange(doc, undefined, options);
	const visionRows = vision.rows.filter(row => row.cycleId === drilling);
	const chronoRows = chrono.rows.filter(row => row.cycleId === drilling);
	assert.equal(visionRows.length, 10);
	assert.equal(chronoRows.length, 10);
	assert.deepEqual(visionRows.filter(row => row.lineNumber === 3).map(row => row.end), [
		{ x: 10, y: 0, z: 10 }, { x: 10, y: 0, z: 2 }, { x: 10, y: 0, z: -10 }, { x: 10, y: 0, z: 2 }
	]);
	assert.equal(visionRows.at(-1).end.z, 10);
	assert.equal(chrono.summary.unknownTimeRows, 0);
	const feed = chronoRows.filter(row => row.instruction === 'G1');
	assert.equal(feed.length, 3);
	assert.ok(Math.abs(feed.reduce((sum, row) => sum + row.timeSeconds, 0) - 21.6) < 1e-9);
	assert.equal(vision.rows.at(-1).start.z, 10);
});

test('G81 repeated explicit invocation retains its initial plane and modal depth', () => {
	const doc = makeDocument('G0 X0 Y0 Z10\nG99 G81 Z-10 R2 F100\nG98 G81 X10');
	const rows = motion.analyzeVisionRange(doc, undefined, options).rows;
	assert.equal(rows.at(-1).end.z, 10);
	assert.equal(rows.filter(row => row.cycleId === drilling && row.instruction === 'G1').length, 2);
});

test('cycle rebindings, explicit unbinding and existing-word collisions affect analysis and Sense', () => {
	try {
		dialect.setCustomGCodeDialectProfiles([{ id: 'cycle-test', label: 'Cycle test', bindings: { mill: { ...dialect.getGCodeDialectProfile("fanucIso").bindings.mill, [drilling]: { code: 181 } }, lathe: {} } }]);
		const custom = { ...options, gCodeDialectId: 'cycle-test' };
		const doc = makeDocument(program.replace('G81', 'G181'));
		assert.equal(motion.analyzeChronobladeRange(doc, undefined, custom).rows.filter(row => row.cycleInstruction === 'G181').length, 10);
		assert.equal(motion.getModalStateAtLine(doc, 2, custom).modalGroups.find(e => e.key === 'motion').code, 'G181');
		assert.equal(motion.analyzeVisionRange(makeDocument(program), undefined, custom).rows.some(row => row.cycleId), false);
		dialect.setCustomGCodeDialectProfiles([{ id: 'cycle-test', label: 'Cycle test', bindings: { mill: { [drilling]: null }, lathe: {} } }]);
		assert.equal(dialect.resolveGCodeOperations([{ letter: 'G', value: 81 }], custom).length, 0);
		dialect.setCustomGCodeDialectProfiles([{ id: 'cycle-test', label: 'Cycle test', bindings: { mill: { 'motion.linear': { code: 81 } }, lathe: {} } }]);
		assert.equal(dialect.getGCodeDialectProfile('cycle-test').bindings.mill[drilling], null);
	} finally { dialect.setCustomGCodeDialectProfiles([]); }
});

test('profile replacement invalidates resolution for the same parsed word array', () => {
	const words = [{ letter: 'G', value: 181 }];
	const custom = { ...options, gCodeDialectId: 'cycle-test' };
	try {
		for (const code of [181, 182]) {
			dialect.setCustomGCodeDialectProfiles([{ id: 'cycle-test', label: 'Cycle test', bindings: { mill: { [drilling]: { code } }, lathe: {} } }]);
			assert.equal(dialect.resolveGCodeOperations(words, custom).length, code === 181 ? 1 : 0);
		}
	} finally { dialect.setCustomGCodeDialectProfiles([]); }
});

test('G0 cancels active drilling and lathe G73/G74/G76 never use mill depth markers', () => {
	const doc = makeDocument('G0 X0 Y0 Z10\nG81 Z-10 R2 F100\nG0 X20\nX30');
	assert.equal(motion.analyzeVisionRange(doc, undefined, options).rows.filter(row => row.cycleId).length, 3);
	for (const code of [73, 74, 76]) {
		const result = motion.analyzeVisionRange(makeDocument(`G0 X20 Y0 Z10\nG${code} X10 Z-10 R2`), undefined, { ...options, machineMode: 'lathe' });
		assert.equal(result.rows.some(row => row.type === 'cycle'), false);
	}
});

test('partial cycles produce an explicit unknown-time report and a depth marker', () => {
	const doc = makeDocument('G0 X0 Y0 Z10\nG83 Z-10 R2 Q2 F100');
	const chrono = motion.analyzeChronobladeRange(doc, undefined, options);
	assert.equal(chrono.summary.unknownTimeRows, 1);
	assert.match(chrono.rows.at(-1).warnings[0], /not implemented/);
	assert.equal(motion.analyzeVisionRange(doc, undefined, options).rows.at(-1).type, 'cycle');
});

test('unsupported G81 plane, repetition and unresolved words never produce estimated cutting time', () => {
	for (const line of ['G18 G81 Z-10 R2 F100', 'G81 Z-10 R2 F100 K2', 'G81 Z-10 R2 F#999', 'G81 Z-10 R#999 F100']) {
		const chrono = motion.analyzeChronobladeRange(makeDocument(`G0 X0 Y0 Z10\n${line}`), undefined, options);
		assert.equal(chrono.summary.unknownTimeRows, 1, line);
		assert.equal(chrono.rows.some(row => row.cycleId), false, line);
	}
});

test('work-frame changes require cancel/restart, including explicit cycle commands', () => {
	for (const block of ['G55 X10', 'G55 G81 X10']) {
		const doc = makeDocument(`G0 X0 Y0 Z10\nG81 Z-10 R2 F100\n${block}`);
		const rows = motion.analyzeChronobladeRange(doc, undefined, options).rows;
		assert.match(rows.at(-1).warnings[0], /Cancel and restart/);
	}
	const doc = makeDocument('G0 X0 Y0 Z10\nG81 Z-10 R2 F100\nG80\nG55 G81 X10 Z-10 R2');
	assert.equal(motion.analyzeChronobladeRange(doc, undefined, options).summary.unknownTimeRows, 0);
});

test('Trace occurrences expand holes with resolved macros and preserve source linkage', () => {
	const doc = makeDocument('#100=0\nG17 G90 G94\nG0 X0 Y0 Z10\nWHILE [#100 LT 2] DO1\nG81 X[#100*10] Z-10 R2 F100\n#100=#100+1\nEND1\nG80');
	const trace = buildExecutionTrace(doc, { includeExecutionEntries: true });
	const rows = motion.analyzeVisionRange(doc, undefined, { ...options, executionTrace: trace }).rows.filter(row => row.cycleId === drilling);
	assert.equal(rows.filter(row => row.instruction === 'G1').length, 2);
	assert.equal(new Set(rows.map(row => row.executionIndex)).size, 2);
	assert.ok(rows.every(row => row.lineNumber === 5));
});

test('binding editor renders both lists and opens cycle Codex without saving a profile', () => {
	const filename = path.resolve(__dirname, '../src/kaijuMachineMode/profileEditor.js');
	const loaded = new Module(filename, module);
	loaded.filename = filename;
	loaded.paths = Module._nodeModulePaths(path.dirname(filename));
	loaded._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.render = renderGCodeProfilesHtml;', filename);
	const profile = { ...dialect.getGCodeDialectProfile('fanucIso'), builtIn: true };
	const html = loaded.exports.render([profile], 'fanucIso');
	const start = html.indexOf('<script nonce=', html.indexOf('</script>') + 9);
	const script = html.slice(html.indexOf('>', start) + 1, html.indexOf('</script>', start));
	const initial = html.slice(html.indexOf('>', html.lastIndexOf('<script', html.indexOf('id="profileData"'))) + 1, html.indexOf('</script>'));
	const nodes = new Map();
	function node(id) {
		if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', dataset: {}, classList: { toggle() {} }, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
		return nodes.get(id);
	}
	node('profileData').textContent = initial;
	const tabs = [node('mill-tab'), node('lathe-tab')];
	const cycleTabs = [node('mill-cycle-tab'), node('lathe-cycle-tab')];
	for (const group of [tabs, cycleTabs]) { group[0].dataset.mode = 'mill'; group[1].dataset.mode = 'lathe'; }
	const messages = [];
	vm.runInNewContext(script, {
		document: { getElementById: node, querySelectorAll: selector => selector === ".cycle-mode-tab" ? cycleTabs : tabs },
		window: { addEventListener() {} }, acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) })
	});
	assert.match(html, /<h2>Canned cycles<\/h2>/);
	assert.match(html, /class="cycle-mode-tab[\s\S]*?<a id="cycleCodex" class="codex-link" href="#">Canned cycles<\/a>/);
	assert.doesNotMatch(html, /<button[^>]*id="cycleCodex"|Canned cycle Codex/);
	assert.doesNotMatch(node('bindingsBody').innerHTML, /data-operation="cycle\./);
	assert.match(node('bindingsBody').innerHTML, /data-operation="coordinate.work1" value="G54"/);
	assert.match(node('bindingsBody').innerHTML, /data-operation="coordinate.work6" value="G59"/);
	assert.match(node('cyclesBody').innerHTML, /data-operation="cycle.mill.fanuc.drilling" value="G81"/);
	tabs[1].handlers.click();
	assert.match(node('cyclesBody').innerHTML, /data-operation="cycle.mill.fanuc.drilling"/);
	cycleTabs[1].handlers.click();
	assert.match(node('cyclesBody').innerHTML, /Common G76/);
	assert.match(node('cyclesBody').innerHTML, /Unavailable/);
	assert.doesNotMatch(node('cyclesBody').innerHTML, /data-operation="cycle.mill/);
	node('cycleCodex').handlers.click({ preventDefault() {} });
	node('cyclesBody').handlers.click({ preventDefault() {}, target: { closest: () => ({ dataset: { cycleCodex: 'cycle.lathe.fanuc.threadingTwoBlock' } }) } });
	assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
		{ type: 'openCycleCodex', topic: 'cannedCycles' },
		{ type: 'openCycleCodex', topic: 'cycle.lathe.fanuc.threadingTwoBlock' }
	]);
	// Editing a mill cycle while general bindings show lathe must save to mill.
	node('duplicateProfile').handlers.click();
	cycleTabs[0].handlers.click();
	node('cyclesBody').handlers.change({ target: { closest: () => ({ dataset: { operation: drilling }, value: 'G181' }) } });
	node('saveProfile').handlers.click();
	assert.equal(messages[2].profiles[0].bindings.mill[drilling].code, 181);
	assert.equal(messages[2].profiles[0].bindings.lathe[drilling], null);
});
