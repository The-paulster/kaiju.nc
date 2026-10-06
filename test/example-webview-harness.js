const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

function loadRenderer(relativePath, name) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(fs.readFileSync(filename, 'utf8') + `\nmodule.exports.testRender = ${name};`, filename);
  return loaded.exports.testRender;
}

function scriptsIn(html) {
  const scripts = [];
  let cursor = 0;
  while ((cursor = html.indexOf('<script', cursor)) !== -1) {
    const start = html.indexOf('>', cursor);
    const end = html.indexOf('</script>', start);
    assert.ok(start >= 0 && end >= 0, 'Complete generated script element');
    const tag = html.slice(cursor, start);
    scripts.push({ tag, body: html.slice(start + 1, end) });
    cursor = end + '</script>'.length;
  }
  assert.ok(scripts.length, 'Generated scripts exist');
  for (const script of scripts) {
    if (!script.tag.includes('application/json')) new vm.Script(script.body);
  }
  return scripts;
}

// Deliberately small DOM/Canvas test double. This executes the complete emitted
// renderer, but cannot establish browser layout or GPU rendering correctness.
function runVision(html) {
  const scripts = scriptsIn(html);
  const payload = scripts.find(script => script.tag.includes('id="vision-data"'));
  assert.ok(payload);
  const data = JSON.parse(payload.body);
  const elements = new Map(), frames = [], drawCommands = [];
  class Element {
    constructor(id) {
      this.id = id; this.style = {}; this.listeners = {}; this.value = ''; this.checked = false;
      this.textContent = ''; this.scrollTop = 0; this.clientHeight = 200;
      const classes = new Set();
      this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle(c, on) { on ??= !classes.has(c); on ? classes.add(c) : classes.delete(c); } };
      this.context = new Proxy({}, { get: (obj, key) => obj[key] ||
        (['moveTo', 'lineTo', 'arc'].includes(key) ? (...values) => drawCommands.push([key, ...values]) : () => {}),
        set: (obj, key, value) => { obj[key] = value; return true; } });
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute() {}
    focus() {}
    getContext(kind) { return kind === '2d' ? this.context : null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; }
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
  get('vision-data').textContent = payload.body;
  get('plane').value = 'xy'; get('analysisMode').value = 'trace'; get('lineData').value = 'source';
  get('labels').checked = true; get('endpoints').checked = true;
  const toolInputs = [...new Set(data.rows.map(row => row.tool || '__none'))].map(value => ({ value, checked: true }));
  const wcsInputs = ['__none', 'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(value => ({ value, checked: true }));
  const document = { addEventListener() {}, getElementById: get, createElement: tag => new Element(tag), body: new Element('body'),
    querySelector: () => new Element('input'), querySelectorAll: selector => selector === '[data-visibility-tool]' ? toolInputs : selector === '[data-visibility-wcs]' ? wcsInputs : [] };
  let saved = { dualView: true, sharedAxis: 'x' };
  const context = vm.createContext({ document, console, performance,
    acquireVsCodeApi: () => ({ getState: () => saved, setState: value => { saved = value; }, postMessage() {} }),
    window: { devicePixelRatio: 1, addEventListener() {}, requestAnimationFrame: f => frames.push(f), requestIdleCallback() {}, setInterval() {}, clearInterval() {} } });
  const script = scripts.find(script => script.body.includes('acquireVsCodeApi()'));
  assert.ok(script);
  vm.runInContext(script.body, context, { timeout: 5000 });
  function flush() {
    let remaining = 100;
    while (frames.length) { assert.ok(remaining-- > 0, 'Renderer frame queue settles'); frames.shift()(); }
  }
  flush();
  assert.ok(get('vision-canvas') && get('vision-canvas-secondary'), 'Both projections create canvases');
  function assertDrawn() {
    assert.ok(drawCommands.some(command => command[0] === 'lineTo'), 'Paths reach the Canvas renderer');
    for (const command of drawCommands) assert.ok(command.slice(1).every(Number.isFinite), 'Finite drawing coordinates');
  }
  if (!data.playback) assertDrawn();
  for (const key of ['primary', 'secondary']) {
    const bounds = vm.runInContext(`viewStateByKey.get("${key}").bounds`, context);
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.ok(Object.values(bounds).every(Number.isFinite));
  }
  assert.equal(vm.runInContext('viewStateByKey.get("primary").bounds.height', context),
    vm.runInContext('viewStateByKey.get("secondary").bounds.height', context), 'Shared projection scale');
  return { context, get, flush, data, assertDrawn };
}

module.exports = { loadRenderer, scriptsIn, runVision };
