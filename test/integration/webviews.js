// Inspect the actual Chromium webview inside the isolated VS Code instance.
// No additional browser download is needed: Playwright attaches to Electron.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retry(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try { return await check(); } catch (error) { lastError = error; }
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${lastError?.message}`, { cause: lastError });
}

async function visionFrame(browser) {
  return retry(async () => {
    for (const page of browser.contexts().flatMap(context => context.pages())) {
      for (const frame of page.frames()) {
        try { if (await frame.locator('#vision-data').count()) return frame; } catch { /* A previous webview may be detaching. */ }
      }
    }
    throw new Error('Vision webview frame has not loaded: ' + JSON.stringify(browser.contexts().flatMap(context => context.pages()).map(page => ({ url: page.url(), frames: page.frames().map(frame => frame.url()) }))));
  }, 'Locate real Vision frame', 25000);
}

async function checkVision(browser, request, artifactDirectory) {
  let frame = await visionFrame(browser);
  await frame.locator('#plane').selectOption('xy');
  if (request.retainedCAxis) return checkRetainedCAxis(browser, frame, request, artifactDirectory);
  await retry(async () => {
    const rows = await frame.evaluate(() => JSON.parse(document.getElementById('vision-data').textContent).rows.filter(row => row.type === 'motion').map(row => ({
      lineNumber: row.lineNumber, executionIndex: row.executionIndex,
      motionCode: row.motionCode, tool: row.tool || null, end: row.end, points: row.points
    })));
    assert.equal(rows.length, request.motions, 'Command sends all expected Trace motion occurrences');
    assert.deepEqual(rows, request.motionRows, 'Displayed geometry, tools and source/execution links match reviewed analysis');
    assert.ok((await frame.locator('#visionTableBody tr').count()) > 0, 'Motion table renders rows');
  }, `${request.file}: render table`);
  // Redraw and read pixels in the same browser task: WebGL's default back buffer
  // can be cleared after presentation, making an unrelated later read blank.
  const raster = await frame.evaluate(() => {
    renderFrame();
    const canvas = document.getElementById('vision-canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { webgl: false };
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && (pixels[i] || pixels[i + 1] || pixels[i + 2])) colored++;
    return { webgl: true, error: gl.getError(), colored, width: canvas.width, height: canvas.height };
  });
  assert.equal(raster.webgl, true, 'Actual WebGL2 renderer initialized');
  assert.equal(raster.error, 0, 'Actual shaders and drawing produce no GL error');
  assert.ok(raster.colored > 0, 'Real path canvas contains painted pixels');
  await frame.locator('#viewer').screenshot({ path: path.join(artifactDirectory, request.file + '.png') });
  await frame.locator('#dualViewToggle').click();
  await retry(async () => assert.ok(await frame.locator('#vision-canvas-secondary').isVisible()), 'Dual View paints a second canvas');
  await frame.locator('#playbackToggle').click();
  await retry(async () => {
    frame = await visionFrame(browser);
    assert.equal(await frame.evaluate(() => JSON.parse(document.getElementById('vision-data').textContent).playback?.autoStart), true);
  }, 'Playback loads a real frozen Trace');
  const motions = await frame.evaluate(() => JSON.parse(document.getElementById('vision-data').textContent).rows.filter(row => row.type === 'motion'));
  for (const row of [motions[0], motions[Math.floor(motions.length / 2)], motions.at(-1), motions[0]]) {
    await frame.locator('#playbackScrubber').evaluate((input, value) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }, row.executionIndex + 1);
    await retry(async () => {
      assert.match(await frame.locator('#playbackPosition').textContent(), new RegExp(`Event ${row.executionIndex + 1} /`));
      const position = await frame.evaluate(() => getCurrentPlaybackPosition(getProjectedPlaneData(getPrimaryPlaneKey(), planes[getPrimaryPlaneKey()])));
      for (const axis of ['x', 'y', 'z', 'c']) if (Number.isFinite(row.end[axis])) assert.equal(position[axis], row.end[axis]);
      assert.ok((await frame.locator('#playbackPositionReadout').textContent()).trim().length > 0);
    }, 'Real playback seeks to the expected position');
  }
  console.log(`PASS ${request.file}: real WebGL pixels, Dual View and forward/reverse playback`);
}

async function checkRetainedCAxis(browser, frame, request, artifactDirectory) {
  const close = (actual, expected) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
  // Independent expectations: X40 diameter is radius 20. C90 lies on +Y;
  // turning lies on +X while its stored C remains 90. SVG Y points downward.
  await retry(async () => {
    const rows = await frame.evaluate(() => {
      const projected = getProjectedPlaneData(getPrimaryPlaneKey(), planes[getPrimaryPlaneKey()]);
      return projected.rows.filter(row => [6, 9].includes(row.lineNumber))
        .map(row => ({ lineNumber: row.lineNumber, end: row.end, projectedPoints: row.projectedPoints }));
    });
    assert.equal(rows.length, 2);
    const turning = rows.find(row => row.lineNumber === 6);
    assert.equal(turning.end.c, 90);
    for (const point of turning.projectedPoints) { close(point.x, 20); close(point.y, 0); }
    const engaged = rows.find(row => row.lineNumber === 9);
    for (const point of engaged.projectedPoints) { close(point.x, 0); close(point.y, -20); }
    assert.equal(await frame.locator('#vision-svg .position-reset').count(), 2);
    const connector = await frame.locator('#vision-svg .position-reset').first().evaluate(line => ({
      x1: Number(line.getAttribute('x1')), y1: Number(line.getAttribute('y1')),
      x2: Number(line.getAttribute('x2')), y2: Number(line.getAttribute('y2')),
      dash: getComputedStyle(line).strokeDasharray, opacity: getComputedStyle(line).strokeOpacity,
      title: line.textContent
    }));
    close(connector.x1, 0); close(connector.y1, -20); close(connector.x2, 20); close(connector.y2, 0);
    assert.match(connector.dash, /^2(?:px)?,\s*4(?:px)?$/);
    close(Number(connector.opacity), 0.75);
    assert.match(connector.title, /C-axis cancellation:.*no tool motion/);
  }, 'Retained C uses the C0 turning plane and faint dotted connector');
  await frame.locator('#playbackToggle').click();
  await retry(async () => {
    frame = await visionFrame(browser);
    assert.equal(await frame.evaluate(() => JSON.parse(document.getElementById('vision-data').textContent).playback?.autoStart), true);
  }, 'Retained-C playback loads');
  const entries = await frame.evaluate(() => JSON.parse(document.getElementById('vision-data').textContent).playback.entries);
  // Include mode-only blocks, the turning move, an intervening stop, and reverse seeks.
  for (const line of [3, 4, 5, 6, 7, 8, 4, 3]) {
    const entry = entries.find(entry => entry.lineNumber === line);
    assert.ok(entry, `Trace includes fixture line ${line + 1}`);
    await frame.locator('#playbackScrubber').evaluate((input, value) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }, entry.executionIndex + 1);
    await retry(async () => {
      const location = await frame.evaluate(() => getPlaybackLocation(getProjectedPlaneData(getPrimaryPlaneKey(), planes[getPrimaryPlaneKey()])));
      const turning = line >= 4 && line <= 6;
      assert.equal(location.position.c, 90, 'Controller C remains retained');
      close(location.point.x, turning ? 20 : 0); close(location.point.y, turning ? 0 : -20);
      const readout = await frame.locator('#playbackPositionReadout .axis-c').textContent();
      assert.match(readout, /C\s+90\.000/);
      if (turning) assert.match(readout, /\(Lathe mode; retained\)/);
      else assert.doesNotMatch(readout, /Lathe mode/);
      assert.equal(await frame.locator('#vision-svg .position-reset').count(), line >= 7 ? 2 : line >= 4 ? 1 : 0,
        'Connectors follow playback cursor, including reverse seeks');
    }, `Retained-C playback at fixture line ${line + 1}`);
    if (line === 5) await frame.locator('#viewer').screenshot({ path: path.join(artifactDirectory, request.file + '.png') });
  }
  console.log(`PASS ${request.file}: C0 turning plane, retained-C readout, dotted connectors and reverse playback`);
}

function monitorWebviews(endpoint, workspace) {
  let stopped = false, browser;
  const task = (async () => {
    const requestFile = path.join(workspace, '.webview-request.json');
    let previousId;
    const artifacts = path.join(workspace, 'screenshots');
    fs.mkdirSync(artifacts, { recursive: true });
    while (!stopped) {
      if (fs.existsSync(requestFile)) {
        const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
        if (request.id !== previousId) {
          previousId = request.id;
          let error;
          try {
            browser ||= await retry(() => chromium.connectOverCDP(endpoint, { timeout: 2000 }), 'Connect to isolated VS Code');
            if (request.type !== 'connect') await checkVision(browser, request, artifacts);
          } catch (failure) {
            error = failure.stack || String(failure);
            if (browser) {
              for (const page of browser.contexts().flatMap(context => context.pages())) {
                await page.screenshot({ path: path.join(artifacts, 'failure-workbench.png') }).catch(() => {});
              }
            }
          }
          const resultFile = path.join(workspace, `.webview-result-${request.id}.json`);
          fs.writeFileSync(resultFile + '.tmp', JSON.stringify({ error }));
          fs.renameSync(resultFile + '.tmp', resultFile);
        }
      }
      await pause(50);
    }
  })();
  return async () => { stopped = true; await task; if (browser?.isConnected()) await browser.close(); };
}

module.exports = { monitorWebviews };
