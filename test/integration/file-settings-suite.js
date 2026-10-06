// Focused smoke test for the real Extension Development Host and webview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function browserRequest(type) {
	const root = process.env.KAIJU_FILE_SETTINGS_WORKSPACE;
	const request = path.join(root, 'request.json');
	fs.writeFileSync(request, JSON.stringify({ type }));
	const result = path.join(root, `${type}-result.json`);
	const deadline = Date.now() + 40000;
	while (!fs.existsSync(result) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
	assert.ok(fs.existsSync(result), `${type}: browser response arrived`);
	const value = JSON.parse(fs.readFileSync(result, 'utf8'));
	assert.ok(!value.error, value.error);
	return value;
}

async function run() {
	const manifest = require('../../package.json');
	await vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`).activate();
	await browserRequest('connect');
	const root = process.env.KAIJU_FILE_SETTINGS_WORKSPACE;
	const source = 'G0 X0\nG1 X10 F100\n';
	const uri = vscode.Uri.file(path.join(root, 'first.nc'));
	fs.writeFileSync(uri.fsPath, source);
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
	const config = vscode.workspace.getConfiguration('kaijuNC.fileSettings');
	assert.equal(config.get('showInContextMenu'), false);
	await browserRequest('menuHidden');
	await config.update('showInContextMenu', true, vscode.ConfigurationTarget.Workspace);
	await browserRequest('menuVisible');
	await config.update('showInContextMenu', false, vscode.ConfigurationTarget.Workspace);
	await browserRequest('menuHiddenAgain');
	await vscode.commands.executeCommand('kaijuNC.fileSettings');
	const deadline = Date.now() + 15000;
	while (!vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === 'KAIJU File Settings') && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === 'KAIJU File Settings'));
	const other = await vscode.workspace.openTextDocument({ language: 'gcode', content: 'G0 X999' });
	await vscode.window.showTextDocument(other, vscode.ViewColumn.One);
	const result = await browserRequest('inspect');
	assert.ok(result.rows > 100);
	const snapshot = JSON.parse(await vscode.env.clipboard.readText());
	assert.equal(snapshot.file, document.uri.toString());
	assert.ok(snapshot.configuration.length > 0);
	assert.equal(document.getText(), source);
	assert.equal(document.isDirty, false);
	console.log(`PASS File Settings: ${result.rows} rows; context-menu visibility off/on/off, real webview search, Refresh, Copy JSON and source binding`);
}

module.exports = { run };
