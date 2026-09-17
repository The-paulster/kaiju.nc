const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const source = fs.readFileSync(path.join(__dirname, '../src/kaijuVision/webview.js'), 'utf8');
// These presentation helpers contain no template escapes; use the actual function bodies.
function helpers(names, globals = {}) {
  const context = vm.createContext({ ...globals });
  for (const name of names) {
    const marker = source.includes(`\t\tfunction ${name}(`) ? `\t\tfunction ${name}(` : `\t\tfunction* ${name}(`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, name);
    const end = source.indexOf('\n\t\t}', start) + '\n\t\t}'.length;
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}

test('Vision indexed culling preserves draw order and crossing paths', t => {
  const api = helpers(['rowBoundsIntersect', 'buildPathIndex', 'queryPathIndex']);
  const rows = Array.from({ length: 50000 }, (_, i) => ({ id: i,
    projectedBounds: { minX: i % 500, minY: Math.floor(i / 500), maxX: i % 500 + 0.5, maxY: Math.floor(i / 500) + 0.5 } }));
  rows.push({ id: 'crossing', projectedBounds: { minX: -100, minY: 25, maxX: 900, maxY: 25 } });
  const index = api.buildPathIndex(rows);
  const queries = Array.from({ length: 100 }, (_, i) => ({ minX: i, minY: 20, width: 8, height: 10 }));
  const started = performance.now();
  const expected = queries.map(bounds => rows.filter(row => api.rowBoundsIntersect(row.projectedBounds, bounds)));
  const linearMs = performance.now() - started;
  const indexedStart = performance.now();
  const actual = queries.map(bounds => api.queryPathIndex(index, bounds));
  const indexedMs = performance.now() - indexedStart;
  assert.ok(actual[0].length > 1);
  assert.ok(actual[0].some(row => row.id === 'crossing'));
  actual.forEach((result, i) => assert.deepEqual(Array.from(result, row => row.id), expected[i].map(row => row.id)));
  t.diagnostic(`50,001 rows, 100 viewport queries: linear ${linearMs.toFixed(1)} ms; indexed ${indexedMs.toFixed(1)} ms (Node helper benchmark, not frame timing)`);
});

test('Vision spatial path index rejects distant authored rows before leaf checks', () => {
  let intersections = 0;
  const intersects = (rowBounds, bounds) => {
    intersections++;
    return rowBounds.maxX >= bounds.minX && rowBounds.minX <= bounds.minX + bounds.width
      && rowBounds.maxY >= bounds.minY && rowBounds.minY <= bounds.minY + bounds.height;
  };
  const api = helpers(['buildPathIndex', 'queryPathIndex'], { rowBoundsIntersect: intersects, console });
  const rows = Array.from({ length: 20000 }, (_, i) => {
    const far = i % 2 === 1;
    const x = far ? 10000 + (i % 100) : i % 100;
    const y = Math.floor(i / 100) % 100;
    return { id: i, projectedBounds: { minX: x, minY: y, maxX: x + 0.5, maxY: y + 0.5 } };
  });
  const index = api.buildPathIndex(rows);
  const found = api.queryPathIndex(index, { minX: 4, minY: 4, width: 3, height: 3 });
  assert.deepEqual(Array.from(found, row => row.id), [
    404, 406, 504, 506, 604, 606, 704, 706,
    10404, 10406, 10504, 10506, 10604, 10606, 10704, 10706
  ]);
  assert.ok(intersections < 1000, `expected spatial pruning, saw ${intersections} bounds checks`);
});

test('Vision reuses filtered bounds until visibility changes', () => {
  let pointReads = 0;
  const point = { get x() { pointReads++; return 5; }, y: 2 };
  const api = helpers(['getVisibleProjectedData', 'makeBounds', 'buildPathIndex'], {
    visibleSceneCache: new WeakMap(), getVisibilityKey: v => v.key,
    isRowVisible: (row, v) => !v.hide,
  });
  const projected = { rows: [{ projectedPoints: [point], projectedBounds: { minX: 5, minY: 2, maxX: 5, maxY: 2 } }], cycles: [], events: [], toolChanges: [] };
  const scene = api.getVisibleProjectedData(projected, { key: 'all' });
  const reads = pointReads;
  for (let i = 0; i < 100; i++) assert.equal(api.getVisibleProjectedData(projected, { key: 'all' }), scene);
  assert.equal(pointReads, reads);
  assert.equal(api.getVisibleProjectedData(projected, { key: 'hidden', hide: true }).rows.length, 0);
});

test('Vision playback lookup matches execution order during forward and backward seeks', () => {
  const playback = { active: true, cursor: 0, entries: Array.from({ length: 12 }, () => ({})) };
  const api = helpers(['getPlaybackProjectionIndex', 'getPlaybackLocation', 'getCurrentPlaybackDot', 'getCurrentPlaybackPosition'], {
    playback, playbackProjectionIndexes: new WeakMap(), getPlaybackDotColor: () => 'yellow'
  });
  const projected = { rows: [2, 8].map(i => ({ executionIndex: i, projectedEnd: { x: i, y: 0 }, end: { x: i, c: 90 } })),
    cycles: [], events: [{ executionIndex: 5, projectedPoint: { x: 5, y: 1 }, position: { x: 5, c: 90 } }], toolChanges: [] };
  for (const cursor of [0, 2, 3, 5, 10, 3, 0, 8]) {
    playback.cursor = cursor;
    const expected = cursor >= 8 ? 8 : cursor >= 5 ? 5 : cursor >= 2 ? 2 : undefined;
    assert.equal(api.getCurrentPlaybackPosition(projected)?.x, expected);
    assert.equal(api.getCurrentPlaybackDot(projected)?.point.x, expected);
  }
  assert.equal(api.getPlaybackProjectionIndex(projected), api.getPlaybackProjectionIndex(projected));
});

test('Vision render requests coalesce without losing the latest state', () => {
  const frames = [];
  let rendered = 0;
  const api = helpers(['render'], { renderPending: false, window: { requestAnimationFrame: callback => frames.push(callback) }, renderFrame: () => rendered++ });
  for (let i = 0; i < 30; i++) api.render();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(rendered, 1);
  api.render();
  assert.equal(frames.length, 1);
});

test('Vision macro checkpoints and incremental stepping agree after reverse seeks', () => {
  const entries = Array.from({ length: 450 }, (_, i) => ({ macroChanges: [{ macro: '#1', previous: i - 1, current: i }], macroDisplayPrecisionChanges: [] }));
  const playback = { entries, initialMacroValues: {} };
  const api = helpers(['applyPlaybackChanges', 'applyPlaybackDisplayPrecisionChanges', 'makePlaybackCheckpoints', 'makePlaybackPrecisionCheckpoints', 'restorePlaybackMacroValues'], { playback });
  api.playbackCheckpoints = api.makePlaybackCheckpoints();
  api.playbackPrecisionCheckpoints = api.makePlaybackPrecisionCheckpoints();
  for (const cursor of [0, 1, 2, 399, 400, 401, 25, 26, 449, 0]) {
    api.restorePlaybackMacroValues(cursor);
    assert.equal(playback.macroValues.get('#1'), cursor);
  }
});

test('Vision retained paths preserve stroke grouping, transformed points and filter changes', () => {
  class RecordedPath {
    constructor() { this.commands = []; }
    moveTo(x, y) { this.commands.push(['M', x, y]); }
    lineTo(x, y) { this.commands.push(['L', x, y]); }
    addPath(path, m) { for (const [op, x, y] of path.commands) this.commands.push([op, x * m.a + m.e, y * m.d + m.f]); }
  }
  const api = helpers(['drawPolylineBucket', 'makeCanvasTransform'], {
    Path2D: RecordedPath, pathChunkCache: new WeakMap(), pathChunkBytes: 0, pathChunkLimitBytes: 1024 * 1024,
  });
  const sets = Array.from({ length: 260 }, (_, i) => [{ x: i, y: -i }, { x: i + 1, y: 10 }]);
  const draw = points => {
    const strokes = [];
    api.drawPolylineBucket({ save() {}, restore() {}, beginPath() {}, setLineDash() {}, stroke(p) { strokes.push(p.commands); } }, points,
      { alpha: 0.06, width: 1.4, color: 'yellow' }, api.makeCanvasTransform({ minX: 5, minY: -5, width: 200, height: 100 }, 400, 200));
    assert.equal(strokes.length, 1, 'overlap opacity requires one stroke for each style bucket');
    assert.deepEqual(strokes[0], points.flatMap(p => [['M', (p[0].x - 5) * 2, (p[0].y + 5) * 2], ['L', (p[1].x - 5) * 2, (p[1].y + 5) * 2]]));
  };
  draw(sets);
  draw(sets);
  draw(sets.filter((_, i) => i !== 100));
});

test('Vision lazy tooltips retain all merged entries and START details', () => {
  let calls = 0;
  const api = helpers(['getCachedTooltipItems'], {
    makePointHoverHtml: (position, row) => { calls++; return `${row.instruction}:${position.x}`; },
    makeToolChangeHoverHtml: row => { calls++; return row.tool; }
  });
  const entry = { hoverItemsById: new Map([['1', [{ row: { instruction: 'G1' }, position: { x: 2 } },
    { row: { instruction: 'G1' }, position: { x: 0 }, start: true }, { row: { tool: 'T1' }, tool: true }]]]) };
  assert.equal(calls, 0);
  assert.deepEqual(Array.from(api.getCachedTooltipItems(entry, '1')), ['G1:2', 'START:0', 'T1']);
  assert.equal(calls, 3);
});

test('Vision embedded renderer retains canvases, shares scale and handles playback plus labels', () => {
  const Module = require('node:module');
  const { makeDocument } = require('./helpers');
  const filename = path.join(__dirname, '../src/kaijuVision/webview.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source + '\nmodule.exports.render = renderVisionHtml;', filename);
  const doc = makeDocument('G0 X0 Y0 Z0\nG1 X20 Y200 Z2\nM3');
  const options = require('../src/kaijuVision/options').getVisionOptions(doc);
  const result = require('../src/MetaMotionEngine').analyzeVisionRange(doc, undefined, options);
  result.rows.forEach((row, i) => row.executionIndex = i);
  result.executionTrace = { executionEntries: [0, 1, 2].map(i => ({ sourceLine: doc.lineAt(i).text, lineNumber: i, macroChanges: [] })) };
  const html = loaded.exports.render(doc, 'whole', options, result);
  const payloadMatch = html.match(/<script\b[^>]*id="vision-data"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(payloadMatch, 'Vision data script');
  const payload = payloadMatch[1];
  const scriptMatch = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .find(match => match[1].includes('const vscode = acquireVsCodeApi();'));
  assert.ok(scriptMatch, 'Vision renderer script');
  const script = scriptMatch[1];
  const elements = new Map(), frames = [];
  const drawCounts = { strokes: 0 };
  class Element {
    constructor(id) {
      this.id = id; this.style = {}; this.listeners = {}; this.value = ''; this.checked = false;
      this.textContent = ''; this.scrollTop = 0; this.clientHeight = 200;
      const classes = new Set();
      this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { on ??= !classes.has(c); on ? classes.add(c) : classes.delete(c); } };
      this.context = new Proxy({}, { get: (obj, key) => obj[key] || (key === 'lineTo' ? () => drawCounts.strokes++ : () => {}), set: (obj, key, value) => { obj[key] = value; return true; } });
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute() {}
    focus() {}
    getContext() { return this.context; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.id === 'secondaryViewer' ? 399 : 400, height: 300 }; }
    querySelector() { return this.overlay || (this.overlay = new Element('overlay')); }
    set innerHTML(value) {
      this.markup = value;
      for (const match of value.matchAll(/<canvas id="([^"]+)"/g)) elements.set(match[1], new Element(match[1]));
    }
    get innerHTML() { return this.markup || ''; }
  }
  const get = id => {
    if (!elements.has(id) && !id.startsWith('vision-canvas')) elements.set(id, new Element(id));
    return elements.get(id);
  };
  get('vision-data').textContent = payload;
  get('plane').value = 'xy'; get('analysisMode').value = 'trace'; get('lineData').value = 'source';
  get('labels').checked = true; get('endpoints').checked = true;
  const visible = new Element('visible'); visible.checked = true; visible.value = '__none';
  const wcsInputs = ['__none', 'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(value => ({ value, checked: true }));
  const document = { addEventListener() {}, getElementById: get, createElement: tag => new Element(tag), body: new Element('body'),
    querySelector: () => new Element('input'), querySelectorAll: selector => selector === '[data-visibility-tool]' ? [visible] : selector === '[data-visibility-wcs]' ? wcsInputs : [] };
  let saved = { dualView: true, sharedAxis: 'x' };
  const context = vm.createContext({ document, console, performance,
    acquireVsCodeApi: () => ({ getState: () => saved, setState: value => saved = value, postMessage() {} }),
    window: { devicePixelRatio: 1, addEventListener() {}, requestAnimationFrame: f => frames.push(f), requestIdleCallback() {}, setInterval() {}, clearInterval() {} } });
  vm.runInContext(script, context);
  const flush = () => { while (frames.length) frames.shift()(); };
  flush();
  const canvas = get('vision-canvas'), secondary = get('vision-canvas-secondary');
  assert.ok(canvas && secondary);
  assert.equal(vm.runInContext('viewStateByKey.get("primary").bounds.height', context), vm.runInContext('viewStateByKey.get("secondary").bounds.height', context));
  context.startPlayback(); flush();
  context.setPlaybackCursor(1); flush();
  const strokes = drawCounts.strokes;
  context.setPlaybackCursor(2); flush();
  assert.equal(drawCounts.strokes, strokes, 'M-only event should reuse toolpath pixels');
  context.setPlaybackCursor(0); flush();
  assert.equal(get('vision-canvas'), canvas);
  assert.equal(get('vision-canvas-secondary'), secondary);
  get('dualViewToggle').listeners.click(); flush();
  assert.equal(get('secondaryViewer').hidden, true);
  assert.equal(get('planeControl').hidden, false);
});
