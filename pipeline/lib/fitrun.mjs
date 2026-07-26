// Spatial-lag-aware step fit + exact leave-one-out scoring.
//
// Effective tide at a pixel:  tideEff_j = tideModel(t_j - tau(pixel))
//   tau(pixel) = TAU0 + SLOPE * alongChannelKm(pixel)
// tau is quantised into bins (default 5 min) so the scene ORDER — which depends
// on tau — is computed once per bin rather than once per pixel.
import fs from 'fs';
import path from 'path';
import { NPIX, dirs, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL, CLS_NODATA, MIN_VALID_SCENES } from './config.mjs';
import { WORDS } from './raster.mjs';
import { fitPixel, makeBuf } from './steps.mjs';
import { predict } from '../../tide/tauranga-tide.js';

export const tideModel = (ms) => predict(new Date(ms));

export function loadPlanes() {
  const meta = JSON.parse(fs.readFileSync(path.join(dirs.out, 'masks.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(dirs.out, 'masks.bin'));
  const vbuf = fs.readFileSync(path.join(dirs.out, 'valids.bin'));
  const n = meta.scenes.length, planes = [], vplanes = [];
  for (let i = 0; i < n; i++) {
    planes.push(new Uint32Array(buf.buffer, buf.byteOffset + i * WORDS * 4, WORDS));
    vplanes.push(new Uint32Array(vbuf.buffer, vbuf.byteOffset + i * WORDS * 4, WORDS));
  }
  return { meta, scenes: meta.scenes, n, planes, vplanes };
}

/** Bin assignment + per-bin scene order/tides for a (tau0, slope) pair. */
export function makeBins(scenes, distKm, pixelIdx, tau0, slope, binMin = 5) {
  const times = scenes.map(s => Date.parse(s.datetime));
  const binOf = new Int32Array(pixelIdx.length);
  const seen = new Map();
  for (let t = 0; t < pixelIdx.length; t++) {
    const d = distKm[pixelIdx[t]];
    const tau = tau0 + slope * (Number.isFinite(d) ? d : 0);
    const key = Math.round(tau / binMin);
    let b = seen.get(key);
    if (b === undefined) { b = seen.size; seen.set(key, b); }
    binOf[t] = b;
  }
  const bins = [];
  for (const [key, b] of seen) bins[b] = key * binMin;
  const orders = [], tidesPerBin = [];
  for (const tau of bins) {
    const tv = times.map(ms => tideModel(ms - tau * 60000));
    const ord = Int32Array.from(tv.keys()).sort((a, b) => tv[a] - tv[b]);
    orders.push(ord);
    tidesPerBin.push(Float64Array.from(ord, j => tv[j]));
  }
  return { binOf, bins, orders, tidesPerBin };
}

/**
 * Fit + score. Returns per-scene confusion over the supplied pixels and,
 * optionally, the per-pixel class/height arrays.
 *
 * @param opts.scoreClass  which reference class to score over (default intertidal)
 * @param opts.refClass    reference class per pixel (from a prior full fit); if
 *                         absent, the fit's own classes are used.
 */
export function runFit({ pixelIdx, planes, vplanes, n, binOf, orders, tidesPerBin, refClass = null, wantMaps = false }) {
  const P = pixelIdx.length;
  const v = new Int32Array(n), w = new Int32Array(n), buf = makeBuf(n);
  const cls = wantMaps ? new Uint8Array(P) : null;
  const hgt = wantMaps ? new Float32Array(P) : null;
  const kArr = wantMaps ? new Int32Array(P) : null;
  const misfit = wantMaps ? new Uint8Array(P) : null;
  // confusion per ORIGINAL scene index
  const tp = new Float64Array(n), fp = new Float64Array(n), fn = new Float64Array(n), tn = new Float64Array(n);

  for (let t = 0; t < P; t++) {
    const i = pixelIdx[t], b = binOf[t], ord = orders[b], tides = tidesPerBin[b];
    const wd = i >>> 5, bit = i & 31;
    let Vn = 0;
    for (let p = 0; p < n; p++) {
      const j = ord[p];
      const vv = (vplanes[j][wd] >>> bit) & 1;
      v[p] = vv; w[p] = vv & ((planes[j][wd] >>> bit) & 1); Vn += vv;
    }
    if (Vn < MIN_VALID_SCENES) { if (wantMaps) { cls[t] = CLS_NODATA; hgt[t] = NaN; } continue; }
    const r = fitPixel(v, w, n, buf);
    if (wantMaps) {
      kArr[t] = r.k; misfit[t] = Math.min(255, r.minErr);
      if (r.k === 0) { cls[t] = CLS_SUBTIDAL; hgt[t] = -Infinity; }
      else if (r.k === n) { cls[t] = CLS_SUPRATIDAL; hgt[t] = Infinity; }
      else { cls[t] = CLS_INTERTIDAL; hgt[t] = (tides[r.k - 1] + tides[r.k]) / 2; }
    }
    // score only pixels whose REFERENCE class is intertidal
    if (refClass && refClass[t] !== CLS_INTERTIDAL) continue;
    if (!refClass && !(r.k > 0 && r.k < n)) continue;
    for (let p = 0; p < n; p++) {
      if (!v[p]) continue;
      const obs = w[p], pred = p >= buf.looK[p] ? 1 : 0, j = ord[p];
      if (obs && pred) tp[j]++; else if (!obs && pred) fp[j]++; else if (obs && !pred) fn[j]++; else tn[j]++;
    }
  }
  return { tp, fp, fn, tn, cls, hgt, kArr, misfit };
}

export function iouStats(tp, fp, fn, tn, keep = null) {
  const ious = [], agrees = [], rows = [];
  for (let j = 0; j < tp.length; j++) {
    if (keep && !keep.has(j)) continue;
    const d = tp[j] + fp[j] + fn[j];
    const iou = d ? tp[j] / d : 1;
    const tot = d + tn[j];
    ious.push(iou); agrees.push(tot ? 100 * (tp[j] + tn[j]) / tot : 100);
    rows.push({ j, iou, agree: tot ? 100 * (tp[j] + tn[j]) / tot : 100, tp: tp[j], fp: fp[j], fn: fn[j], tn: tn[j] });
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { meanIoU: mean(ious), meanAgree: mean(agrees), rows };
}
