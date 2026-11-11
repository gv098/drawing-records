// A simulated drawing rhythm, not a measurement of any particular artist.
// Normalize image distances so resizing the same image does not change pace.
const pace = {
  sketch: { settle: .38, velocity: 300 },
  ink: { settle: .45, velocity: 200 },
  base: { settle: .32, velocity: 300 },
  tone: { settle: .42, velocity: 260 },
  detail: { settle: .5, velocity: 230 },
  finish: { settle: .6, velocity: 190 },
};
const distanceScale = data => 1000 / Math.max(1, data.width, data.height);
const pass = stroke => stroke.layer === 'paint'
  ? (pace[stroke.paintPass] ? stroke.paintPass : stroke.phase === 2 ? 'base' : 'detail')
  : stroke.layer;

export function strokeSeconds(stroke, data, rate = 1) {
  const rhythm = pace[pass(stroke)] || pace.detail;
  return (rhythm.settle + Math.max(0, stroke.length) * distanceScale(data) / rhythm.velocity) / rate;
}

export function liftSeconds(stroke, next, distance, data, rate = 1) {
  // Fast replay intentionally omits pen-up waits; all paint strokes remain.
  if (rate >= 64) return 0;
  const changeColor = data.regions[stroke.region][0] !== data.regions[next.region][0];
  const changePass = pass(stroke) !== pass(next);
  const travel = Math.min(.8, Math.max(0, distance) * distanceScale(data) / 600);
  return (.18 + travel + (changeColor ? .3 : 0) + (changePass ? .35 : 0)) / rate;
}
