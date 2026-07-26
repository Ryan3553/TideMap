// Stage 6 — validation. Everything reported in VALIDATION.md comes from here.
//
//  1. Exact leave-one-out (lib/steps.mjs), banded by tide, for the shipped
//     model AND for the round-2 configuration, so the change is visible.
//  2. Hypsometry: water area vs tide, observed and reconstructed.
//  3. Failure map: per-place agreement + an error-frequency raster.
//  4. Depth limits.
//
// Accuracy is scored over the INTERTIDAL region inside the harbour polygon, on
// the cloud<5% scenes only. Adding cloudier scenes to the FIT is free
// (3t-cloud-fair.mjs) but scoring on them would dilute the metric with scenes
// the model is not really being asked about.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  SIZE, NPIX, dirs, decodeHeight, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL,
  TAU0_MIN, LAG_SLOPE_MIN_PER_KM,
} from './lib/config.mjs';
import { harbourMask, PLACES, xOf, yOf, pixelAreaKm2, HARBOUR } from './lib/regions.mjs';
import { loadPlanes, makeBins, runFit, iouStats } from './lib/fitrun.mjs';
import { fitPixel, makeBuf } from './lib/steps.mjs';

const AREA = pixelAreaKm2();
const { scenes, n, planes, vplanes } = loadPlanes();
const fit = fs.readFileSync(path.join(dirs.out, 'fit.bin'));
const heightCode = new Uint16Array(fit.buffer, fit.byteOffset, NPIX);
const classes = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 2, NPIX);
const misfitArr = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 3, NPIX);
const dist = new Float32Array(fs.readFileSync(path.join(dirs.out, 'alongchannel.bin')).buffer);

console.log('building harbour mask...');
const hm = harbourMask();
const heights = new Float32Array(NPIX);
for (let i = 0; i < NPIX; i++) heights[i] = classes[i] === CLS_INTERTIDAL ? decodeHeight(heightCode[i]) : NaN;

const harbourIdx = [], interIdx = [];
let hSub = 0, hInter = 0, hSupra = 0;
for (let i = 0; i < NPIX; i++) {
  if (!hm[i]) continue;
  harbourIdx.push(i);
  if (classes[i] === CLS_SUBTIDAL) hSub++;
  else if (classes[i] === CLS_INTERTIDAL) { hInter++; interIdx.push(i); }
  else if (classes[i] === CLS_SUPRATIDAL) hSupra++;
}
const IDX = Int32Array.from(harbourIdx), INTER = Int32Array.from(interIdx);
console.log(`harbour polygon ${IDX.length} px (${(IDX.length * AREA).toFixed(0)} km2); water ${((hSub + hInter) * AREA).toFixed(1)} km2 = subtidal ${(hSub * AREA).toFixed(1)} + intertidal ${(hInter * AREA).toFixed(1)}`);

const SUB = +(process.env.VSUB || 2);
const SCORE = Int32Array.from([...INTER].filter((_, k) => k % SUB === 0));
const refSub = new Uint8Array(SCORE.length).fill(CLS_INTERTIDAL);
console.log(`scoring on ${SCORE.length} intertidal px (1/${SUB})`);
const cleanPos = new Set(); scenes.forEach((s, j) => { if (s.cloud < 5) cleanPos.add(j); });

// ------------------------------------------------- 1. leave-one-out accuracy
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function looRun(sceneFilter, tau0, slope, label) {
  const idx = scenes.map((_, j) => j).filter(j => sceneFilter(scenes[j]));
  const p = idx.map(j => planes[j]), v = idx.map(j => vplanes[j]), s = idx.map(j => scenes[j]);
  const bins = makeBins(s, slope ? dist : new Float32Array(NPIX), SCORE, tau0, slope);
  const r = runFit({ pixelIdx: SCORE, planes: p, vplanes: v, n: idx.length, binOf: bins.binOf, orders: bins.orders, tidesPerBin: bins.tidesPerBin, refClass: refSub });
  const keep = new Set(); s.forEach((sc, j) => { if (sc.cloud < 5) keep.add(j); });
  const st = iouStats(r.tp, r.fp, r.fn, r.tn, keep);
  const rows = st.rows.map(row => {
    const sc = s[row.j];
    const iouLand = (row.tn + row.fp + row.fn) ? row.tn / (row.tn + row.fp + row.fn) : null;
    const tot = row.tp + row.fp + row.fn + row.tn;
    return {
      id: sc.id, date: sc.datetime.slice(0, 10), tide: sc.tide, cloud: sc.cloud,
      agree: +row.agree.toFixed(2), iou: +row.iou.toFixed(4),
      iouLand: iouLand == null ? null : +iouLand.toFixed(4),
      obsWaterFracPct: +(100 * (row.tp + row.fn) / tot).toFixed(2),
    };
  }).sort((a, b) => a.tide - b.tide);
  const BANDS = [['< 0.75 m', 0, 0.75], ['0.75-1.00 m', 0.75, 1.0], ['1.00-1.50 m', 1.0, 1.5], ['1.50-2.00 m', 1.5, 2.0], ['>= 2.00 m', 2.0, 9]];
  const banded = BANDS.map(([nm, lo, hi]) => {
    const sel = rows.filter(r2 => r2.tide >= lo && r2.tide < hi);
    return { band: nm, n: sel.length, meanIoU: sel.length ? +mean(sel.map(r2 => r2.iou)).toFixed(4) : null, meanAgree: sel.length ? +mean(sel.map(r2 => r2.agree)).toFixed(2) : null };
  });
  const out = {
    label, nFit: idx.length, nScored: rows.length, tau0, slope,
    tideRange: [+Math.min(...rows.map(r2 => r2.tide)).toFixed(3), +Math.max(...rows.map(r2 => r2.tide)).toFixed(3)],
    meanIoU: +mean(rows.map(r2 => r2.iou)).toFixed(4),
    medianIoU: +[...rows].sort((a, b) => a.iou - b.iou)[rows.length >> 1].iou.toFixed(4),
    meanIoULand: +mean(rows.filter(r2 => r2.iouLand != null).map(r2 => r2.iouLand)).toFixed(4),
    meanAgree: +mean(rows.map(r2 => r2.agree)).toFixed(2),
    banded, rows,
  };
  console.log(`\n${label}\n   fit ${out.nFit} scenes, scored ${out.nScored}, tide ${out.tideRange[0]}..${out.tideRange[1]}  meanIoU ${out.meanIoU}  median ${out.medianIoU}  agree ${out.meanAgree}%`);
  for (const b of banded) if (b.n) console.log(`     ${b.band.padEnd(12)} n=${String(b.n).padStart(3)}  IoU ${b.meanIoU.toFixed(3)}  agree ${b.meanAgree.toFixed(1)}%`);
  return out;
}

console.log('\n1. leave-one-out accuracy');
const before = looRun((s) => s.cloud < 5 && s.datetime >= '2023-01-01', 80, 0, 'BEFORE (round 2 config: 2023+, cloud<5%, uniform tau=80)');
const uniform = looRun(() => true, 60, 0, 'AFTER, uniform lag (all 204 scenes, tau=60)');
const after = looRun(() => true, TAU0_MIN, LAG_SLOPE_MIN_PER_KM, `AFTER, spatial lag (all 204 scenes, tau=${TAU0_MIN}+${LAG_SLOPE_MIN_PER_KM}/km)`);

// ------------------------------------------------------------ 2. hypsometry
console.log('\n2. hypsometry');
const hyps = [];
for (let j = 0; j < n; j++) {
  if (!cleanPos.has(j)) continue;
  let obs = 0, rec = 0;
  const w = planes[j], v = vplanes[j];
  for (let t = 0; t < IDX.length; t++) {
    const i = IDX[t], wd = i >>> 5, b = i & 31;
    if ((v[wd] >>> b) & 1) obs += (w[wd] >>> b) & 1;
    if (classes[i] === CLS_SUBTIDAL || (classes[i] === CLS_INTERTIDAL && heights[i] <= scenes[j].tide)) rec++;
  }
  hyps.push({ tide: scenes[j].tide, date: scenes[j].datetime.slice(0, 10), obsKm2: +(obs * AREA).toFixed(2), recKm2: +(rec * AREA).toFixed(2) });
}
hyps.sort((a, b) => a.tide - b.tide);
let obsViol = 0, obsWorst = 0;
for (let j = 1; j < hyps.length; j++) { const d = hyps[j].obsKm2 - hyps[j - 1].obsKm2; if (d < 0) { obsViol++; obsWorst = Math.min(obsWorst, d); } }
const bias = mean(hyps.map(h => h.recKm2 - h.obsKm2));
const rmse = Math.sqrt(mean(hyps.map(h => (h.recKm2 - h.obsKm2) ** 2)));
console.log(`   observed: ${obsViol}/${hyps.length - 1} steps decrease (worst ${obsWorst.toFixed(2)} km2); recon vs obs bias ${bias.toFixed(2)} rmse ${rmse.toFixed(2)} km2`);
const dense = [];
for (let T = 0.2; T <= 2.31; T += 0.05) {
  let rec = 0;
  for (let t = 0; t < IDX.length; t++) { const i = IDX[t]; if (classes[i] === CLS_SUBTIDAL || (classes[i] === CLS_INTERTIDAL && heights[i] <= T)) rec++; }
  dense.push({ tide: +T.toFixed(2), km2: +(rec * AREA).toFixed(2) });
}

// ------------------------------------------------------------- 3. by place
console.log('\n3. failure map');
const errFreq = new Uint8Array(NPIX);
{
  const bins = makeBins(scenes, dist, SCORE, TAU0_MIN, LAG_SLOPE_MIN_PER_KM);
  const v = new Int32Array(n), w = new Int32Array(n), buf = makeBuf(n);
  for (let t = 0; t < SCORE.length; t++) {
    const i = SCORE[t], ord = bins.orders[bins.binOf[t]];
    const wd = i >>> 5, bit = i & 31;
    for (let p = 0; p < n; p++) { const j = ord[p]; const vv = (vplanes[j][wd] >>> bit) & 1; v[p] = vv; w[p] = vv & ((planes[j][wd] >>> bit) & 1); }
    fitPixel(v, w, n, buf);
    let e = 0;
    for (let p = 0; p < n; p++) { if (!v[p] || !cleanPos.has(ord[p])) continue; if ((p >= buf.looK[p] ? 1 : 0) !== w[p]) e++; }
    errFreq[i] = Math.min(255, e);
  }
}
const placeRows = [];
for (const [name, w0, s0, e0, n0] of PLACES) {
  const x0 = xOf(w0), x1 = xOf(e0), y0 = yOf(n0), y1 = yOf(s0);
  const sel = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * SIZE + x; if (hm[i] && classes[i] === CLS_INTERTIDAL) sel.push(i); }
  if (!sel.length) continue;
  const SEL = Int32Array.from(sel.filter((_, k) => k % SUB === 0));
  const bins = makeBins(scenes, dist, SEL, TAU0_MIN, LAG_SLOPE_MIN_PER_KM);
  const r = runFit({ pixelIdx: SEL, planes, vplanes, n, binOf: bins.binOf, orders: bins.orders, tidesPerBin: bins.tidesPerBin, refClass: new Uint8Array(SEL.length).fill(CLS_INTERTIDAL) });
  const st = iouStats(r.tp, r.fp, r.fn, r.tn, cleanPos);
  let mis = 0, dsum = 0; for (const i of sel) { mis += misfitArr[i]; dsum += Number.isFinite(dist[i]) ? dist[i] : 0; }
  let errs = 0, tot = 0; for (const row of st.rows) { errs += row.fp + row.fn; tot += row.tp + row.fp + row.fn + row.tn; }
  const row = {
    place: name, px: sel.length, km2: +(sel.length * AREA).toFixed(2),
    iou: +st.meanIoU.toFixed(4), errRate: +(100 * errs / tot).toFixed(2),
    meanMisfit: +(mis / sel.length).toFixed(3), meanAlongChannelKm: +(dsum / sel.length).toFixed(2),
  };
  placeRows.push(row);
  console.log(`   ${name.padEnd(30)} ${row.km2.toFixed(2).padStart(8)} km2  IoU ${row.iou.toFixed(3)}  err ${row.errRate.toFixed(2)}%  misfit ${row.meanMisfit.toFixed(2)}  ${row.meanAlongChannelKm.toFixed(1)} km`);
}

// ------------------------------------------------------- 4. depth limitation
const harbourWaterPx = hSub + hInter;
const tidesAll = scenes.map(s => s.tide).sort((a, b) => a - b);
let atLow = 0, atHigh = 0;
const loEdge = tidesAll[0] + 0.06, hiEdge = tidesAll.at(-1) - 0.06;
for (const i of INTER) { if (heights[i] <= loEdge) atLow++; if (heights[i] >= hiEdge) atHigh++; }
let landInter = 0; for (let i = 0; i < NPIX; i++) if (!hm[i] && classes[i] === CLS_INTERTIDAL) landInter++;
const misHist = new Array(9).fill(0); for (const i of INTER) misHist[Math.min(8, misfitArr[i])]++;
console.log('\n4. limits');
console.log(`   harbour water ${(harbourWaterPx * AREA).toFixed(1)} km2; subtidal ${(hSub * AREA).toFixed(1)} (${(100 * hSub / harbourWaterPx).toFixed(1)}%); intertidal ${(hInter * AREA).toFixed(1)} (${(100 * hInter / harbourWaterPx).toFixed(1)}%)`);
console.log(`   pinned low ${(atLow * AREA).toFixed(2)} km2, pinned high ${(atHigh * AREA).toFixed(2)} km2, spurious outside ${(landInter * AREA).toFixed(1)} km2`);

{
  const rgb = new Uint8Array(NPIX * 3);
  const maxE = Math.max(8, Math.round(cleanPos.size * 0.12));
  for (let i = 0; i < NPIX; i++) {
    let c;
    if (classes[i] === CLS_INTERTIDAL && hm[i]) { const f = Math.min(1, errFreq[i] / maxE); c = [Math.round(30 + 225 * f), Math.round(200 - 190 * f), Math.round(120 - 110 * f)]; }
    else if (classes[i] === CLS_SUBTIDAL) c = [12, 24, 50];
    else if (classes[i] === CLS_SUPRATIDAL) c = [30, 34, 28];
    else c = [60, 0, 60];
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  for (const [, w0, s0, e0, n0] of PLACES) {
    const x0 = xOf(w0), x1 = xOf(e0), y0 = yOf(n0), y1 = yOf(s0);
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) { const i = y * SIZE + x; rgb[i * 3] = 255; rgb[i * 3 + 1] = 255; rgb[i * 3 + 2] = 0; }
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) { const i = y * SIZE + x; rgb[i * 3] = 255; rgb[i * 3 + 1] = 255; rgb[i * 3 + 2] = 0; }
  }
  await sharp(Buffer.from(rgb.buffer), { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .resize(1300, 1300, { kernel: 'nearest' }).png().toFile(path.join(dirs.out, 'preview-failure-map.png'));
}

fs.writeFileSync(path.join(dirs.out, 'validation.json'), JSON.stringify({
  nScenesFit: n, nScenesScored: cleanPos.size,
  tideRangeFit: [tidesAll[0], tidesAll.at(-1)],
  pixelAreaKm2: +AREA.toFixed(6), harbourPolygon: HARBOUR, scoreSubsample: SUB,
  lag: { tau0Min: TAU0_MIN, slopeMinPerKm: LAG_SLOPE_MIN_PER_KM },
  harbour: {
    polygonKm2: +(IDX.length * AREA).toFixed(1), waterKm2: +(harbourWaterPx * AREA).toFixed(1),
    subtidalKm2: +(hSub * AREA).toFixed(1), intertidalKm2: +(hInter * AREA).toFixed(1), supratidalKm2: +(hSupra * AREA).toFixed(1),
    subtidalPctOfWater: +(100 * hSub / harbourWaterPx).toFixed(1), intertidalPctOfWater: +(100 * hInter / harbourWaterPx).toFixed(1),
    pinnedLowKm2: +(atLow * AREA).toFixed(2), pinnedHighKm2: +(atHigh * AREA).toFixed(2),
    spuriousIntertidalOutsideKm2: +(landInter * AREA).toFixed(1),
  },
  leaveOneOut: { before, uniform, after },
  hypsometry: { perScene: hyps, dense, observedMonotonicityViolations: obsViol, worstObservedDropKm2: +obsWorst.toFixed(2), reconstructedVsObserved: { biasKm2: +bias.toFixed(2), rmseKm2: +rmse.toFixed(2) } },
  places: placeRows,
  misfitHistogram: misHist,
}, null, 2));
console.log('\nwrote out/validation.json + out/preview-failure-map.png');
