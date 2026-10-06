const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { makeDocument, vscode } = require("./helpers");
const { inspectOrphanMacros, registerOrphanKiller } = require("../src/kaijuOrphanKiller");

test("orphan locations retain exact authored tokens, aliases, and same-line occurrences", () => {
	const document = makeDocument("#190   = 9 (UNUSED SETUP VALUE)\nG1 X#199 Y#199 Z#missing (#199) <#missing>\n#191 = 2\n#191 = 3\nG1 X#1001");
	const result = inspectOrphanMacros(document);
	assert.deepEqual(result.undefinedUses.map(item => item.macro), ["#199", "#MISSING"]);
	assert.deepEqual(result.unusedDefinitions.map(item => item.macro), ["#190", "#191"]);
	const repeated = result.undefinedUses.find(item => item.macro === "#199");
	assert.deepEqual(repeated.lines, [2]);
	assert.equal(repeated.occurrences.length, 2);
	for (const item of [...result.undefinedUses, ...result.unusedDefinitions]) {
		for (const occurrence of item.occurrences) {
			assert.equal(document.lineAt(occurrence.line).text.slice(occurrence.start, occurrence.end).toUpperCase(), item.macro);
		}
	}
	const aliased = makeDocument("#140 = 0.20 (FINISH ALLOWANCE)\nG1 X#finish_allowance\nG1 Y#missing");
	assert.deepEqual(inspectOrphanMacros(aliased).undefinedUses.map(item => item.macro), ["#MISSING"]);
});

test("report navigation wraps, synchronizes exact source highlights, and rejects stale locations", async () => {
	let command, onEdit, onVisible, onMessage, onDispose;
	const messages = [];
	let source = makeDocument("#190   = 9\nG1 X#199 Y#199 Z#missing", { uri: "navigation.nc" });
	let ranges = [];
	let revealed;
	const editor = {
		get document() { return source; }, viewColumn: 1,
		setDecorations(_type, value) { ranges = value; },
		revealRange(range) { revealed = range; }
	};
	const webview = { html: "", onDidReceiveMessage(listener) { onMessage = listener; }, async postMessage(message) { messages.push(message); } };
	const panel = { webview, onDidDispose(listener) { onDispose = listener; }, reveal() {} };
	vscode.ThemeColor = class { constructor(name) { this.name = name; } };
	vscode.Selection = class { constructor(start, end) { this.start = start; this.end = end; } };
	vscode.ViewColumn = { One: 1, Beside: -2 };
	vscode.TextEditorRevealType = { InCenterIfOutsideViewport: 2 };
	vscode.Uri = { parse: value => ({ toString: () => value }) };
	vscode.commands = {
		registerCommand(_name, listener) { command = listener; return { dispose() {} }; },
		async executeCommand() { return undefined; }
	};
	vscode.window.activeTextEditor = editor;
	vscode.window.visibleTextEditors = [editor];
	vscode.window.createTextEditorDecorationType = () => ({ dispose() {} });
	vscode.window.createWebviewPanel = () => panel;
	vscode.window.onDidChangeVisibleTextEditors = listener => { onVisible = listener; return { dispose() {} }; };
	vscode.window.showWarningMessage = message => assert.fail(message);
	vscode.window.showTextDocument = async (_document, options) => {
		assert.equal(options.viewColumn, 1);
		assert.equal(options.preserveFocus, true);
		vscode.window.visibleTextEditors = [editor];
		onVisible();
		return editor;
	};
	vscode.workspace.openTextDocument = async () => source;
	vscode.workspace.onDidChangeTextDocument = listener => { onEdit = listener; return { dispose() {} }; };
	registerOrphanKiller({ subscriptions: [], workspaceState: { get: () => ({}), update: async () => {} } });
	await command();
	let reportId = 1;
	const navigate = fields => onMessage({ type: "navigate", reportId, ...fields });
	await navigate({ direction: 1 });
	assert.equal(messages.at(-1).macro, "#190");
	assert.equal(messages.at(-1).total, 4);
	assert.deepEqual(editor.selection.start, { line: 0, character: 0 });
	assert.deepEqual(editor.selection.end, { line: 0, character: 4 });
	assert.equal(ranges.length, 1);
	assert.deepEqual(revealed, ranges[0]);
	await navigate({ macro: "#199", line: 2 });
	assert.equal(messages.at(-1).index, 1);
	assert.equal(editor.selection.start.character, 4);
	await navigate({ direction: 1 });
	assert.equal(messages.at(-1).index, 2);
	assert.equal(editor.selection.start.character, 10);
	await navigate({ direction: 1 });
	assert.equal(messages.at(-1).macro, "#MISSING");
	assert.equal(editor.selection.end.character, 24);
	await navigate({ direction: 1 });
	assert.equal(messages.at(-1).index, 0);
	await navigate({ direction: -1 });
	assert.equal(messages.at(-1).index, 3);
	await Promise.all([navigate({ direction: 1 }), navigate({ direction: 1 }), navigate({ direction: 1 })]);
	assert.equal(messages.at(-1).index, 2, "rapid steps are processed in order");
	await navigate({ direction: 1 });
	await navigate({ macro: "#999" });
	assert.equal(messages.at(-1).index, 3);
	await navigate({ macro: "#199" });
	await onMessage({ type: "refresh" });
	reportId++;
	assert.match(webview.html, /"index":1,"total":4,"macro":"#199"/);
	const count = messages.length;
	await onMessage({ type: "navigate", reportId: 1, direction: 1 });
	assert.equal(messages.length, count);
	const previousSelection = editor.selection;
	source = makeDocument("G1 X0\n#190 = 9\nG1 X#199 Y#199", { uri: "navigation.nc", version: 2 });
	onEdit({ document: source, contentChanges: [{}] });
	assert.equal(ranges.length, 0);
	assert.equal(messages.at(-1).stale, true);
	await navigate({ direction: 1 });
	assert.equal(editor.selection, previousSelection);
	await onMessage({ type: "refresh" });
	reportId++;
	vscode.window.visibleTextEditors = [];
	await navigate({ macro: "#199" });
	assert.equal(editor.selection.start.line, 2);
	assert.equal(ranges.length, 1);

	// Execute the emitted script: message wiring, row highlight, counter, and keys.
	const html = webview.html;
	const start = html.indexOf(">", html.indexOf("<script nonce=")) + 1;
	const script = html.slice(start, html.indexOf("</script>", start));
	new Function(script);
	const posted = [];
	const elements = new Map();
	const element = id => {
		if (!elements.has(id)) elements.set(id, { id, dataset: {}, handlers: {}, attrs: {}, active: false,
			addEventListener(name, callback) { this.handlers[name] = callback; },
			setAttribute(name, value) { this.attrs[name] = value; },
			classList: { toggle(name, value) { elements.get(id).active = value; } },
			scrollIntoView() {}, closest() { return null; } });
		return elements.get(id);
	};
	const button = element("finding");
	const link = element("line-link"); link.dataset.line = "3";
	const row = element("row"); row.dataset.macro = "#199";
	row.querySelector = () => button; row.querySelectorAll = () => [link];
	const handlers = {};
	vm.runInNewContext(script, {
		acquireVsCodeApi: () => ({ postMessage: value => posted.push(value) }),
		document: { getElementById: element, querySelectorAll: () => [row], addEventListener: (name, callback) => { handlers[name] = callback; } },
		window: { addEventListener: (name, callback) => { handlers[name] = callback; } }
	});
	button.handlers.click();
	assert.equal(posted.at(-1).macro, "#199");
	link.handlers.click();
	assert.equal(posted.at(-1).line, 3);
	handlers.message({ data: messages.at(-1) });
	assert.equal(row.active, true);
	assert.equal(link.active, true);
	assert.equal(button.attrs["aria-pressed"], "true");
	assert.equal(element("position").textContent, "2 of 3");
	for (const shiftKey of [false, true]) {
		handlers.keydown({ key: "Enter", shiftKey, target: button, preventDefault() {} });
		assert.equal(posted.at(-1).direction, shiftKey ? -1 : 1);
	}
	handlers.message({ data: { ...messages.at(-1), stale: true } });
	assert.equal(row.active, false);
	assert.equal(element("next").disabled, true);
	const postedCount = posted.length;
	button.handlers.click();
	assert.equal(posted.length, postedCount);

	await onMessage({ type: "setLive", live: true });
	source = makeDocument("G1 X0\nG1 X0\n#190 = 9\nG1 X#199 Y#199", { uri: "navigation.nc", version: 3 });
	onEdit({ document: source, contentChanges: [{}] });
	assert.equal(ranges.length, 0);
	await new Promise(resolve => setTimeout(resolve, 250));
	reportId++;
	assert.match(webview.html, /"macro":"#199","line":4,"stale":false/);
	assert.equal(ranges[0].start.line, 3, "Live keeps the selected macro when its line moves");
	source = makeDocument("G1 X0", { uri: "navigation.nc", version: 4 });
	onEdit({ document: source, contentChanges: [{}] });
	await onMessage({ type: "refresh" });
	reportId++;
	assert.equal(ranges.length, 0);
	assert.match(webview.html, /"index":-1,"total":0/);
	const finalMessageCount = messages.length;
	await navigate({ direction: 1 });
	assert.equal(messages.length, finalMessageCount);
	onDispose();
	assert.equal(ranges.length, 0);
});
