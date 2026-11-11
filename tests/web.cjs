const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, launchOptions } = require('../scripts/browser-runtime.cjs');

(async () => {
  const { createApp } = await import('../server/app.mjs');
  const server = await new Promise(resolve => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [], sampleRequests = [];
    let workers = 0;
    page.on('worker', () => workers++);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/assets/sample-')) sampleRequests.push(request.url()); });
    const ready = () => page.waitForFunction(() => window.appReady && !biji.seeking, null, { timeout: 90_000 });
    const saved = () => page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '已保存在本机');
    await page.goto(origin);
    await ready();
    assert.equal(await page.title(), '绘画记录');
    assert.equal(await page.locator('#speed').inputValue(), '16');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert(sampleRequests.every(url => !url.includes('sample-brush')));

    const image = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 140; c.height = 200;
      const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 140, 200);
      g.addColorStop(0, '#172945'); g.addColorStop(.55, '#bc8175'); g.addColorStop(1, '#ffdfb0');
      x.fillStyle = g; x.fillRect(0, 0, 140, 200);
      x.strokeStyle = '#101520'; x.lineWidth = 3; x.strokeRect(15, 20, 110, 160);
      return c.toDataURL();
    });
    await page.locator('#upload').setInputFiles({ name: 'Web绘画验证.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await ready(); await saved();
    assert.equal(workers, 1);
    const stages = await page.evaluate(() => biji.data.stages.map(s => s.role));
    assert.deepEqual(stages, ['sketch', 'ink', 'base', 'tone', 'detail', 'finish']);
    assert(await page.evaluate(() => biji.data.strokes.filter(s => s.layer === 'paint').every(s => s.kind === 'fillBrush')));
    const initialCamera = await page.evaluate(() => biji.camera.pose);
    await page.locator('#play').click();
    await page.waitForFunction(() => biji.position > 3);
    await page.locator('#play').click();
    assert.equal(await page.evaluate(() => biji.playing), false);
    assert.deepEqual(await page.evaluate(() => biji.camera.pose), initialCamera);
    await page.locator('#showResult').click(); await ready();
    await page.waitForFunction(() => biji.position === biji.data.strokes.length);
    const finalImage = await page.locator('#drawing').evaluate(c => c.toDataURL());
    await page.evaluate(() => { biji.seek(0); biji.seek(biji.data.strokes.length); });
    assert.equal(await page.locator('#drawing').evaluate(c => c.toDataURL()), finalImage);

    await page.locator('#mobileReference').click();
    await page.locator('#refZoomIn').click();
    assert.notEqual(await page.locator('#refZoomStatus').textContent(), '1.0×');
    assert.deepEqual(await page.evaluate(() => biji.camera.pose), initialCamera);
    await page.locator('#mobileDrawing').click();
    await page.locator('#modeBrush').click(); await ready(); await saved();
    assert.equal(await page.evaluate(() => biji.mode), 'brush');
    assert.equal(workers, 2);
    await page.locator('#modeFill').click(); await ready(); await saved();
    assert.equal(await page.evaluate(() => biji.mode), 'fill');
    assert.equal(workers, 2);
    const requestsBeforeReload = sampleRequests.length;
    await page.reload(); await ready();
    assert.equal(await page.locator('#sourceName').textContent(), 'Web绘画验证.png');
    assert.equal(workers, 2, 'reload reuses cached drawing steps');
    assert.equal(sampleRequests.length, requestsBeforeReload, 'restored uploads do not download sample data');

    await fs.mkdir('test-results', { recursive: true });
    await page.locator('#showResult').click(); await ready();
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    await page.locator('#openHistory').click();
    const record = page.locator('#historyList button').first();
    await record.click({ button: 'right' });
    await page.locator('#confirmHistoryDelete').click();
    await page.waitForFunction(() => document.querySelector('#historyEmpty').hidden === false);
    await page.locator('#closeHistory').click();
    await page.reload(); await ready();
    assert.notEqual(await page.locator('#sourceName').textContent(), 'Web绘画验证.png');

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    desktop.on('pageerror', error => errors.push(error.message));
    await desktop.goto(origin + '/biji-repaint.html');
    await desktop.waitForFunction(() => window.appReady);
    assert.equal(await desktop.locator('#refPanel').isVisible(), true);
    await desktop.locator('#refZoomIn').click();
    assert.notEqual(await desktop.locator('#refZoomStatus').textContent(), '1.0×');
    await desktop.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mobile: true, desktop: true, uploadWorker: true, stages, playback: true, deterministicReplay: true, independentZoom: true, cachedModes: true, refreshRestores: true, historyDeletion: true, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
