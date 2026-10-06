// Reviewed expectations from the examples' authored programs and teaching notes.
// Shared by Node regression tests and the real VS Code Extension Host suite.
// Do not import helpers.js here: the host suite must use the real VS Code API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const machine = require('../src/MetaMachineMode');
const { buildExecutionTrace } = require('../src/MetaExecutionTrace');
const { analyzeVisionRange, analyzeChronobladeRange } = require('../src/MetaMotionEngine');
const { getVisionOptions } = require('../src/kaijuVision/options');
const { getChronobladeOptions } = require('../src/kaijuChronoblade/options');
const { inspectOrphanMacros } = require('../src/kaijuOrphanKiller');

const examplesDirectory = path.resolve(__dirname, '../examples');
const cases = [
  { file: '01-reconstructor.nc', mode: 'latheDiameter', motions: 8, tools: ['T606'],
    alerts: [{ line: 'g1x[40-[#100*2]]z-10f.2', token: 'z-10', severity: 1, message: /missing a decimal point/ }] },
  { file: '02-diagnostics-and-orphan-killer.nc', mode: 'latheDiameter', motions: 6, tools: [],
    alerts: [
      { line: 'IF [#100 LT 0.000] GOTO999', token: '999', message: /has no matching N label/ },
      { line: 'END2', token: 'END2', message: /has no matching WHILE DO2/ },
      { line: 'N100 (INTENTIONALLY DUPLICATED - CHANGE TO N200)', token: 'N100', message: /Duplicate sequence number/ },
      { line: 'N90 (INTENTIONALLY OUT OF ORDER - CHANGE TO N300)', token: 'N90', message: /out of order/ },
      { line: 'G02 X20.000 Z20.000 R5.000 F150.000', token: 'G02', message: /Illegal arc:.*chord 20.*diameter 10/ }
    ], undefinedMacros: ['#199'], unusedMacros: ['#190'], structuralProblem: /END2 has no active WHILE DO2/ },
  // A grammar gallery, not one controller-valid machining process.
  { file: '03-syntax-gallery.nc', mode: 'mill', motions: 8, tools: ['T0101'], alerts: [],
    unusedMacros: ['#110', '#111', '#112', '#113'] },
  { file: '04-vision-and-chronoblade.nc', mode: 'mill', motions: 36, tools: ['T01', 'T02'], alerts: [] },
  { file: '05-c-axis-and-polar.nc', mode: 'latheDiameter', motions: 22, tools: ['T0101'], alerts: [] },
  { file: '06-macros-sense-hunter-and-alias.nc', mode: 'mill', motions: 15, tools: ['T1'], alerts: [] },
  { file: '07-showcase.nc', mode: 'mill', motions: 57, tools: ['T01', 'T02', 'T03'], alerts: [] }
];

function assertInventory() {
  assert.deepEqual(fs.readdirSync(examplesDirectory).filter(file => /\.nc$/i.test(file)).sort(),
    cases.map(item => item.file).sort(), 'Every example program needs reviewed expectations');
}

function sourceLine(document, text) {
  const found = [];
  for (let line = 0; line < document.lineCount; line++) {
    if (document.lineAt(line).text.trim() === text) found.push(line);
  }
  assert.equal(found.length, 1, `Expected one authored line: ${text}`);
  return found[0];
}

async function configureExample(document, item) {
  await machine.setMachineMode(document, item.mode);
  await machine.setGCodeDialect(document, 'fanucIso');
}

function assertDiagnostics(document, item, diagnostics) {
  assert.equal(diagnostics.length, item.alerts.length, `${item.file}: unexpected/missing diagnostics`);
  for (const expected of item.alerts) {
    const line = sourceLine(document, expected.line);
    const found = diagnostics.filter(diagnostic => diagnostic.range.start.line === line
      && expected.message.test(diagnostic.message));
    assert.equal(found.length, 1, `${item.file}: missing alert on ${expected.line}`);
    const diagnostic = found[0];
    assert.equal(diagnostic.source, 'Kaiju Alert');
    assert.equal(diagnostic.severity, expected.severity ?? 0, 'Expected diagnostic severity');
    assert.equal(diagnostic.range.end.line, line);
    assert.equal(document.lineAt(line).text.slice(diagnostic.range.start.character, diagnostic.range.end.character), expected.token);
  }
}

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function analyzeExample(document, item) {
  const trace = buildExecutionTrace(document, { includeExecutionEntries: true, includePlaybackData: true, includeDecompositionData: true });
  // 'ready' does not imply an absence of structural problems: inspect both.
  assert.equal(trace.status, 'ready', item.file);
  assert.deepEqual([...trace.assumptions.keys()], [], 'Examples must not silently invent macro inputs');
  if (item.structuralProblem) {
    assert.equal(trace.problems.length, 1);
    assert.match(trace.problems[0].message, item.structuralProblem);
  } else assert.deepEqual(trace.problems, [], item.file);
  const options = getVisionOptions(document);
  const vision = analyzeVisionRange(document, undefined, { ...options, executionTrace: trace });
  const chronoblade = analyzeChronobladeRange(document, undefined, { ...getChronobladeOptions(document), executionTrace: trace });
  const orphan = inspectOrphanMacros(document);
  assert.deepEqual(orphan.undefinedUses.map(entry => entry.macro).sort(), (item.undefinedMacros || []).slice().sort());
  assert.deepEqual(orphan.unusedDefinitions.map(entry => entry.macro).sort(), (item.unusedMacros || []).slice().sort());
  const motions = vision.rows.filter(row => row.type === 'motion');
  assert.equal(motions.length, item.motions, `${item.file}: motion occurrences`);
  assert.deepEqual([...new Set(motions.map(row => row.tool).filter(Boolean))], item.tools, `${item.file}: tool identity/order`);
  for (const row of motions) {
    assert.ok(row.lineNumber >= 1 && row.lineNumber <= document.lineCount, 'Valid source link');
    assert.ok(Number.isInteger(row.executionIndex), 'Valid execution link');
    for (const point of row.points) {
      for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(point[axis]), `${item.file}: finite ${axis}`);
    }
  }
  const at = text => motions.filter(row => row.lineNumber === sourceLine(document, text) + 1);
  const entriesAt = text => trace.executionEntries.filter(entry => entry.lineNumber === sourceLine(document, text));

  if (item.file.startsWith('04')) {
    assert.deepEqual(at('G01 Z[-#100 * #102] F100.000').map(row => row.end.z), [-1, -2, -3]);
    const corners = [
      ['G03 X60.000 Y5.000 I0.000 J5.000', 55, 5],
      ['G03 X55.000 Y40.000 I-5.000 J0.000', 55, 35],
      ['G03 X0.000 Y35.000 I0.000 J-5.000', 5, 35],
      ['G03 X5.000 Y0.000 I5.000 J0.000', 5, 5]
    ];
    for (const [text, x, y] of corners) {
      const rows = at(text);
      assert.deepEqual(rows.map(row => row.end.z), [-1, -2, -3]);
      for (const row of rows) {
        assert.ok(row.points.length > 2);
        for (const point of row.points) close(Math.hypot(point.x - x, point.y - y), 5);
        close(row.distance, Math.PI * 5 / 2, 0.01);
      }
    }
    for (const text of ['G03 X22.000 Y20.000 I-8.000 J0.000 F200.000', 'G03 X38.000 Y20.000 I8.000 J0.000']) {
      for (const point of at(text)[0].points) close(Math.hypot(point.x - 30, point.y - 20), 8);
    }
    close(chronoblade.summary.dwellTimeSeconds, 1);
    // Three (160 mm straights + four R5 quarters), then two R8 semicircles.
    // Plunges are 11 + 1 + 1 + 11 mm. Allow sampled-arc chord error.
    close(chronoblade.summary.cuttingDistance, 3 * (160 + 10 * Math.PI) + 16 * Math.PI + 24, 0.04);
    assert.equal(chronoblade.summary.unknownTimeRows, 0);
  }
  if (item.file.startsWith('05')) {
    const quarter = motions.find(row => document.lineAt(row.lineNumber - 1).text.trim() === 'G01 C90.000 F200.000');
    close(quarter.points.at(-1).x, 0);
    close(quarter.points.at(-1).y, 20);
    close(quarter.distance, 10 * Math.PI, 0.01);
    const turns = at('G01 C720.000')[0];
    close(turns.distance, 80 * Math.PI, 0.03);
    close(turns.end.c, 0);
    const polar = at('G01 X40.000 C10.000 F200.000')[0];
    close(polar.points.at(-1).x, 20); close(polar.points.at(-1).y, 10);
    assert.equal(polar.points.length, 2, 'Polar C is linear face motion');
    const retained = at('G01 X60.000')[0];
    close(retained.end.c, 90); close(retained.points.at(-1).x, 0); close(retained.points.at(-1).y, 30);
    // The example promises unknown rotary timing. Its G94 is not a FANUC
    // lathe feed-mode binding (G98 is); do not bless a numeric timing snapshot.
    assert.ok(Number.isNaN(quarter.timeSeconds));
  }
  if (item.file.startsWith('06')) {
    const rows = at('G01 X#120 Z#121 F#103');
    assert.equal(rows.length, 12);
    rows.forEach((row, i) => { close(row.end.x, (i + 1) * 5); close(row.end.z, -(i + 1) * 0.25); });
    const entries = entriesAt('G01 X#120 Z#121 F#103');
    for (const i of [0, 5, 11]) {
      close(entriesAt('#110 = #110 + 1')[i].macroValues['#110'], i + 1);
      close(entries[i].macroValues['#120'], (i + 1) * 5);
      close(entries[i].macroValues['#121'], -(i + 1) * 0.25);
    }
  }
  if (item.file.startsWith('07')) {
    const lanes = at('G01 X40.000 F480.000');
    assert.deepEqual(lanes.map(row => row.end.y), [-24, -16, -8, 0, 8, 16, 24]);
    for (const row of lanes) { close(row.start.x, -40); close(row.end.x, 40); close(row.distance, 80); close(row.timeSeconds, 10); }
    const arcs = at('G03 X[-#112] Y0.000 I[-#112] J0.000 F260.000');
    assert.equal(arcs.length, 3);
    arcs.forEach((row, i) => {
      const radius = 6 + i * 3;
      close(row.end.x, -radius);
      for (const point of row.points) close(Math.hypot(point.x, point.y), radius);
      close(row.distance, radius * Math.PI, 0.01);
    });
    assert.deepEqual(motions.filter(row => row.tool === 'T03' && row.end.z === -2.5)
      .map(row => [row.end.x, row.end.y]), [[-28, -18], [28, -18], [28, 18], [-28, 18]]);
    assert.equal(chronoblade.summary.unknownTimeRows, 0);
  }
  return { trace, vision, chronoblade, options };
}

module.exports = { cases, examplesDirectory, assertInventory, sourceLine, configureExample, assertDiagnostics, analyzeExample };
