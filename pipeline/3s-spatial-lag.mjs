// Stage 3s — joint model selection over
//     tau0    : lag at the harbour mouth (min)
//     slope   : extra lag per km travelled up-channel (min/km)
//     cloudMax: scene-quality cut (5% vs 20%)
// scored by exact leave-one-out IoU, with a NESTED split-half estimate.
//
// Fairness: every candidate is scored on ONE FIXED reference pixel set — the
// harbour intertidal under the round-2 shipped model (tau0=80, slope=0). If each
// candidate were scored on its own intertidal set the comparison would be
// apples-to-oranges, because more lag produces more intertidal pixels.
import fs from 'fs';
import path from 'path';
import { NPIX, dirs, CLS_INTERTIDAL, CLS_SUBTIDAL } from './lib/config.mjs';
import { harbourMask } from './lib/regions.mjs';
import { geodesicDistanceKm, oceanSeed } from './lib/geodesic.mjs';
import { loadPlanes, makeBins, runFit, iouStats } from './lib/fitrun.mjs';

const SUB = +(process.env.SUBSAMPLE || 3);
const { scenes, n, planes, vplanes } = loadPlanes();
console.log(`${n} scenes loaded, cloud range ${Math.min(...scenes.map(s => s.cloud))}..${Math.max(...scenes.map(s => s.cloud))}%`);

const hm = harbourMask();

// ---- reference classes + along-channel distance, from the baseline model ----
const allIdx = Int32Array.from({ length: NPIX }, (_, i) => i);
const flat = new Int32Array(NPIX).fill(0);
const base = makeBins(scenes, new Float32Array(NPIX), allIdx, 80, 0);
console.log('fitting baseline (tau0=80, slope=0) for the reference class map...');
const baseFit = runFit({ pixelIdx: allIdx, planes, vplanes, n, binOf: base.binOf, orders: base.orders, tidesPerBin: base.tidesPerBin, wantMaps: true });
const refCls = baseFit.cls;

const water = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) water[i] = (refCls[i] === CLS_SUBTIDAL || refCls[i] === CLS_INTERTIDAL) ? 1 : 0;
console.log('computing along-channel distance from the open sea...');
const dist = geodesicDistanceKm(water, oceanSeed(water, hm));
{
  let mx = 0, unreach = 0, nw = 0;
  for (let i = 0; i < NPIX; i++) if (water[i]) { nw++; if (!Number.isFinite(dist[i])) unreach++; else if (dist[i] > mx) mx = dist[i]; }
  console.log(`  water px ${nw}, unreachable ${unreach}, max along-channel distance ${mx.toFixed(1)} km`);
}
fs.writeFileSync(path.join(dirs.out, 'alongchannel.bin'), Buffer.from(dist.buffer));

// ---- fixed reference pixel set ----
const ref = [];
for (let i = 0; i < NPIX; i++) if (hm[i] && refCls[i] === CLS_INTERTIDAL) ref.push(i);
const REF = Int32Array.from(ref.filter((_, k) => k % SUB === 0));
console.log(`reference intertidal set: ${ref.length} px, scoring on ${REF.length} (1/${SUB})`);
const refClsSub = new Uint8Array(REF.length).fill(CLS_INTERTIDAL);

// ---- scene subsets by cloud ----
const cloudSets = { 20: scenes.map((_, j) => j), 5: scenes.map((s, j) => (s.cloud < 5 ? j : -1)).filter(j => j >= 0) };
console.log(`cloud<20%: ${cloudSets[20].length} scenes;  cloud<5%: ${cloudSets[5].length} scenes`);

function subsetPlanes(idx) {
  return { p: idx.map(j => planes[j]), v: idx.map(j => vplanes[j]), s: idx.map(j => scenes[j]) };
}

/** score one candidate; scoreOn = Set of positions within the subset, or null */
function evaluate(cloudMax, tau0, slope, scoreOn) {
  const idx = cloudSets[cloudMax];
  const { p, v, s } = subsetPlanes(idx);
  const nn = idx.length;
  const bins = makeBins(s, dist, REF, tau0, slope);
  const r = runFit({ pixelIdx: REF, planes: p, vplanes: v, n: nn, binOf: bins.binOf, orders: bins.orders, tidesPerBin: bins.tidesPerBin, refClass: refClsSub });
  const st = iouStats(r.tp, r.fp, r.fn, r.tn, scoreOn);
  return { meanIoU: st.meanIoU, meanAgree: st.meanAgree, nScenes: nn, nBins: bins.bins.length };
}

const TAU0 = [0, 20, 40, 60, 80, 100];
const SLOPE = [0, 1, 2, 3, 4, 6, 8];
const grid = [];
for (const cloudMax of [20, 5]) {
  console.log(`\n=== cloud < ${cloudMax}% (${cloudSets[cloudMax].length} scenes) ===`);
  console.log('  tau0\\slope ' + SLOPE.map(s => String(s).padStart(7)).join(''));
  for (const tau0 of TAU0) {
    const row = [];
    for (const slope of SLOPE) {
      const r = evaluate(cloudMax, tau0, slope, null);
      grid.push({ cloudMax, tau0, slope, meanIoU: +r.meanIoU.toFixed(4), meanAgree: +r.meanAgree.toFixed(2), nScenes: r.nScenes });
      row.push(r.meanIoU.toFixed(4).padStart(7));
    }
    console.log(`  ${String(tau0).padStart(4)}      ` + row.join(''));
  }
}
const best = [...grid].sort((a, b) => b.meanIoU - a.meanIoU)[0];
console.log(`\nselection winner: cloud<${best.cloudMax}%, tau0=${best.tau0} min, slope=${best.slope} min/km, meanIoU ${best.meanIoU} (OPTIMISTIC)`);
const bestUniform = [...grid].filter(g => g.slope === 0).sort((a, b) => b.meanIoU - a.meanIoU)[0];
console.log(`best UNIFORM lag (slope=0):  cloud<${bestUniform.cloudMax}%, tau0=${bestUniform.tau0}, meanIoU ${bestUniform.meanIoU}`);
console.log(`=> spatial lag gains ${(best.meanIoU - bestUniform.meanIoU).toFixed(4)} IoU on the selection metric`);

// ---- nested split-half over the winning cloud set ----
const idx = cloudSets[best.cloudMax];
const { s: sSub } = subsetPlanes(idx);
const t0 = sSub.map(s => s.tide);
const rank = sSub.map((_, j) => j).sort((a, b) => t0[a] - t0[b]);
const A = new Set(rank.filter((_, k) => k % 2 === 0));
const B = new Set(rank.filter((_, k) => k % 2 === 1));
console.log(`\nnested split-half on the cloud<${best.cloudMax}% set: A=${A.size}, B=${B.size} scenes`);
const nested = [];
for (const [sel, ev, label] of [[A, B, 'select on A -> score B'], [B, A, 'select on B -> score A']]) {
  let bs = null;
  for (const tau0 of TAU0) for (const slope of SLOPE) {
    const r = evaluate(best.cloudMax, tau0, slope, sel);
    if (!bs || r.meanIoU > bs.meanIoU) bs = { tau0, slope, meanIoU: r.meanIoU };
  }
  const held = evaluate(best.cloudMax, bs.tau0, bs.slope, ev);
  // uniform-lag counterpart, selected the same way, for an honest A/B
  let bu = null;
  for (const tau0 of TAU0) {
    const r = evaluate(best.cloudMax, tau0, 0, sel);
    if (!bu || r.meanIoU > bu.meanIoU) bu = { tau0, slope: 0, meanIoU: r.meanIoU };
  }
  const heldU = evaluate(best.cloudMax, bu.tau0, 0, ev);
  nested.push({
    label, chosen: bs, heldOutIoU: +held.meanIoU.toFixed(4),
    chosenUniform: bu, heldOutIoUUniform: +heldU.meanIoU.toFixed(4),
  });
  console.log(`  ${label}: spatial tau0=${bs.tau0} slope=${bs.slope} -> held-out ${held.meanIoU.toFixed(4)}  |  uniform tau0=${bu.tau0} -> held-out ${heldU.meanIoU.toFixed(4)}`);
}
const honest = (nested[0].heldOutIoU + nested[1].heldOutIoU) / 2;
const honestU = (nested[0].heldOutIoUUniform + nested[1].heldOutIoUUniform) / 2;
console.log(`\nHONEST nested IoU — spatial lag ${honest.toFixed(4)}   uniform lag ${honestU.toFixed(4)}   gain ${(honest - honestU).toFixed(4)}`);

fs.writeFileSync(path.join(dirs.out, 'spatial-lag-selection.json'), JSON.stringify({
  subsample: SUB, referencePx: ref.length, scoredPx: REF.length,
  cloudSetSizes: { 5: cloudSets[5].length, 20: cloudSets[20].length },
  grid, selectionWinner: best, bestUniform,
  nested, honestNestedIoU: +honest.toFixed(4), honestNestedIoUUniform: +honestU.toFixed(4),
  spatialGainHonest: +(honest - honestU).toFixed(4),
}, null, 2));
console.log('wrote out/spatial-lag-selection.json');
