// Launch an isolated Extension Development Host; never use the developer's
// current user-data directory or mutate the checked-in example programs.
const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
const net = require('node:net');
const { monitorWebviews } = require('./webviews');

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const cache = path.join(root, '.vscode-test');
  fs.mkdirSync(cache, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(cache, 'example-workspace-'));
  const userData = fs.mkdtempSync(path.join(cache, 'example-user-'));
  const extensions = fs.mkdtempSync(path.join(cache, 'example-extensions-'));
  fs.mkdirSync(path.join(workspace, '.vscode'));
  fs.writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify({ 'git.openRepositoryInParentFolders': 'never' }));
  for (const file of fs.readdirSync(path.join(root, 'examples')).filter(file => /\.nc$/i.test(file))) {
    fs.copyFileSync(path.join(root, 'examples', file), path.join(workspace, file));
  }
  const vscodeVersion = process.env.KAIJU_VSCODE_VERSION || 'stable';
  const port = await unusedPort();
  const stopMonitor = monitorWebviews(`http://127.0.0.1:${port}`, workspace);
  console.log(`Example integration workspace: ${workspace}`);
  try { await runTests({
    version: vscodeVersion,
    vscodeExecutablePath: process.env.KAIJU_VSCODE_EXECUTABLE || undefined,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    extensionTestsEnv: { KAIJU_TEST_WORKSPACE: workspace, ELECTRON_RUN_AS_NODE: undefined },
    launchArgs: [workspace, '--disable-extensions', '--user-data-dir', userData, '--extensions-dir', extensions,
      `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  }); } finally { await stopMonitor(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
