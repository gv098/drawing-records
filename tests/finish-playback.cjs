const assert = require('node:assert/strict');
const { chromium, launchOptions } = require('../scripts/browser-runtime.cjs');

(async () => {
  const { createApp } = await import('../server/app.mjs');
  const server = await new Promise(resolve => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.appReady);
    await page.locator('#stages .stage').last().click();
    await page.waitForFunction(() => biji.playing && document.querySelector('#speed').value === '1');
    const clicked = await page.evaluate(() => {
      biji.stop(); const stage = biji.data.stages.find(s => s.role === 'finish');
      return { start: stage.start, end: stage.end, position: biji.position };
    });
    assert(clicked.position >= clicked.start && clicked.position < clicked.start + 20, 'stage button should start watching, not jump to its end');
    const results = await page.evaluate(() => {
      const stage = biji.data.stages.find(s => s.role === 'finish');
      const strokes = biji.data.strokes.slice(stage.start, stage.end);
      if (!strokes.every(s => s.kind === 'fillBrush')) throw Error('Finish contains whole-region fills');
      biji.seek(stage.start);
      const initialPose = biji.camera.pose;
      let previousIndex = biji.position, previousPixels = null, visibleGrowthFrames = 0, partialFrames = 0, maxPerFrame = 0;
      const context = document.querySelector('#drawing').getContext('2d');
      for (let frame = 0; frame < 180; frame++) {
        biji.step(1 / 60);
        maxPerFrame = Math.max(maxPerFrame, biji.position - previousIndex);
        const s = biji.data.strokes[biji.position], center = biji.pointAt(s, s.length / 2);
        const pixels = context.getImageData(Math.floor(center[0]) - 20, Math.floor(center[1]) - 20, 40, 40).data;
        if (biji.position === previousIndex && biji.fraction > 0 && biji.fraction < 1) {
          partialFrames++;
          if (previousPixels && pixels.some((v, i) => v !== previousPixels[i])) visibleGrowthFrames++;
        }
        previousIndex = biji.position; previousPixels = pixels;
      }
      if (maxPerFrame > 1) throw Error('Observation batched multiple strokes into one frame');
      if (partialFrames < 60 || visibleGrowthFrames < 3) throw Error('Missing visible partial-stroke growth');
      const observedCompleted = biji.position - stage.start;
      const beforePause = document.querySelector('#drawing').toDataURL(); biji.stop();
      if (document.querySelector('#drawing').toDataURL() !== beforePause) throw Error('Pause changes current partial stroke');
      biji.seek(stage.start);
      document.querySelector('#speed').value = '1024';
      document.querySelector('#speed').dispatchEvent(new Event('change'));
      for (let i = 0; i < 180; i++) biji.step(1 / 60);
      const fastCompleted = biji.position - stage.start;
      if (fastCompleted <= observedCompleted * 10) throw Error('Fast playback was throttled by observation mode');
      if (JSON.stringify(biji.camera.pose) !== JSON.stringify(initialPose)) throw Error('Playback moved camera');
      return { finishStrokes: strokes.length, partialFrames, visibleGrowthFrames, maxPerFrame, observedCompleted, fastCompleted, pauseStable: true, fixedCamera: true };
    });
    assert.deepEqual(errors, []);
    console.log({ stageStartsAtBeginning: true, ...results, errors });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
