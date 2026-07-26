// Stage 3z — joint model selection (NDWI threshold rule x tidal lag tau) with a
// NESTED estimate of accuracy.
//
// Selecting tau by maximising leave-one-out IoU and then reporting that same
// IoU is self-flattery. So: scenes are split into two halves by tide rank
// (even/odd). tau is chosen on one half and the resulting model is scored on
// the other, and vice versa. The reported "honest" IoU is the mean of the two
// out-of-selection scores.
import fs from 'fs'; import path from 'path';
import { NPIX, dirs, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL, CLS_NODATA, MIN_VALID_SCENES } from './lib/config.mjs';
import { readComposite } from './2b-composite.mjs';
import { harbourMask } from './lib/regions.mjs';
import { newPlane, setBit, ndwiOf, grayFor } from './lib/raster.mjs';
import { extrema } from './lib/tide.mjs';
import { fitHarmonic } from './lib/harmonic.mjs';

const H = fitHarmonic(extrema);
const SUB = +(process.env.SUBSAMPLE || 4);
const base = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
const exp = JSON.parse(fs.readFileSync(path.join(dirs.out, 'threshold-experiment.json'), 'utf8'));
const N = base.length;

const hm = harbourMask();
const hidx = []; for (let i = 0; i < NPIX; i++) if (hm[i]) hidx.push(i);
const HIDX = Int32Array.from(hidx);

// threshold rules, indexed in scenes.json order (== tide order at tau=0)
const otsuFrame = exp.otsuFrame, medFrame = exp.medianFrame;
const RULES = {
  'global-otsu-129': base.map(() => medFrame),
  'per-scene-frame-otsu': otsuFrame.slice(),
};

const bit = (p, i) => (p[i >>> 5] >>> (i & 31)) & 1;
const maskCache = new Map();
function masksFor(ruleName) {
  if (maskCache.has(ruleName)) return maskCache.get(ruleName);
  const thr = RULES[ruleName], water = [], valids = [];
  for (let j = 0; j < N; j++) {
    const { gray, valid } = readComposite(base[j].id);
    const wp = newPlane();
    for (let t = 0; t < HIDX.length; t++) { const i = HIDX[t]; if (bit(valid, i) && gray[i] > thr[j]) setBit(wp, i); }
    water.push(wp); valids.push(Uint32Array.from(valid));
  }
  const v = { water, valids };
  maskCache.set(ruleName, v);
  return v;
}

/** Fit + leave-one-out scoring. `scoreOn` limits which scenes are scored. */
function run(ruleName, tauMin, scoreOn) {
  const { water, valids } = masksFor(ruleName);
  const teff = base.map(s => H(Date.parse(s.datetime) - tauMin * 60000));
  const ord = base.map((_, j) => j).sort((a, b) => teff[a] - teff[b]);
  const n = ord.length, tides = ord.map(j => teff[j]);
  const W = ord.map(j => water[j]), V = ord.map(j => valids[j]);
  const fitOn = (idx, exclude) => {
    const cls = new Uint8Array(idx.length), h = new Float32Array(idx.length);
    for (let t = 0; t < idx.length; t++) {
      const i = idx[t];
      let Wn = 0, Vn = 0;
      for (let j = 0; j < n; j++) { if (j === exclude) continue; const v = bit(V[j], i); Vn += v; Wn += v & bit(W[j], i); }
      if (Vn < MIN_VALID_SCENES) { cls[t] = CLS_NODATA; continue; }
      let a = 0, b2 = 0, best = 0x7fffffff, kLo = 0, kHi = 0;
      for (let k = 0; k <= n; k++) {
        if (k === exclude) continue;
        const e = 2 * a - b2 + Vn - Wn;
        if (e < best) { best = e; kLo = kHi = k; } else if (e === best) kHi = k;
        if (k < n) { const v = bit(V[k], i); b2 += v; a += v & bit(W[k], i); }
      }
      const k = (kLo + kHi) >> 1;
      if (k === 0) { cls[t] = CLS_SUBTIDAL; h[t] = -Infinity; }
      else if (k === n) { cls[t] = CLS_SUPRATIDAL; h[t] = Infinity; }
      else { cls[t] = CLS_INTERTIDAL; h[t] = (tides[k - 1] + tides[k]) / 2; }
    }
    return { cls, h };
  };
  const full = fitOn(HIDX, -1);
  const inter = []; for (let t = 0; t < HIDX.length; t++) if (full.cls[t] === CLS_INTERTIDAL) inter.push(HIDX[t]);
  const INTER = Int32Array.from(inter.filter((_, k) => k % SUB === 0));
  const ious = [];
  for (let p = 0; p < n; p++) {
    if (scoreOn && !scoreOn.has(ord[p])) continue;
    const loo = fitOn(INTER, p);
    let tp = 0, fp = 0, fn = 0;
    for (let t = 0; t < INTER.length; t++) {
      const i = INTER[t];
      if (!bit(V[p], i)) continue;
      const obs = bit(W[p], i);
      const c = loo.cls[t], pr = (c === CLS_SUBTIDAL || (c === CLS_INTERTIDAL && loo.h[t] <= tides[p])) ? 1 : 0;
      if (obs && pr) tp++; else if (!obs && pr) fp++; else if (obs && !pr) fn++;
    }
    ious.push(tp + fp + fn ? tp / (tp + fp + fn) : 1);
  }
  return { meanIoU: ious.reduce((a, b) => a + b, 0) / ious.length, intertidalPx: inter.length };
}

const TAUS = [0, 30, 45, 60, 70, 80, 90, 100, 110, 120];
const grid = [];
console.log('joint grid (all 35 scenes scored — this is the SELECTION metric, optimistic)');
console.log('  rule                    tau   meanIoU   intertidalPx');
for (const rule of Object.keys(RULES)) for (const tau of TAUS) {
  const r = run(rule, tau, null);
  grid.push({ rule, tau, meanIoU: +r.meanIoU.toFixed(4), intertidalPx: r.intertidalPx });
  console.log(`  ${rule.padEnd(22)} ${String(tau).padStart(4)}   ${r.meanIoU.toFixed(4)}   ${r.intertidalPx}`);
}
grid.sort((a, b) => b.meanIoU - a.meanIoU);
const bestSel = grid[0];
console.log(`\nselection winner: ${bestSel.rule}, tau ${bestSel.tau} min, meanIoU ${bestSel.meanIoU} (optimistic)`);

// ---- nested split-half -----------------------------------------------------
// order by tau=0 tide, then alternate into halves so both cover the tide range
const t0 = base.map(s => H(Date.parse(s.datetime)));
const rank = base.map((_, j) => j).sort((a, b) => t0[a] - t0[b]);
const A = new Set(rank.filter((_, k) => k % 2 === 0));
const B = new Set(rank.filter((_, k) => k % 2 === 1));
console.log(`\nnested split-half: A=${A.size} scenes, B=${B.size} scenes`);
const nested = [];
for (const [selSet, evalSet, label] of [[A, B, 'select on A -> score B'], [B, A, 'select on B -> score A']]) {
  let best = null;
  for (const rule of Object.keys(RULES)) for (const tau of TAUS) {
    const r = run(rule, tau, selSet);
    if (!best || r.meanIoU > best.meanIoU) best = { rule, tau, meanIoU: r.meanIoU };
  }
  const scored = run(best.rule, best.tau, evalSet);
  nested.push({ label, chosenRule: best.rule, chosenTau: best.tau, selectionIoU: +best.meanIoU.toFixed(4), heldOutIoU: +scored.meanIoU.toFixed(4) });
  console.log(`  ${label}: chose ${best.rule} tau=${best.tau} (sel IoU ${best.meanIoU.toFixed(4)}) -> held-out IoU ${scored.meanIoU.toFixed(4)}`);
}
const honest = (nested[0].heldOutIoU + nested[1].heldOutIoU) / 2;
console.log(`\nHONEST (nested) mean IoU = ${honest.toFixed(4)}`);

fs.writeFileSync(path.join(dirs.out, 'model-selection.json'), JSON.stringify({
  subsample: SUB, grid, selectionWinner: bestSel, nested, honestNestedIoU: +honest.toFixed(4),
}, null, 2));
console.log('wrote out/model-selection.json');
