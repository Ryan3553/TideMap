// Stage 3u — final parameter choice.
// Fit on ALL 204 scenes (they cost nothing in accuracy and extend the tidal
// range downward, per 3t-cloud-fair.mjs), but SCORE on the 97 cloud<5% scenes
// only, so the metric is not diluted by scenes the model is not really being
// asked about. Nested split-half over the scored scenes for the honest number.
import fs from 'fs'; import path from 'path';
import { NPIX, dirs, CLS_INTERTIDAL, CLS_SUBTIDAL } from './lib/config.mjs';
import { harbourMask } from './lib/regions.mjs';
import { geodesicDistanceKm, oceanSeed } from './lib/geodesic.mjs';
import { loadPlanes, makeBins, runFit, iouStats } from './lib/fitrun.mjs';

const SUB = 3;
const { scenes, n, planes, vplanes } = loadPlanes();
const hm = harbourMask();
const allIdx = Int32Array.from({ length: NPIX }, (_, i) => i);
const base = makeBins(scenes, new Float32Array(NPIX), allIdx, 60, 0);
const bf = runFit({ pixelIdx: allIdx, planes, vplanes, n, binOf: base.binOf, orders: base.orders, tidesPerBin: base.tidesPerBin, wantMaps: true });
const water = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) water[i] = (bf.cls[i] === CLS_SUBTIDAL || bf.cls[i] === CLS_INTERTIDAL) ? 1 : 0;
const dist = geodesicDistanceKm(water, oceanSeed(water, hm));
const ref = []; for (let i = 0; i < NPIX; i++) if (hm[i] && bf.cls[i] === CLS_INTERTIDAL) ref.push(i);
const REF = Int32Array.from(ref.filter((_, k) => k % SUB === 0));
const refSub = new Uint8Array(REF.length).fill(CLS_INTERTIDAL);
const cleanPos = new Set(); scenes.forEach((s, j) => { if (s.cloud < 5) cleanPos.add(j); });
console.log(`fit on ${n} scenes, score on ${cleanPos.size} cloud<5% scenes, ${REF.length} px`);

function evaluate(tau0, slope, keep) {
  const bins = makeBins(scenes, dist, REF, tau0, slope);
  const r = runFit({ pixelIdx: REF, planes, vplanes, n, binOf: bins.binOf, orders: bins.orders, tidesPerBin: bins.tidesPerBin, refClass: refSub });
  return iouStats(r.tp, r.fp, r.fn, r.tn, keep).meanIoU;
}
const TAU0 = [20, 30, 40, 50, 60, 70, 80], SLOPE = [0, 1, 2, 3, 4, 5, 6];
const grid = [];
console.log('  tau0\slope ' + SLOPE.map(s => String(s).padStart(7)).join(''));
for (const tau0 of TAU0) {
  const row = [];
  for (const slope of SLOPE) { const v = evaluate(tau0, slope, cleanPos); grid.push({ tau0, slope, meanIoU: +v.toFixed(4) }); row.push(v.toFixed(4).padStart(7)); }
  console.log(`  ${String(tau0).padStart(4)}      ` + row.join(''));
}
const best = [...grid].sort((a, b) => b.meanIoU - a.meanIoU)[0];
const bestU = [...grid].filter(g => g.slope === 0).sort((a, b) => b.meanIoU - a.meanIoU)[0];
console.log(`\nselection: spatial tau0=${best.tau0} slope=${best.slope} IoU ${best.meanIoU} | uniform tau0=${bestU.tau0} IoU ${bestU.meanIoU} | gain ${(best.meanIoU - bestU.meanIoU).toFixed(4)}`);

const cp = [...cleanPos].sort((a, b) => scenes[a].tide - scenes[b].tide);
const A = new Set(cp.filter((_, k) => k % 2 === 0)), B = new Set(cp.filter((_, k) => k % 2 === 1));
const nested = [];
for (const [sel, ev, label] of [[A, B, 'A->B'], [B, A, 'B->A']]) {
  let bs = null, bu = null;
  for (const tau0 of TAU0) for (const slope of SLOPE) { const v = evaluate(tau0, slope, sel); if (!bs || v > bs.v) bs = { tau0, slope, v }; }
  for (const tau0 of TAU0) { const v = evaluate(tau0, 0, sel); if (!bu || v > bu.v) bu = { tau0, slope: 0, v }; }
  const hs = evaluate(bs.tau0, bs.slope, ev), hu = evaluate(bu.tau0, 0, ev);
  nested.push({ label, spatial: bs, heldOutSpatial: +hs.toFixed(4), uniform: bu, heldOutUniform: +hu.toFixed(4) });
  console.log(`  ${label}: spatial tau0=${bs.tau0} slope=${bs.slope} -> ${hs.toFixed(4)} | uniform tau0=${bu.tau0} -> ${hu.toFixed(4)}`);
}
const hS = (nested[0].heldOutSpatial + nested[1].heldOutSpatial) / 2;
const hU = (nested[0].heldOutUniform + nested[1].heldOutUniform) / 2;
console.log(`\nHONEST nested: spatial ${hS.toFixed(4)}  uniform ${hU.toFixed(4)}  gain ${(hS - hU).toFixed(4)}`);
fs.writeFileSync(path.join(dirs.out, 'final-selection.json'), JSON.stringify({
  nFit: n, nScored: cleanPos.size, scoredPx: REF.length, grid, selectionSpatial: best, selectionUniform: bestU,
  nested, honestSpatial: +hS.toFixed(4), honestUniform: +hU.toFixed(4), honestGain: +(hS - hU).toFixed(4),
  maxAlongChannelKm: +(() => { let m = 0; for (const i of REF) if (Number.isFinite(dist[i]) && dist[i] > m) m = dist[i]; return m; })().toFixed(2),
}, null, 2));
