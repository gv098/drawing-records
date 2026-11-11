import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokeSeconds, liftSeconds } from '../src/playback-timing.js';

const data = { width: 640, height: 1000, regions: [[0x334455], [0xffcc88]] };
const stroke = { layer: 'paint', paintPass: 'finish', length: 1, region: 0 };

test('short strokes still have time to land, draw and lift at 1x', () => {
  for (const role of ['sketch', 'ink', 'base', 'tone', 'detail', 'finish']) {
    const s = { ...stroke, layer: ['sketch', 'ink'].includes(role) ? role : 'paint', paintPass: role };
    assert(strokeSeconds(s, data) >= .3, role);
    assert(liftSeconds(s, s, 0, data) >= .15, role);
    assert(strokeSeconds(s, data) + liftSeconds(s, s, 0, data) >= .5, role);
  }
  assert(strokeSeconds(stroke, data) >= .6, 'highlights need deliberate marks');
});
test('longer movement, changing colour and changing phase take additional time', () => {
  assert(strokeSeconds({ ...stroke, length: 120 }, data) > strokeSeconds(stroke, data));
  const lift = liftSeconds(stroke, stroke, 0, data);
  assert(liftSeconds(stroke, stroke, 400, data) > lift);
  assert(liftSeconds(stroke, { ...stroke, region: 1 }, 0, data) > lift);
  assert(liftSeconds(stroke, { ...stroke, paintPass: 'base' }, 0, data) > lift);
});
test('resizing an image preserves timing; 4x and 16x share the same baseline', () => {
  const larger = { ...data, width: 1280, height: 2000 };
  assert.equal(strokeSeconds({ ...stroke, length: 2 }, larger), strokeSeconds(stroke, data));
  assert.equal(liftSeconds(stroke, stroke, 200, larger), liftSeconds(stroke, stroke, 100, data));
  for (const rate of [4, 16]) {
    assert.equal(strokeSeconds(stroke, data, rate) * rate, strokeSeconds(stroke, data));
    assert.equal(liftSeconds(stroke, stroke, 100, data, rate) * rate, liftSeconds(stroke, stroke, 100, data));
  }
  assert.equal(liftSeconds(stroke, stroke, 400, data, 64), 0);
});
