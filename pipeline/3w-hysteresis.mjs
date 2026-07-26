// Stage 3w — quantify the ebb/flood asymmetry that motivates the effective-tide
// lag (see lib/config.mjs TIDE_LAG_MIN and 3z-select.mjs).
//
// For each scene: the fraction of the reference intertidal band reading as
// water, against the UNLAGGED gauge tide. A linear trend in tide is removed and
// the residual is correlated against the rate of tide change, cloud cover and
// season. Writes out/hysteresis.json.
import fs from 'fs'; import path from 'path';
import { NPIX, dirs, CLS_INTERTIDAL } from './lib/config.mjs';
import { readComposite } from './2b-composite.mjs';
import { harbourMask } from './lib/regions.mjs';
import { extrema } from './lib/tide.mjs';
import { fitHarmonic } from './lib/harmonic.mjs';

const H = fitHarmonic(extrema);
const THR = +(process.env.THR || 129);
const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
const fit = fs.readFileSync(path.join(dirs.out, 'fit.bin'));
const classes = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 2, NPIX);
const hm = harbourMask();
const inter = []; for (let i = 0; i < NPIX; i++) if (hm[i] && classes[i] === CLS_INTERTIDAL) inter.push(i);
const I = Int32Array.from(inter);

const rows = [];
for (const s of scenes) {
  const { gray } = readComposite(s.id);
  let wf = 0; for (let t = 0; t < I.length; t++) if (gray[I[t]] > THR) wf++;
  const ms = Date.parse(s.datetime);
  rows.push({
    id: s.id, date: s.datetime.slice(0, 10), tideGauge: s.tideGauge, tideEff: s.tide,
    waterFrac: +(wf / I.length).toFixed(4),
    rateMPerHour: +(H(ms + 1800000) - H(ms - 1800000)).toFixed(4),
    cloud: s.cloud,
  });
}
// detrend against the unlagged gauge tide
const n = rows.length;
const mx = rows.reduce((a, r) => a + r.tideGauge, 0) / n, my = rows.reduce((a, r) => a + r.waterFrac, 0) / n;
let sxy = 0, sxx = 0; for (const r of rows) { sxy += (r.tideGauge - mx) * (r.waterFrac - my); sxx += (r.tideGauge - mx) ** 2; }
const b = sxy / sxx, a = my - b * mx;
for (const r of rows) r.residual = +(r.waterFrac - (a + b * r.tideGauge)).toFixed(4);

const corr = (f, g) => {
  const A = rows.map(f), B = rows.map(g);
  const ma = A.reduce((x, y) => x + y, 0) / A.length, mb = B.reduce((x, y) => x + y, 0) / B.length;
  let p = 0, q = 0, s = 0;
  for (let i = 0; i < A.length; i++) { p += (A[i] - ma) * (B[i] - mb); q += (A[i] - ma) ** 2; s += (B[i] - mb) ** 2; }
  return p / Math.sqrt(q * s);
};
const summerness = (r) => { const d = new Date(r.date + 'T00:00:00Z'); const doy = (d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000; return Math.cos(2 * Math.PI * (doy - 355) / 365.25); };
const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
const flood = rows.filter(r => r.rateMPerHour > 0), ebb = rows.filter(r => r.rateMPerHour <= 0);

// the clearest single example: among flood/ebb pairs at effectively the same
// gauge tide (within 0.05 m), the pair that looks most different
let pair = null;
for (const f of flood) for (const e of ebb) {
  const d = Math.abs(f.tideGauge - e.tideGauge);
  if (d > 0.05) continue;
  const gap = Math.abs(f.waterFrac - e.waterFrac);
  if (!pair || gap > pair.gap) pair = { d, gap, flood: f, ebb: e };
}

const out = {
  thresholdGray: THR, referenceIntertidalPx: I.length,
  rTideRate: +corr(r => r.residual, r => r.rateMPerHour).toFixed(3),
  rAbsTideRate: +corr(r => r.residual, r => Math.abs(r.rateMPerHour)).toFixed(3),
  rCloud: +corr(r => r.residual, r => r.cloud).toFixed(3),
  rSummerness: +corr(r => r.residual, summerness).toFixed(3),
  floodCount: flood.length, ebbCount: ebb.length,
  floodMeanResidualPct: +(100 * mean(flood.map(r => r.residual))).toFixed(1),
  ebbMeanResidualPct: +(100 * mean(ebb.map(r => r.residual))).toFixed(1),
  matchedPair: pair && {
    gaugeTideDiff: +pair.d.toFixed(3),
    flood: { date: pair.flood.date, tide: pair.flood.tideGauge, waterFracPct: +(100 * pair.flood.waterFrac).toFixed(1) },
    ebb: { date: pair.ebb.date, tide: pair.ebb.tideGauge, waterFracPct: +(100 * pair.ebb.waterFrac).toFixed(1) },
  },
  rows,
};
fs.writeFileSync(path.join(dirs.out, 'hysteresis.json'), JSON.stringify(out, null, 2));
console.log(`r(residual, tide rate) = ${out.rTideRate}   r(cloud) = ${out.rCloud}   r(summerness) = ${out.rSummerness}`);
console.log(`FLOOD n=${out.floodCount} mean residual ${out.floodMeanResidualPct}%   EBB n=${out.ebbCount} mean residual ${out.ebbMeanResidualPct}%`);
console.log(`matched pair: ${out.matchedPair.flood.date} (flood, ${out.matchedPair.flood.tide} m) ${out.matchedPair.flood.waterFracPct}% water  vs  ${out.matchedPair.ebb.date} (ebb, ${out.matchedPair.ebb.tide} m) ${out.matchedPair.ebb.waterFracPct}%`);
console.log('wrote out/hysteresis.json');
