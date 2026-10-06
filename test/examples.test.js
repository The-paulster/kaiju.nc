const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeDocument, configurationValues } = require('./helpers');
const machine = require('../src/MetaMachineMode');
const { updateDiagnostics } = require('../src/kaijuAlert/diagnostics');
const { formatDocumentText, getFormattingOptions } = require('../src/kaijuReconstructor/formatter');
const contracts = require('./example-contracts');
const { loadRenderer, scriptsIn, runVision } = require('./example-webview-harness');
const renderVision = loadRenderer('src/kaijuVision/webview.js', 'renderVisionHtml');
const renderChronoblade = loadRenderer('src/kaijuChronoblade/webview.js', 'renderChronobladeHtml');

test.beforeEach(() => {
  configurationValues.clear();
  const stored = new Map();
  machine.initializeMachineMode({ workspaceState: { get: (key, fallback) => stored.get(key) ?? fallback, update: async (key, value) => stored.set(key, value) } });
});

function documentFor(item) {
  return makeDocument(fs.readFileSync(path.join(contracts.examplesDirectory, item.file), 'utf8'), { uri: item.file });
}
function diagnosticsFor(document) {
  let diagnostics;
  updateDiagnostics(document, { set(_uri, values) { diagnostics = values; }, delete() {} });
  return diagnostics;
}

test('Every shipped example program has explicit reviewed expectations', contracts.assertInventory);

for (const item of contracts.cases) {
  test(`${item.file}: expected alerts, execution, geometry and emitted reports`, async () => {
    const document = documentFor(item);
    await contracts.configureExample(document, item);
    contracts.assertDiagnostics(document, item, diagnosticsFor(document));
    const { trace, vision, chronoblade, options } = contracts.analyzeExample(document, item);
    const html = renderVision(document, 'whole', { ...options, renderer: 'canvas' }, vision);
    const ordinary = runVision(html);
    assert.equal(ordinary.data.rows.filter(row => row.type === 'motion').length, item.motions);
    const page = runVision(renderVision(document, 'whole', { ...options, renderer: 'canvas', playbackAutoStart: true }, { ...vision, executionTrace: trace }));
    scriptsIn(renderChronoblade({ ...require('../src/kaijuChronoblade/options').getChronobladeOptions(document), timingProfiles: [] }, chronoblade));
    const motions = vision.rows.filter(row => row.type === 'motion');
    // First, middle, last, then a reverse seek: compare displayed playback
    // positions with the reviewed analysis that actually entered the webview.
    for (const row of [motions[0], motions[Math.floor(motions.length / 2)], motions.at(-1), motions[0]]) {
      page.context.setPlaybackCursor(row.executionIndex); page.flush();
      const position = vm.runInContext('getCurrentPlaybackPosition(getProjectedPlaneData(getPrimaryPlaneKey(), planes[getPrimaryPlaneKey()]))', page.context);
      for (const axis of ['x', 'y', 'z', 'c']) if (Number.isFinite(row.end[axis])) assert.equal(position[axis], row.end[axis]);
      assert.match(page.get('playbackPosition').textContent, new RegExp(`Event ${row.executionIndex + 1} /`));
      assert.ok(page.get('playbackPositionReadout').innerHTML.length > 0);
    }
    page.assertDrawn();
    page.get('dualViewToggle').listeners.click(); page.flush();
    assert.equal(page.get('secondaryViewer').hidden, true);
  });
}

test('Applying the documented diagnostic-example fixes clears all five alerts and both orphan findings', async () => {
  const item = contracts.cases[1];
  const original = documentFor(item);
  const text = Array.from({ length: original.lineCount }, (_, line) => original.lineAt(line).text).join('\n')
    .replace('#190 = 9.000 (INTENTIONALLY UNUSED)', '#199 = -10.000')
    .replace('N100 (INTENTIONALLY DUPLICATED - CHANGE TO N200)', 'N200')
    .replace('N90 (INTENTIONALLY OUT OF ORDER - CHANGE TO N300)', 'N300')
    .replace('GOTO999', 'GOTO900').replace('R5.000 F150.000', 'R10.000 F150.000').replace(/^END2\r?\n/m, '');
  const repaired = makeDocument(text, { uri: 'repaired-diagnostics.nc' });
  await contracts.configureExample(repaired, item);
  assert.deepEqual(diagnosticsFor(repaired), []);
  const trace = require('../src/MetaExecutionTrace').buildExecutionTrace(repaired, { includeExecutionEntries: true });
  assert.equal(trace.status, 'ready'); assert.deepEqual(trace.problems, []);
  const orphan = require('../src/kaijuOrphanKiller').inspectOrphanMacros(repaired);
  assert.deepEqual(orphan.undefinedUses, []); assert.deepEqual(orphan.unusedDefinitions, []);
});

test('Reconstructor example formats as taught and clears its missing-decimal alert', async () => {
  const item = contracts.cases[0], document = documentFor(item);
  await contracts.configureExample(document, item);
  const source = fs.readFileSync(path.join(contracts.examplesDirectory, item.file), 'utf8');
  const formatted = formatDocumentText(source, getFormattingOptions(document, { decimalPlaces: 3, addMissingDecimal: true, normalizeToolCodes: true, autoSemicolon: false }));
  assert.match(formatted, /G01 X0\.000 Z-20\.000 F0\.180/);
  assert.match(formatted, /^T09$/m); assert.match(formatted, /^T0606$/m);
  const repaired = makeDocument(formatted, { uri: item.file });
  assert.deepEqual(diagnosticsFor(repaired), []);
});
