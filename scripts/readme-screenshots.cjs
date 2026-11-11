const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser-runtime.cjs');

// Capture the real built application with isolated browser storage.
// Run from the project root after `npm run build`.
(async () => {
  const { createApp } = await import('../server/app.mjs');
  const output = path.resolve('docs/images');
  await fs.mkdir(output, { recursive: true });
  const server = await new Promise(resolve => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.appReady && !biji.seeking);
    const snapshots = [];
    for (const [role, fraction, label] of [
      ['ink', 1, '01  线稿'],
      ['base', .32, '02  局部铺色'],
      ['base', 1, '03  底色完成'],
      ['detail', .45, '04  局部刻画'],
      ['finish', 1, '05  重绘结果'],
    ]) {
      const url = await page.evaluate(({ role, fraction }) => {
        const stage = biji.data.stages.find(s => s.role === role);
        biji.stop();
        biji.seek(Math.round(stage.start + (stage.end - stage.start) * fraction));
        return document.querySelector('#drawing').toDataURL('image/png');
      }, { role, fraction });
      snapshots.push({ label, url });
    }
    await page.locator('#refViewAll').click();
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true, animations: 'disabled' });
    const montage = await page.evaluate(async items => {
      await document.fonts.ready;
      const c = document.createElement('canvas'), ctx = c.getContext('2d');
      const card = 240, gap = 16, padding = 24, imageHeight = Math.round(216 * 1137 / 640);
      c.width = padding * 2 + card * items.length + gap * (items.length - 1);
      c.height = imageHeight + 108;
      ctx.fillStyle = '#15171d'; ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < items.length; i++) {
        const im = new Image(); im.src = items[i].url; await im.decode();
        const x = padding + i * (card + gap);
        ctx.fillStyle = '#242731'; ctx.fillRect(x, 18, card, c.height - 36);
        ctx.fillStyle = '#ded4ff'; ctx.font = '600 18px "Microsoft YaHei", sans-serif';
        ctx.fillText(items[i].label, x + 12, 49);
        ctx.drawImage(im, x + 12, 68, 216, imageHeight);
      }
      return c.toDataURL('image/png');
    }, snapshots);
    await fs.writeFile(path.join(output, 'painting-process.png'), Buffer.from(montage.split(',')[1], 'base64'));
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(origin);
    await mobile.waitForFunction(() => window.appReady && !biji.seeking);
    await mobile.locator('#showResult').click();
    await mobile.waitForFunction(() => !biji.seeking && biji.position === biji.data.strokes.length);
    await mobile.screenshot({ path: path.join(output, 'mobile.png'), animations: 'disabled' });
    if (errors.length) throw Error(errors.join('\n'));
    console.log('README screenshots saved to docs/images (desktop, mobile, painting process).');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
