// Stage 8 — build a REAL harbour mask, and audit it the way a consumer would.
//
// Round 3 shipped the statistics polygon (lib/regions.mjs HARBOUR) as the
// renderer mask. That was wrong in PURPOSE even where it is right in extent:
// the polygon's landward closure is deliberately generous (it runs out to the
// frame edges) because for statistics it is always intersected with the water
// classes first. Used raw as a renderer mask it admits inland farmland — which
// is exactly where the spurious "intertidal" lives — and it is a coarse
// straight-edged shape, not a harbour outline.
//
// The fix: derive the mask from the DATA. Take the fitted water classes, keep
// only what falls landward of the (visually verified) seaward coastline, then
// flood-fill the single connected water body that is the harbour. Inland
// flooded paddocks are water but are NOT connected to the harbour, so they drop
// out; the open ocean is excluded by the coastline; offshore glint blobs are
// disconnected and drop out.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NPIX, SIZE, dirs, CLS_INTERTIDAL, CLS_SUBTIDAL, CLS_SUPRATIDAL } from './lib/config.mjs';
import { harbourMask, pixelAreaKm2, lonOf, latOf, xOf, yOf, PLACES } from './lib/regions.mjs';
import { labelComponents, dilate, erode } from './lib/components.mjs';

const A = pixelAreaKm2();
const MIN_KM2 = +(process.env.MIN_KM2 || 0.05);
const fit = fs.readFileSync(path.join(dirs.out, 'fit.bin'));
const classes = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 2, NPIX);
const misfitArr = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 3, NPIX);
const dist = new Float32Array(fs.readFileSync(path.join(dirs.out, 'alongchannel.bin')).buffer);

const water = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) water[i] = (classes[i] === CLS_SUBTIDAL || classes[i] === CLS_INTERTIDAL) ? 1 : 0;
const poly = harbourMask();
let totalInter = 0;
for (let i = 0; i < NPIX; i++) if (classes[i] === CLS_INTERTIDAL) totalInter++;
console.log(`total intertidal in frame: ${(totalInter * A).toFixed(1)} km2`);

// ---- 1. separate the open ocean from the harbour, WITHOUT a hand-drawn polygon
// The harbour connects to the sea only through two narrow entrances (Tauranga
// and Bowentown). Eroding the water mask far enough severs those necks; the
// ocean is then its own component and can be dilated back and subtracted.
// The erosion radius is SEARCHED rather than assumed: it increases until the
// mid-harbour seed and an offshore seed genuinely land in different components.
const seedHarbour = yOf(-37.62) * SIZE + xOf(176.06);
const seedOcean = yOf(-37.50) * SIZE + xOf(176.32);
if (!water[seedHarbour]) throw new Error('harbour seed is not water');
if (!water[seedOcean]) throw new Error('ocean seed is not water');

let R = 0, oceanMask = null;
for (const r of [16, 24, 32, 40, 48, 56, 64]) {
  const er = erode(water, r);
  const { labels: L } = labelComponents(er);
  const lo = L[seedOcean];
  // walk outward from the harbour seed to the nearest surviving eroded pixel
  let lh = L[seedHarbour];
  if (!lh) {
    for (let rad = 1; rad < 200 && !lh; rad++) {
      for (let dy = -rad; dy <= rad && !lh; dy++) {
        for (let dx = -rad; dx <= rad && !lh; dx++) {
          const j = seedHarbour + dy * SIZE + dx;
          if (j >= 0 && j < NPIX && L[j]) lh = L[j];
        }
      }
    }
  }
  console.log(`  erode r=${r}: ocean label ${lo}, harbour label ${lh}${lo && lh && lo !== lh ? '  -> SEPARATED' : ''}`);
  if (lo && lh && lo !== lh) {
    const oc0 = new Uint8Array(NPIX);
    for (let i = 0; i < NPIX; i++) oc0[i] = L[i] === lo ? 1 : 0;
    const back = dilate(oc0, r);
    oceanMask = new Uint8Array(NPIX);
    for (let i = 0; i < NPIX; i++) oceanMask[i] = (back[i] && water[i]) ? 1 : 0;
    R = r;
    break;
  }
}
if (!oceanMask) throw new Error('could not separate ocean from harbour');
let oceanPx = 0; for (let i = 0; i < NPIX; i++) if (oceanMask[i]) oceanPx++;
console.log(`  separated at erosion radius ${R} px (~${(R * 0.0155).toFixed(2)} km); open ocean = ${(oceanPx * A).toFixed(0)} km2`);

const cand = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) cand[i] = (water[i] && !oceanMask[i]) ? 1 : 0;
const { labels, sizes } = labelComponents(cand);
let harbourId = labels[seedHarbour];
if (!harbourId) { let best = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[best]) best = k; harbourId = best; }
console.log(`  harbour water component: ${(sizes[harbourId] * A).toFixed(1)} km2`);
const others = sizes.map((s2, k) => ({ k, km2: s2 * A })).filter(c => c.k && c.k !== harbourId && c.km2 >= 0.5).sort((a, b) => b.km2 - a.km2);
console.log(`  other non-ocean water components >= 0.5 km2: ${others.length ? others.slice(0, 8).map(c => c.km2.toFixed(1)).join(', ') : 'none'}`);

const harbourWater = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) harbourWater[i] = labels[i] === harbourId ? 1 : 0;
const mask = dilate(harbourWater, 2);
let maskPx = 0; for (let i = 0; i < NPIX; i++) if (mask[i]) maskPx++;
console.log(`  mask after 2 px dilation: ${(maskPx * A).toFixed(1)} km2`);

// ---- 2. the audit a consumer would run -------------------------------------
let inI = 0, outI = 0, inSub = 0;
for (let i = 0; i < NPIX; i++) {
  if (classes[i] === CLS_INTERTIDAL) (mask[i] ? inI++ : outI++);
  else if (classes[i] === CLS_SUBTIDAL && mask[i]) inSub++;
}
console.log(`\nAUDIT  intertidal INSIDE mask  ${(inI * A).toFixed(1)} km2`);
console.log(`       intertidal OUTSIDE mask ${(outI * A).toFixed(1)} km2`);
console.log(`       ratio inside:outside = ${(inI / Math.max(1, outI)).toFixed(1)} : 1   ${inI > outI * 3 ? 'PASS' : 'FAIL'}`);
console.log(`       subtidal inside mask   ${(inSub * A).toFixed(1)} km2`);

// ---- 3. classify the intertidal left OUTSIDE the mask ----------------------
const outside = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) outside[i] = (classes[i] === CLS_INTERTIDAL && !mask[i]) ? 1 : 0;
const oc = labelComponents(outside);
const comps = [];
let smallN = 0, smallKm2 = 0;
for (let k = 1; k < oc.sizes.length; k++) {
  const km2 = oc.sizes[k] * A;
  if (km2 < MIN_KM2) { smallN++; smallKm2 += km2; continue; }
  comps.push({ k, km2 });
}
const acc = new Map();
for (const c of comps) acc.set(c.k, { sx: 0, sy: 0, n: 0, minx: 1e9, maxx: -1e9, miny: 1e9, maxy: -1e9, mis: 0, inPoly: 0, adjWater: 0, adjLand: 0 });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x, k = oc.labels[i];
    if (!k) continue;
    const a = acc.get(k);
    if (!a) continue;
    a.sx += x; a.sy += y; a.n++; a.mis += misfitArr[i];
    if (x < a.minx) a.minx = x;
    if (x > a.maxx) a.maxx = x;
    if (y < a.miny) a.miny = y;
    if (y > a.maxy) a.maxy = y;
    if (poly[i]) a.inPoly++;
    if (Number.isFinite(dist[i])) a.adjWater++;
    // does this pixel touch dry land? distinguishes a shoreline strip (open-coast
    // beach / surf zone) from a blob floating in open water (sun glint).
    let land = false;
    for (let dy = -1; dy <= 1 && !land; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = i + dy * SIZE + dx;
      if (j >= 0 && j < NPIX && classes[j] === CLS_SUPRATIDAL) { land = true; break; }
    }
    if (land) a.adjLand++;
  }
}
const placeOf = (lon, lat) => {
  for (const [nm, w, s, e, n] of PLACES) if (lon >= w && lon <= e && lat >= s && lat <= n) return nm;
  return '';
};
console.log(`\nintertidal outside the mask: ${comps.length} components >= ${MIN_KM2} km2, plus ${smallN} blobs < ${MIN_KM2} km2 totalling ${smallKm2.toFixed(1)} km2`);
comps.sort((a, b) => b.km2 - a.km2);
const rows = [];
for (const c of comps) {
  const a = acc.get(c.k);
  const lon = lonOf(a.sx / a.n), lat = latOf(a.sy / a.n);
  const seaward = a.inPoly / a.n < 0.5;
  const meanMisfit = a.mis / a.n;
  const connected = a.adjWater / a.n;
  const shoreline = a.adjLand / a.n;
  let verdict;
  if (connected < 0.02) verdict = 'inland flooding';
  else if (!seaward) verdict = 'harbour fringe (REAL - check)';
  else if (shoreline > 0.25) verdict = 'open-coast beach/surf';
  else verdict = 'open-water sun glint';
  rows.push({
    km2: +c.km2.toFixed(2), lon: +lon.toFixed(4), lat: +lat.toFixed(4),
    place: (Math.max(a.maxx - a.minx, a.maxy - a.miny) * 0.0155) < 3 ? placeOf(lon, lat) : '(diffuse scatter - centroid not meaningful)',
    meanMisfit: +meanMisfit.toFixed(1), pctInsidePolygon: +(100 * a.inPoly / a.n).toFixed(0),
    pctWaterConnected: +(100 * connected).toFixed(0), pctTouchingLand: +(100 * shoreline).toFixed(0),
    spanKm: +(Math.max(a.maxx - a.minx, a.maxy - a.miny) * 0.0155).toFixed(1),
    verdict,
  });
}
console.log('\n   km2   lon        lat       misfit  inPoly%  conn%  span    verdict              location');
for (const r of rows) {
  console.log(`  ${r.km2.toFixed(2).padStart(5)}  ${r.lon.toFixed(4)}  ${r.lat.toFixed(4)}  ${r.meanMisfit.toFixed(0).padStart(6)}  ${String(r.pctInsidePolygon).padStart(6)}  ${String(r.pctTouchingLand).padStart(5)}  ${r.spanKm.toFixed(1).padStart(4)}km  ${r.verdict.padEnd(23)} ${r.place}`);
}
const byVerdict = {};
for (const r of rows) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + r.km2;
console.log('\n  totals by verdict: ' + Object.entries(byVerdict).map(([k, v]) => `${k} ${v.toFixed(1)} km2`).join('  |  '));

// ---- 4. write ---------------------------------------------------------------
const out = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) out[i] = mask[i] ? 255 : 0;
await sharp(Buffer.from(out.buffer), { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .toColourspace('b-w').png({ compressionLevel: 9 }).toFile(path.join(dirs.out, 'harbour-mask.png'));

fs.writeFileSync(path.join(dirs.out, 'harbour-mask.json'), JSON.stringify({
  description: 'Renderer mask for the Tauranga Harbour drying-height raster. 255 = draw, 0 = ignore. Derived from the fitted water classes by flood-filling the single connected harbour water body landward of the coastline, then dilating 2 px.',
  size: { width: SIZE, height: SIZE },
  rowOrder: 'row 0 is NORTH (top of the bbox, latitude -37.41). Identical orientation to drying-height.png, classes.png and misfit.png.',
  selfCheck: {
    note: 'Load this mask together with classes.png and reproduce the four numbers below. If inside/outside come out swapped, one of your two load paths is flipping rows.',
    maskAreaKm2: +(maskPx * A).toFixed(1),
    intertidalInsideKm2: +(inI * A).toFixed(1),
    intertidalOutsideKm2: +(outI * A).toFixed(1),
    subtidalInsideKm2: +(inSub * A).toFixed(1),
    pixelAreaKm2: +A.toFixed(9),
  },
  method: `water = subtidal|intertidal; the open ocean is separated morphologically (erode by ${R} px to sever the two entrance necks, label, dilate the ocean component back, subtract); the remaining component containing 176.06E 37.62S is the harbour; dilated 2 px. NO hand-drawn polygon is involved.`,
  erosionRadiusPx: R,
  excludedComponents: { minKm2: MIN_KM2, listed: rows, smallBlobCount: smallN, smallBlobKm2: +smallKm2.toFixed(2) },
  totals: { frameIntertidalKm2: +(totalInter * A).toFixed(1) },
}, null, 2));
console.log('\nwrote out/harbour-mask.png + out/harbour-mask.json');
