// Stage 3t — does ADDING cloudier scenes to the FIT help?
// The naive comparison is confounded: a cloud<20% model is scored on 107 extra
// hard scenes it would never be asked about otherwise. The fair question is
// whether adding them to the TRAINING set improves prediction of the SAME
// clean scenes. So both models are scored on the identical cloud<5% scene set.
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
const baseFit = runFit({ pixelIdx: allIdx, planes, vplanes, n, binOf: base.binOf, orders: base.orders, tidesPerBin: base.tidesPerBin, wantMaps: true });
const water = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) water[i] = (baseFit.cls[i] === CLS_SUBTIDAL || baseFit.cls[i] === CLS_INTERTIDAL) ? 1 : 0;
const dist = geodesicDistanceKm(water, oceanSeed(water, hm));
const ref = []; for (let i = 0; i < NPIX; i++) if (hm[i] && baseFit.cls[i] === CLS_INTERTIDAL) ref.push(i);
const REF = Int32Array.from(ref.filter((_, k) => k % SUB === 0));
const refSub = new Uint8Array(REF.length).fill(CLS_INTERTIDAL);

const cleanIds = new Set(scenes.filter(s => s.cloud < 5).map(s => s.id));
function run(fitSet, tau0, slope) {
  const idx = scenes.map((s, j) => j).filter(j => fitSet(scenes[j]));
  const p = idx.map(j => planes[j]), v = idx.map(j => vplanes[j]), s = idx.map(j => scenes[j]);
  const bins = makeBins(s, dist, REF, tau0, slope);
  const r = runFit({ pixelIdx: REF, planes: p, vplanes: v, n: idx.length, binOf: bins.binOf, orders: bins.orders, tidesPerBin: bins.tidesPerBin, refClass: refSub });
  // score ONLY the clean scenes, wherever they sit in this fit set
  const keep = new Set(); s.forEach((sc, j) => { if (cleanIds.has(sc.id)) keep.add(j); });
  const st = iouStats(r.tp, r.fp, r.fn, r.tn, keep);
  // banded by tide
  const bands = { '<0.75': [], '0.75-1.25': [], '1.25-1.75': [], '>=1.75': [] };
  for (const row of st.rows) {
    const t = s[row.j].tide;
    const k = t < 0.75 ? '<0.75' : t < 1.25 ? '0.75-1.25' : t < 1.75 ? '1.25-1.75' : '>=1.75';
    bands[k].push(row.iou);
  }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  return { nFit: idx.length, nScored: keep.size, meanIoU: st.meanIoU, bands: Object.fromEntries(Object.entries(bands).map(([k, a]) => [k, { n: a.length, iou: +mean(a).toFixed(4) }])) };
}

const results = [];
for (const [label, f, tau0, slope] of [
  ['fit on cloud<5% (97)', (s) => s.cloud < 5, 60, 0],
  ['fit on cloud<20% (204)', () => true, 60, 0],
  ['fit on cloud<10%', (s) => s.cloud < 10, 60, 0],
]) {
  const r = run(f, tau0, slope);
  results.push({ label, ...r });
  console.log(`${label.padEnd(24)} nFit ${String(r.nFit).padStart(3)}  scored on ${r.nScored} clean scenes  meanIoU ${r.meanIoU.toFixed(4)}`);
  console.log(`   bands: ` + Object.entries(r.bands).map(([k, v]) => `${k} ${v.iou.toFixed(3)} (n=${v.n})`).join('  '));
}
fs.writeFileSync(path.join(dirs.out, 'cloud-fair.json'), JSON.stringify(results, null, 2));
