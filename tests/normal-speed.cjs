const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, launchOptions } = require('../scripts/browser-runtime.cjs');

(async () => {
  const { createApp } = await import('../server/app.mjs');
  const server = await new Promise(resolve => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.appReady);
    const simulated = await page.evaluate(() => {
      const rows = [];
      for (const role of ['ink', 'base', 'finish']) {
        const stage = biji.data.stages.find(s => s.role === role);
        for (const rate of [1, 4, 16, 1024]) {
          biji.stop(); biji.seek(stage.start);
          const speed = document.querySelector('#speed'); speed.value = String(rate); speed.dispatchEvent(new Event('change'));
          let previous = biji.position, maxPerFrame = 0, partialFrames = 0, lifts = 0;
          for (let frame = 0; frame < 240; frame++) {
            biji.step(1 / 60);
            maxPerFrame = Math.max(maxPerFrame, biji.position - previous);
            if (biji.fraction > 0 && biji.fraction < 1) partialFrames++;
            if (biji.penUp) lifts++;
            previous = biji.position;
          }
          rows.push({ role, rate, strokes: biji.position - stage.start, maxPerFrame, partialFrames, lifts });
        }
      }
      return rows;
    });
    for (const role of ['ink', 'base', 'finish']) {
      const rows = simulated.filter(r => r.role === role), normal = rows.find(r => r.rate === 1);
      assert(normal.strokes >= 1 && normal.strokes <= 8, `${role}: excessive 1x stroke count over 4 seconds`);
      assert(normal.maxPerFrame <= 1 && normal.partialFrames > 80 && normal.lifts > 10);
      assert(rows.find(r => r.rate === 4).strokes > normal.strokes * 2);
      assert(rows.find(r => r.rate === 16).strokes > normal.strokes * 6);
      assert(rows.find(r => r.rate === 1024).strokes > normal.strokes * 20);
    }
    const realtime = [];
    for (const role of ['ink', 'base', 'finish']) realtime.push(await page.evaluate(async role => {
      biji.stop(); const stage = biji.data.stages.find(s => s.role === role); biji.seek(stage.start);
      const speed = document.querySelector('#speed'); speed.value = '1'; speed.dispatchEvent(new Event('change'));
      const initial = biji.position, start = performance.now(); document.querySelector('#play').click();
      await new Promise(resolve => setTimeout(resolve, 4000)); biji.stop();
      const seconds = (performance.now() - start) / 1000;
      return { role, strokes: biji.position - initial, seconds, strokesPerSecond: +((biji.position - initial) / seconds).toFixed(2) };
    }, role));
    assert(realtime.every(r => r.strokesPerSecond <= 2));
    assert.deepEqual(errors, []);
    await fs.mkdir('test-results', { recursive: true });
    await fs.writeFile('test-results/normal-speed.json', JSON.stringify({ simulated, realtime, errors }, null, 2));
    console.log({ realtime, visiblePartialStrokes: true, penLifts: true, fastModesPreserved: true, errors });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
