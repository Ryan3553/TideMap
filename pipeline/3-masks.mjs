// Stage 3 — turn every scene's NDWI composite into a bit-packed water mask.
//
// Threshold choice is DATA-DRIVEN, not assumed: for each scene we run Otsu over
// the valid pixels of the whole frame and report where it lands, plus the depth
// and location of the histogram valley. The chosen threshold is written into
// out/masks.json so the decision is auditable.
//
// Memory discipline: one scene in flight at a time; masks are stored bit-packed
// (Uint32Array of 211,250 words = 845 kB per scene, ~30 MB for 35 scenes) and
// streamed to out/masks.bin.
import fs from 'fs';
import path from 'path';
import { SIZE, NPIX, dirs } from './lib/config.mjs';
import { otsu, ndwiOf, grayFor, newPlane, setBit, countBits, WORDS } from './lib/raster.mjs';
import { readComposite } from './2b-composite.mjs';

// Composites are read from the stage-2b cache (2b-composite.mjs must have run).
async function loadScene(id, gray, valid) {
  const c = readComposite(id);
  gray.set(c.gray);
  for (let i = 0; i < NPIX; i++) valid[i] = (c.valid[i >>> 5] >>> (i & 31)) & 1;
}

const MODE = process.env.THRESHOLD_MODE || 'otsu-median'; // 'otsu-per-scene' | 'fixed' | 'otsu-median'
const FIXED_NDWI = +(process.env.FIXED_NDWI || 0);

const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
scenes.sort((a, b) => a.tide - b.tide);

const gray = new Uint8Array(NPIX);
const valid = new Uint8Array(NPIX);

// ---- pass 1: per-scene Otsu + histogram diagnostics ----------------------
console.log('pass 1 — per-scene Otsu over all valid pixels\n');
console.log('  tide   date        cloud%  otsu(gray)  otsu(NDWI)  valley(NDWI)  bimodality  invalid%');
const diag = [];
for (const s of scenes) {
  await loadScene(s.id, gray, valid);
  const t = otsu(gray, valid);
  // histogram for valley/bimodality diagnostics
  const hist = new Float64Array(256);
  let nValid = 0;
  for (let i = 0; i < NPIX; i++) if (valid[i]) { hist[gray[i]]++; nValid++; }
  // smooth a little, then find the deepest minimum between the two dominant modes
  const sm = new Float64Array(256);
  for (let v = 0; v < 256; v++) {
    let a = 0, n = 0;
    for (let k = -4; k <= 4; k++) { const u = v + k; if (u >= 0 && u < 256) { a += hist[u]; n++; } }
    sm[v] = a / n;
  }
  let loMode = 0, hiMode = 0;
  for (let v = 0; v < 128; v++) if (sm[v] > sm[loMode]) loMode = v;
  for (let v = 128; v < 256; v++) if (sm[v] > sm[hiMode]) hiMode = v;
  let valley = loMode;
  for (let v = loMode; v <= hiMode; v++) if (sm[v] < sm[valley]) valley = v;
  const bimodality = Math.min(sm[loMode], sm[hiMode]) / Math.max(sm[valley], 1e-9);
  const invalidPct = 100 * (NPIX - nValid) / NPIX;
  diag.push({ id: s.id, tide: s.tide, date: s.datetime.slice(0, 10), cloud: s.cloud, otsuGray: t, otsuNdwi: +ndwiOf(t).toFixed(3), valleyNdwi: +ndwiOf(valley).toFixed(3), bimodality: +bimodality.toFixed(1), invalidPct: +invalidPct.toFixed(3) });
  const d = diag.at(-1);
  console.log(`  ${s.tide.toFixed(2)}   ${d.date}  ${String(d.cloud).padStart(5)}   ${String(t).padStart(8)}   ${d.otsuNdwi.toFixed(3).padStart(9)}   ${d.valleyNdwi.toFixed(3).padStart(10)}   ${d.bimodality.toFixed(1).padStart(9)}   ${d.invalidPct.toFixed(2).padStart(7)}`);
}

const otsus = diag.map(d => d.otsuGray).sort((a, b) => a - b);
const medianOtsu = otsus[otsus.length >> 1];
console.log(`\n  Otsu across ${diag.length} scenes: min ${otsus[0]} (NDWI ${ndwiOf(otsus[0]).toFixed(3)})  median ${medianOtsu} (NDWI ${ndwiOf(medianOtsu).toFixed(3)})  max ${otsus.at(-1)} (NDWI ${ndwiOf(otsus.at(-1)).toFixed(3)})`);
const spreadNdwi = ndwiOf(otsus.at(-1)) - ndwiOf(otsus[0]);
console.log(`  spread ${spreadNdwi.toFixed(3)} NDWI units`);

// ---- choose the threshold ------------------------------------------------
let chooser, rationale;
if (MODE === 'fixed') {
  const g = grayFor(FIXED_NDWI);
  chooser = () => g;
  rationale = `fixed NDWI = ${FIXED_NDWI} (gray ${g}) for every scene`;
} else if (MODE === 'otsu-per-scene') {
  chooser = (d) => d.otsuGray;
  rationale = 'per-scene Otsu over all valid pixels of the frame';
} else {
  chooser = () => medianOtsu;
  rationale = `median of the 35 per-scene Otsu thresholds (gray ${medianOtsu}, NDWI ${ndwiOf(medianOtsu).toFixed(3)}) applied to every scene — one global threshold, chosen from the data`;
}
console.log(`\nthreshold mode: ${MODE} -> ${rationale}`);

// ---- pass 2: build + write bit-packed masks AND per-scene validity -------
// Per-scene validity is kept (not just a common-validity intersection) so the
// fit can use every observation a pixel actually has. titiler returns alpha=0
// as a sparse speckle over deep water where green+nir == 0 and NDWI is
// undefined; intersecting 35 scenes would throw away ~2% of the frame for what
// is really a handful of missing observations per pixel.
console.log('\npass 2 — building bit-packed water + validity masks');
const maskFile = path.join(dirs.out, 'masks.bin');
const validFile = path.join(dirs.out, 'valids.bin');
const fdM = fs.openSync(maskFile, 'w');
const fdV = fs.openSync(validFile, 'w');
const plane = newPlane();
const validPlane = newPlane();
const records = [];
for (let si = 0; si < scenes.length; si++) {
  const s = scenes[si], d = diag[si];
  await loadScene(s.id, gray, valid);
  const thr = chooser(d);
  plane.fill(0); validPlane.fill(0);
  for (let i = 0; i < NPIX; i++) {
    if (!valid[i]) continue;
    setBit(validPlane, i);
    if (gray[i] > thr) setBit(plane, i);
  }
  const water = countBits(plane), nv = countBits(validPlane);
  fs.writeSync(fdM, Buffer.from(plane.buffer, plane.byteOffset, plane.byteLength));
  fs.writeSync(fdV, Buffer.from(validPlane.buffer, validPlane.byteOffset, validPlane.byteLength));
  records.push({ ...s, index: si, thresholdGray: thr, thresholdNdwi: +ndwiOf(thr).toFixed(3), waterPx: water, validPx: nv, waterFrac: +(water / nv).toFixed(5), diag: d });
  console.log(`  [${String(si + 1).padStart(2)}/${scenes.length}] ${s.tide.toFixed(2)} m  ${d.date}  thr ${thr}  water ${(100 * water / nv).toFixed(2)}%  valid ${(100 * nv / NPIX).toFixed(3)}%`);
}
fs.closeSync(fdM); fs.closeSync(fdV);
const nCommon = records.reduce((a, r) => Math.min(a, r.validPx), NPIX);

fs.writeFileSync(path.join(dirs.out, 'masks.json'), JSON.stringify({
  size: SIZE, npix: NPIX, words: WORDS, nScenes: scenes.length,
  thresholdMode: MODE, rationale, medianOtsuGray: medianOtsu, medianOtsuNdwi: +ndwiOf(medianOtsu).toFixed(3),
  otsuSpreadNdwi: +spreadNdwi.toFixed(3), minValidPxAnyScene: nCommon,
  scenes: records,
}, null, 2));
console.log(`\nwrote out/masks.bin + out/valids.bin (${(fs.statSync(maskFile).size / 1e6).toFixed(1)} MB each), out/masks.json`);
