const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const contracts = require('../example-contracts');

async function eventually(check, label) {
  const deadline = Date.now() + 60000;
  let lastError;
  do {
    try { return check(); } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${lastError.message}`, { cause: lastError });
}

function tabs() { return vscode.window.tabGroups.all.flatMap(group => group.tabs); }

let requestId = 0;
async function browserCheck(request) {
  const id = ++requestId;
  const requestFile = path.join(process.env.KAIJU_TEST_WORKSPACE, '.webview-request.json');
  fs.writeFileSync(requestFile + '.tmp', JSON.stringify({ id, ...request }));
  fs.renameSync(requestFile + '.tmp', requestFile);
  const resultFile = path.join(process.env.KAIJU_TEST_WORKSPACE, `.webview-result-${id}.json`);
  const result = await eventually(() => {
    assert.ok(fs.existsSync(resultFile), 'Browser checks completed');
    return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  }, `${request.file || 'Startup'}: real browser checks`);
  assert.ok(!result.error, result.error);
}
async function openReport(document, command, title, item) {
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand(command);
  const tab = await eventually(() => {
    const tab = tabs().find(tab => tab.label === title && tab.input instanceof vscode.TabInputWebview);
    assert.ok(tab, `${command} creates a real Webview tab`);
    return tab;
  }, command);
  if (command === 'kaijuNC.vision') {
    await vscode.commands.executeCommand('notifications.clearAll');
    await browserCheck({ file: item.file, motions: item.motions, motionRows: item.motionRows });
  }
  assert.equal(await vscode.window.tabGroups.close(tab, true), true, `Close ${title}`);
  await eventually(() => assert.ok(!tabs().includes(tab)), `Dispose ${title}`);
}

async function run() {
  const manifest = require('../../package.json');
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension, 'Development extension is loaded');
  await extension.activate();
  assert.ok(extension.isActive, 'Real extension activation completed');
  // Attach Chromium automation before creating webviews so no iframe lifecycle
  // events are missed during the initial DevTools connection.
  await browserCheck({ type: 'connect' });
  contracts.assertInventory();
  const commands = await vscode.commands.getCommands(true);
  // Give report screenshots useful space in this disposable test window.
  for (const command of ['workbench.action.closeSidebar', 'workbench.action.closeAuxiliaryBar']) {
    if (commands.includes(command)) await vscode.commands.executeCommand(command);
  }
  for (const command of ['kaijuNC.vision', 'kaijuNC.chronoblade', 'kaijuNC.orphanKiller']) {
    assert.ok(commands.includes(command), `${command} registered during activation`);
  }
  for (const item of contracts.cases) {
    const filename = path.join(process.env.KAIJU_TEST_WORKSPACE, item.file);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
    assert.equal(document.languageId, 'gcode', 'Packaged language registration recognizes .nc');
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    await contracts.configureExample(document, item);
    await eventually(() => contracts.assertDiagnostics(document, item,
      vscode.languages.getDiagnostics(document.uri).filter(diagnostic => diagnostic.source === 'Kaiju Alert')), `${item.file}: registered Alert results`);
    const analysis = contracts.analyzeExample(document, item);
    const motionRows = analysis.vision.rows.filter(row => row.type === 'motion').map(row => ({
      lineNumber: row.lineNumber, executionIndex: row.executionIndex,
      motionCode: row.motionCode, tool: row.tool || null, end: row.end, points: row.points
    }));
    await openReport(document, 'kaijuNC.vision', 'KAIJU Vision', { ...item, motionRows });
    await openReport(document, 'kaijuNC.chronoblade', 'KAIJU Chronoblade');
    await openReport(document, 'kaijuNC.orphanKiller', 'KAIJU Orphan Killer');
    assert.equal(document.isDirty, false, 'Inspection commands do not edit the example');
    assert.equal(document.getText(), fs.readFileSync(filename, 'utf8'), 'Example source preserved');
    console.log(`PASS ${item.file}: real diagnostics, reviewed analysis and three report commands`);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  console.log(`PASS all ${contracts.cases.length} example programs in VS Code ${vscode.version}`);
}

module.exports = { run };
