const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, launchOptions } = require('../scripts/browser-runtime.cjs');

(async () => {
  const { createApp } = await import('../server/app.mjs');
  const server = await new Promise(resolve => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.appReady);
    const result = await page.evaluate(() => {
      const d = biji.data, candidates = [], seen = new Set();
      for (const stage of d.stages.filter(s => ['base', 'tone', 'detail', 'finish'].includes(s.role))) {
        let count = 0;
        for (let i = stage.start + 1; i < stage.end && count < 3; i++) {
          const s = d.strokes[i], key = stage.role + ':' + s.region;
          if (s.kind !== 'fillBrush' || d.strokes[i - 1].region !== s.region || seen.has(key)) continue;
          candidates.push(i); seen.add(key); count++;
        }
      }
      let checked = 0, maxError = 0;
      for (const index of candidates) {
        biji.seek(index);
        const s = d.strokes[index];
        for (const fraction of [.15, .45, .85]) {
          // Render the same partial stroke on a transparent paint layer first,
          // then compose paper and ink. The direct display preview must match.
          const paint = document.createElement('canvas'), expected = document.createElement('canvas');
          paint.width = expected.width = d.width; paint.height = expected.height = d.height;
          const pc = paint.getContext('2d'); pc.drawImage(biji.layers.paint, 0, 0);
          biji.renderBrush(s, pc, fraction);
          const ec = expected.getContext('2d'); ec.fillStyle = d.background || '#fff'; ec.fillRect(0, 0, d.width, d.height);
          ec.drawImage(paint, 0, 0); ec.drawImage(biji.layers.ink, 0, 0);
          biji.setFraction(fraction);
          const actual = document.querySelector('#drawing').getContext('2d').getImageData(0, 0, d.width, d.height).data;
          const reference = ec.getImageData(0, 0, d.width, d.height).data;
          for (let j = 0; j < actual.length; j++) maxError = Math.max(maxError, Math.abs(actual[j] - reference[j]));
          if (maxError > 3) throw Error(`Preview damaged the background at stroke ${index}: channel error ${maxError}`);
          const hex = '#' + d.regions[s.region][0].toString(16).padStart(6, '0').toUpperCase();
          if (document.querySelector('#nibColorHex').textContent !== hex) throw Error('Nib label does not match stroke colour');
          const beforePause = document.querySelector('#drawing').toDataURL();
          biji.stop();
          if (document.querySelector('#drawing').toDataURL() !== beforePause) throw Error('Pause changed partial stroke');
          if (document.querySelector('#hex').textContent !== hex) throw Error('Sidebar displays previous stroke colour');
          checked++;
        }
      }
      // Return to a dark base-colour stroke similar to the reported screenshot.
      const base = d.stages.find(s => s.role === 'base');
      const i = d.strokes.findIndex((s, i) => i > base.start && i < base.end && s.region === d.strokes[i - 1].region && d.regions[s.region][0] < 0x888888);
      if (i < 0) throw Error('Missing dark base-colour fixture');
      biji.seek(i + 2); biji.setFraction(.45);
      return { checked, maxChannelError: maxError, previewMatchesLayerComposition: true, pauseStable: true };
    });
    assert(result.checked >= 12);
    const label = page.locator('#nibColor');
    assert(await label.isVisible());
    const width = (await label.boundingBox()).width;
    await page.locator('#viewTools summary').click();
    await page.locator('#zoomIn').click();
    if (await label.isVisible()) assert.equal((await label.boundingBox()).width, width);
    await page.locator('#viewAll').click();
    await page.locator('#showNib').uncheck();
    assert.equal(await label.isVisible(), false);
    await page.locator('#showNib').check();
    assert(await label.isVisible());
    await page.locator('#viewTools summary').click();
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/brush-color-mobile.png', fullPage: true });
    await page.locator('#showResult').click();
    await page.waitForFunction(() => !biji.seeking && biji.position === biji.data.strokes.length);
    assert.equal(await label.isVisible(), false);
    assert.deepEqual(errors, []);
    console.log({ ...result, exactColorLabels: true, nibToggle: true, completionHidesLabel: true, errors });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
