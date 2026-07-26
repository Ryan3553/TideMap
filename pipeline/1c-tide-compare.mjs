// Stage 1c — is the shared tide module better than the local 30-constituent fit?
//
// Ground truth = the LINZ tabulated extrema themselves (heights AND times).
// Both models are scored against every tabulated turning point 2023-2027.
// At the scene instants there is no ground truth, so only the three-way
// DISAGREEMENT is reported there.
import fs from 'fs'; import path from 'path';
import { dirs } from './lib/config.mjs';
import { extrema, tideAt } from './lib/tide.mjs';
import { fitHarmonic } from './lib/harmonic.mjs';
import { predict } from '../tide/tauranga-tide.js';

const mine = fitHarmonic(extrema);
const shared = (ms) => predict(new Date(ms));

const stats = (e) => {
  const n = e.length, m = e.reduce((a, b) => a + b, 0) / n;
  return { n, bias: +m.toFixed(4), rmse: +Math.sqrt(e.reduce((a, b) => a + b * b, 0) / n).toFixed(4), maxAbs: +Math.max(...e.map(Math.abs)).toFixed(4) };
};

// --- A. height at every tabulated extremum ---
const eMine = extrema.map(e => mine(e.t) - e.h);
const eShared = extrema.map(e => shared(e.t) - e.h);
console.log(`A. HEIGHT at ${extrema.length} LINZ tabulated extrema (ground truth, 2023-2027)`);
console.log(`   local 30-constituent fit : rmse ${stats(eMine).rmse} m  max ${stats(eMine).maxAbs} m`);
console.log(`   shared tide module       : rmse ${stats(eShared).rmse} m  max ${stats(eShared).maxAbs} m`);
console.log(`   (LINZ heights are rounded to 0.1 m -> ~0.029 m quantisation floor)`);

// --- B. TIMING of turning points ---
// For each tabulated extremum, find the model's nearest turning point.
function turningNear(f, t0) {
  const step = 60000; // 1 min
  let best = null;
  for (let dt = -3 * 3600000; dt <= 3 * 3600000; dt += step) {
    const t = t0 + dt;
    const d1 = f(t + step) - f(t), d0 = f(t) - f(t - step);
    if (d0 === 0) continue;
    if ((d0 > 0 && d1 <= 0) || (d0 < 0 && d1 >= 0)) {
      if (!best || Math.abs(dt) < Math.abs(best - t0)) best = t;
    }
  }
  return best;
}
const timing = { mine: [], shared: [] };
const sample = extrema.filter((_, i) => i % 7 === 0); // every 7th, ~600 points
for (const e of sample) {
  for (const [k, f] of [['mine', mine], ['shared', shared]]) {
    const t = turningNear(f, e.t);
    if (t != null) timing[k].push((t - e.t) / 60000);
  }
}
const tstat = (a) => ({ n: a.length, meanAbs: +(a.reduce((x, y) => x + Math.abs(y), 0) / a.length).toFixed(2), maxAbs: +Math.max(...a.map(Math.abs)).toFixed(2) });
console.log(`\nB. TIMING of turning points (${sample.length} sampled extrema)`);
console.log(`   local fit          : mean |err| ${tstat(timing.mine).meanAbs} min  max ${tstat(timing.mine).maxAbs} min`);
console.log(`   shared tide module : mean |err| ${tstat(timing.shared).meanAbs} min  max ${tstat(timing.shared).maxAbs} min`);

// --- C. three-way disagreement at the scene instants (no ground truth) ---
const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
const rows = scenes.map(s => {
  const ms = Date.parse(s.datetime);
  return { date: s.datetime.slice(0, 10), mine: mine(ms), shared: shared(ms), cos: tideAt(ms) };
});
const withCos = rows.filter(r => r.cos != null);
console.log(`\nC. DISAGREEMENT at ${rows.length} scene instants (no ground truth here)`);
console.log(`   shared vs local fit    : rmse ${stats(rows.map(r => r.shared - r.mine)).rmse} m  max ${stats(rows.map(r => r.shared - r.mine)).maxAbs} m`);
if (withCos.length) {
  console.log(`   shared vs cosine-interp: rmse ${stats(withCos.map(r => r.shared - r.cos)).rmse} m  max ${stats(withCos.map(r => r.shared - r.cos)).maxAbs} m`);
  console.log(`   local  vs cosine-interp: rmse ${stats(withCos.map(r => r.mine - r.cos)).rmse} m  max ${stats(withCos.map(r => r.mine - r.cos)).maxAbs} m`);
}

const out = {
  heightAtExtrema: { local: stats(eMine), shared: stats(eShared) },
  turningPointTiming: { local: tstat(timing.mine), shared: tstat(timing.shared) },
  sceneInstantDisagreement: {
    sharedVsLocal: stats(rows.map(r => r.shared - r.mine)),
    sharedVsCosine: withCos.length ? stats(withCos.map(r => r.shared - r.cos)) : null,
    localVsCosine: withCos.length ? stats(withCos.map(r => r.mine - r.cos)) : null,
  },
  verdict: null,
};
out.verdict = out.heightAtExtrema.shared.rmse <= out.heightAtExtrema.local.rmse
  && out.turningPointTiming.shared.meanAbs <= out.turningPointTiming.local.meanAbs
  ? 'shared module wins on both height and timing — adopt it'
  : 'mixed — see numbers';
console.log(`\nVERDICT: ${out.verdict}`);
fs.writeFileSync(path.join(dirs.out, 'tide-compare.json'), JSON.stringify(out, null, 2));
