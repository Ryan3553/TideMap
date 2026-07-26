// Stage 3x — MODEL SELECTION for the NDWI threshold.
//
// The first build used one global threshold (median of the per-scene Otsu
// values over the whole frame) and scored a mean leave-one-out IoU of 0.51,
// with low-tide scenes near zero. The observed water area inside a fixed set of
// intertidal pixels swung by 50x between scenes only 0.06 m apart in tide,
// which is a thresholding artefact, not a tidal signal. So the threshold rule
// is chosen here by measurement rather than assumption.
//
// Each candidate rule is scored by exactly the metric that matters: TRUE
// leave-one-out IoU over the harbour intertidal region.
import fs from 'fs';
import path from 'path';
import { NPIX, dirs, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL, CLS_NODATA, MIN_VALID_SCENES } from './lib/config.mjs';
import { WORDS, newPlane, setBit, ndwiOf, grayFor } from './lib/raster.mjs';
import { readComposite } from './2b-composite.mjs';
import { harbourMask } from './lib/regions.mjs';

const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
scenes.sort((a, b) => a.tide - b.tide);
const n = scenes.length, tides = scenes.map(s => s.tide);

console.log('building harbour mask...');
const hm = harbourMask();
const harbourIdx = []; for (let i = 0; i < NPIX; i++) if (hm[i]) harbourIdx.push(i);
const HIDX = Int32Array.from(harbourIdx);
console.log(`harbour polygon: ${HIDX.length} px`);

// ---- Otsu over an arbitrary index subset ---------------------------------
function otsuOn(gray, validPlane, idx) {
  const hist = new Float64Array(256);
  let total = 0;
  for (let t = 0; t < idx.length; t++) {
    const i = idx[t];
    if (((validPlane[i >>> 5] >>> (i & 31)) & 1) === 0) continue;
    hist[gray[i]]++; total++;
  }
  if (!total) return 128;
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 128, bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const bv = wB * wF * (mB - mF) * (mB - mF);
    if (bv > bestVar) { bestVar = bv; best = v; }
  }
  return best;
}

// ---- load composites once, compute both Otsu families --------------------
console.log('scanning composites for per-scene Otsu (frame and harbour)...');
const otsuFrame = [], otsuHarbour = [];
const allIdx = Int32Array.from({ length: NPIX }, (_, i) => i);
for (let j = 0; j < n; j++) {
  const { gray, valid } = readComposite(scenes[j].id);
  otsuFrame.push(otsuOn(gray, valid, allIdx));
  otsuHarbour.push(otsuOn(gray, valid, HIDX));
  process.stdout.write(`\r  ${j + 1}/${n}  frame ${otsuFrame[j]}  harbour ${otsuHarbour[j]}   `);
}
console.log('');
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(`  frame   Otsu: min ${Math.min(...otsuFrame)} med ${med(otsuFrame)} max ${Math.max(...otsuFrame)}  (NDWI ${ndwiOf(Math.min(...otsuFrame)).toFixed(2)}..${ndwiOf(Math.max(...otsuFrame)).toFixed(2)})`);
console.log(`  harbour Otsu: min ${Math.min(...otsuHarbour)} med ${med(otsuHarbour)} max ${Math.max(...otsuHarbour)}  (NDWI ${ndwiOf(Math.min(...otsuHarbour)).toFixed(2)}..${ndwiOf(Math.max(...otsuHarbour)).toFixed(2)})`);

// ---- candidate rules ------------------------------------------------------
const RULES = {
  'global-median-frame-otsu': () => scenes.map(() => med(otsuFrame)),
  'fixed-ndwi-0': () => scenes.map(() => grayFor(0)),
  'per-scene-frame-otsu': () => otsuFrame.slice(),
  'per-scene-harbour-otsu': () => otsuHarbour.slice(),
  'global-median-harbour-otsu': () => scenes.map(() => med(otsuHarbour)),
};

// ---- build masks for a rule, restricted to the harbour index set ---------
function buildMasks(thresholds) {
  const water = [], valids = [];
  for (let j = 0; j < n; j++) {
    const { gray, valid } = readComposite(scenes[j].id);
    const wp = newPlane();
    for (let t = 0; t < HIDX.length; t++) {
      const i = HIDX[t];
      if (((valid[i >>> 5] >>> (i & 31)) & 1) === 0) continue;
      if (gray[i] > thresholds[j]) setBit(wp, i);
    }
    water.push(wp);
    valids.push(Uint32Array.from(valid));
  }
  return { water, valids };
}

function fitSubset(idx, water, valids, exclude) {
  const cls = new Uint8Array(idx.length), h = new Float32Array(idx.length);
  for (let t = 0; t < idx.length; t++) {
    const i = idx[t], w = i >>> 5, b = i & 31;
    let Wn = 0, Vn = 0;
    for (let j = 0; j < n; j++) {
      if (j === exclude) continue;
      const v = (valids[j][w] >>> b) & 1;
      Vn += v; Wn += v & ((water[j][w] >>> b) & 1);
    }
    if (Vn < MIN_VALID_SCENES) { cls[t] = CLS_NODATA; continue; }
    let W = 0, V = 0, bestErr = 0x7fffffff, kLo = 0, kHi = 0;
    for (let k = 0; k <= n; k++) {
      if (k === exclude) continue;
      const err = 2 * W - V + Vn - Wn;
      if (err < bestErr) { bestErr = err; kLo = kHi = k; }
      else if (err === bestErr) kHi = k;
      if (k < n) { const v = (valids[k][w] >>> b) & 1; V += v; W += v & ((water[k][w] >>> b) & 1); }
    }
    const k = (kLo + kHi) >> 1;
    if (k === 0) { cls[t] = CLS_SUBTIDAL; h[t] = -Infinity; }
    else if (k === n) { cls[t] = CLS_SUPRATIDAL; h[t] = Infinity; }
    else { cls[t] = CLS_INTERTIDAL; h[t] = (tides[k - 1] + tides[k]) / 2; }
  }
  return { cls, h };
}
const predWet = (c, h, T) => c === CLS_SUBTIDAL || (c === CLS_INTERTIDAL && h <= T);

// ---- score every rule -----------------------------------------------------
const results = [];
for (const [name, mk] of Object.entries(RULES)) {
  const thr = mk();
  const { water, valids } = buildMasks(thr);
  // reference classes from the full fit over the harbour
  const full = fitSubset(HIDX, water, valids, -1);
  const inter = [];
  for (let t = 0; t < HIDX.length; t++) if (full.cls[t] === CLS_INTERTIDAL) inter.push(HIDX[t]);
  const INTER = Int32Array.from(inter);
  let subN = 0, supN = 0;
  for (let t = 0; t < HIDX.length; t++) { if (full.cls[t] === CLS_SUBTIDAL) subN++; else if (full.cls[t] === CLS_SUPRATIDAL) supN++; }

  const ious = [], agrees = [];
  for (let j = 0; j < n; j++) {
    const loo = fitSubset(INTER, water, valids, j);
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let t = 0; t < INTER.length; t++) {
      const i = INTER[t], w = i >>> 5, b = i & 31;
      if (((valids[j][w] >>> b) & 1) === 0) continue;
      const obs = (water[j][w] >>> b) & 1;
      const pr = predWet(loo.cls[t], loo.h[t], tides[j]) ? 1 : 0;
      if (obs && pr) tp++; else if (!obs && pr) fp++; else if (obs && !pr) fn++; else tn++;
    }
    ious.push(tp + fp + fn ? tp / (tp + fp + fn) : 1);
    agrees.push(100 * (tp + tn) / (tp + fp + fn + tn));
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const r = {
    rule: name,
    thresholdsGray: thr.length === n ? thr : null,
    meanIoU: +mean(ious).toFixed(4),
    minIoU: +Math.min(...ious).toFixed(4),
    meanAgreePct: +mean(agrees).toFixed(2),
    intertidalPx: INTER.length, subtidalPx: subN, supratidalPx: supN,
  };
  results.push(r);
  console.log(`\n${name.padEnd(28)} meanIoU ${r.meanIoU.toFixed(4)}  minIoU ${r.minIoU.toFixed(4)}  agree ${r.meanAgreePct.toFixed(2)}%  intertidal ${INTER.length} px  subtidal ${subN}  supratidal ${supN}`);
}

results.sort((a, b) => b.meanIoU - a.meanIoU);
console.log('\n=== ranking by true leave-one-out mean IoU ===');
for (const r of results) console.log(`  ${r.meanIoU.toFixed(4)}  ${r.rule}`);
fs.writeFileSync(path.join(dirs.out, 'threshold-experiment.json'), JSON.stringify({
  otsuFrame, otsuHarbour, medianFrame: med(otsuFrame), medianHarbour: med(otsuHarbour),
  scenes: scenes.map((s, j) => ({ id: s.id, tide: s.tide, date: s.datetime.slice(0, 10), cloud: s.cloud, otsuFrame: otsuFrame[j], otsuHarbour: otsuHarbour[j], otsuHarbourNdwi: +ndwiOf(otsuHarbour[j]).toFixed(3) })),
  results,
}, null, 2));
console.log('\nwrote out/threshold-experiment.json');
