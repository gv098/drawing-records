const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, launchOptions } = require('../scripts/browser-runtime.cjs');

(async () => {
  const { createApp } = await import('../server/app.mjs');
  const server = await new Promise(resolve => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.appReady);
    await fs.mkdir('test-results', { recursive: true });
    await page.evaluate(() => { const s = biji.data.stages.find(x => x.role === 'base'); biji.seek(Math.round(s.start + (s.end - s.start) * .32)); });
    await page.locator('#drawing').screenshot({ path: 'test-results/human-base-progress.png' });
    await page.evaluate(() => { const s = biji.data.stages.find(x => x.role === 'detail'); biji.seek(Math.round(s.start + (s.end - s.start) * .45)); });
    await page.locator('#drawing').screenshot({ path: 'test-results/human-detail-progress.png' });
    await page.locator('#showResult').click();
    await page.waitForFunction(() => !biji.seeking && biji.position === biji.data.strokes.length, null, { timeout: 90_000 });
    const result = await page.evaluate(() => {
      const d = biji.data, paint = d.strokes.filter(s => s.layer === 'paint');
      const byRole = Object.fromEntries(d.stages.map(stage => {
        const strokes = d.strokes.slice(stage.start, stage.end);
        return [stage.role, {
          count: strokes.length,
          averageLength: strokes.reduce((n, s) => n + s.length, 0) / Math.max(1, strokes.length),
          averageWidth: strokes.reduce((n, s) => n + s.width, 0) / Math.max(1, strokes.length),
          short: strokes.filter(s => s.length < 3).length,
        }];
      }));
      const actual = document.querySelector('#drawing'), reference = document.createElement('canvas');
      reference.width = actual.width; reference.height = actual.height;
      reference.getContext('2d').drawImage(document.querySelector('#reference'), 0, 0, reference.width, reference.height);
      const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data;
      const b = reference.getContext('2d').getImageData(0, 0, actual.width, actual.height).data;
      let error = 0; for (let i = 0; i < a.length; i += 4) error += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      return {
        revision: d.revision, algorithm: d.algorithm, total: d.strokes.length,
        paint: paint.length, allVisibleStrokes: paint.every(s => s.kind === 'fillBrush' && (s.points?.length || s.curve)),
        unmaskedFine: paint.filter(s => s.masked === false).length, byRole,
        meanAbsoluteError: error / (actual.width * actual.height * 3),
      };
    });
    await page.locator('#drawing').screenshot({ path: 'test-results/human-final.png' });
    assert.equal(result.revision, 15);
    assert.equal(result.algorithm, 'multiscale-structure-residual-brushwork');
    assert(result.allVisibleStrokes);
    assert(result.paint < 15_000, 'planner regressed to fragmented coverage');
    assert(result.byRole.base.averageWidth > result.byRole.detail.averageWidth * 2, 'underpainting is not materially broader');
    assert.equal(result.byRole.detail.short, 0, 'detail stage contains dab-like fragments');
    assert(result.unmaskedFine > 0, 'fine edges still rely entirely on region masks');
    assert(result.meanAbsoluteError < 10.5, 'final reconstruction lost too much source colour or coverage');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
