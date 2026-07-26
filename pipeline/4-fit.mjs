// Stage 4 — fit the drying height per pixel, with a spatially varying tidal lag.
//
// Effective tide at a pixel: tideEff_j = tideModel(t_j - tau(pixel)),
//   tau(pixel) = TAU0_MIN + LAG_SLOPE_MIN_PER_KM * (along-channel km from the sea)
// Two passes, because the distance field needs a water mask to travel through:
//   pass 1: uniform lag -> water mask -> geodesic along-channel distance
//   pass 2: spatial lag -> the shipped raster
// The step fit itself and its exact leave-one-out are in lib/steps.mjs.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  SIZE, NPIX, dirs, encodeHeight, SUBTIDAL, SUPRATIDAL, CLS_SUBTIDAL, CLS_INTERTIDAL,
  CLS_SUPRATIDAL, CLS_NODATA, MIN_VALID_SCENES, TAU0_MIN, LAG_SLOPE_MIN_PER_KM, H_MIN, H_MAX, BBOX,
} from './lib/config.mjs';
import { encodeGray16 } from './lib/png16.mjs';
import { harbourMask } from './lib/regions.mjs';
import { geodesicDistanceKm, oceanSeed } from './lib/geodesic.mjs';
import { loadPlanes, makeBins, runFit } from './lib/fitrun.mjs';

const { meta, scenes, n, planes, vplanes } = loadPlanes();
console.log(`${n} scenes; lag tau = ${TAU0_MIN} + ${LAG_SLOPE_MIN_PER_KM} * alongChannelKm  min`);

const allIdx = Int32Array.from({ length: NPIX }, (_, i) => i);

// ---- pass 1: uniform lag, to get a water mask for the distance field --------
console.log('pass 1: uniform-lag fit (for the along-channel distance field)...');
let t0 = Date.now();
const b1 = makeBins(scenes, new Float32Array(NPIX), allIdx, TAU0_MIN, 0);
const f1 = runFit({ pixelIdx: allIdx, planes, vplanes, n, binOf: b1.binOf, orders: b1.orders, tidesPerBin: b1.tidesPerBin, wantMaps: true });
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const hm = harbourMask();
const water = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) water[i] = (f1.cls[i] === CLS_SUBTIDAL || f1.cls[i] === CLS_INTERTIDAL) ? 1 : 0;
console.log('computing along-channel distance from the open sea...');
const dist = geodesicDistanceKm(water, oceanSeed(water, hm));
let maxD = 0; for (let i = 0; i < NPIX; i++) if (water[i] && Number.isFinite(dist[i]) && dist[i] > maxD) maxD = dist[i];
console.log(`  max along-channel distance ${maxD.toFixed(1)} km -> max lag ${(TAU0_MIN + LAG_SLOPE_MIN_PER_KM * maxD).toFixed(0)} min`);

// ---- pass 2: spatial lag ----------------------------------------------------
console.log('pass 2: spatial-lag fit...');
t0 = Date.now();
const b2 = makeBins(scenes, dist, allIdx, TAU0_MIN, LAG_SLOPE_MIN_PER_KM);
console.log(`  ${b2.bins.length} lag bins (${Math.min(...b2.bins)}..${Math.max(...b2.bins)} min)`);
const f2 = runFit({ pixelIdx: allIdx, planes, vplanes, n, binOf: b2.binOf, orders: b2.orders, tidesPerBin: b2.tidesPerBin, wantMaps: true });
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const classes = f2.cls, misfitArr = f2.misfit;
const heightCode = new Uint16Array(NPIX);
let cSub = 0, cSupra = 0, cInter = 0, cNo = 0, residSum = 0, residN = 0;
let minH = Infinity, maxH = -Infinity;
for (let i = 0; i < NPIX; i++) {
  if (classes[i] === CLS_NODATA) { cNo++; continue; }
  residSum += misfitArr[i]; residN++;
  if (classes[i] === CLS_SUBTIDAL) { heightCode[i] = SUBTIDAL; cSub++; }
  else if (classes[i] === CLS_SUPRATIDAL) { heightCode[i] = SUPRATIDAL; cSupra++; }
  else { const h = f2.hgt[i]; heightCode[i] = encodeHeight(h); cInter++; if (h < minH) minH = h; if (h > maxH) maxH = h; }
}
const analysed = cSub + cSupra + cInter;
const pct = (x) => (100 * x / analysed).toFixed(3) + '%';
console.log(`\nclasses over ${analysed} px (${cNo} nodata):`);
console.log(`  subtidal   ${String(cSub).padStart(9)}  ${pct(cSub)}`);
console.log(`  intertidal ${String(cInter).padStart(9)}  ${pct(cInter)}`);
console.log(`  supratidal ${String(cSupra).padStart(9)}  ${pct(cSupra)}`);
console.log(`mean misfit: ${(residSum / residN).toFixed(3)} of ${n} scenes`);
console.log(`fitted intertidal heights span ${minH.toFixed(3)}..${maxH.toFixed(3)} m`);

// ---- write rasters ----------------------------------------------------------
fs.mkdirSync(dirs.out, { recursive: true });
fs.writeFileSync(path.join(dirs.out, 'drying-height.png'), encodeGray16(heightCode, SIZE, SIZE));
await sharp(Buffer.from(classes.buffer), { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .toColourspace('b-w').png({ compressionLevel: 9 }).toFile(path.join(dirs.out, 'classes.png'));
await sharp(Buffer.from(misfitArr.buffer), { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .toColourspace('b-w').png({ compressionLevel: 9 }).toFile(path.join(dirs.out, 'misfit.png'));

// Harbour mask. The step fit happily assigns a "drying height" to any pixel
// that flips between wet and dry for NON-tidal reasons — sun glint and
// whitecaps over the open ocean, flooded paddocks and river stage inland. Those
// are excluded from every statistic here, but they would be VISIBLE in a
// renderer, so the mask is shipped as a raster: 255 inside the harbour, 0
// outside. Composite it over the classes before drawing.
{
  const mask = new Uint8Array(NPIX);
  for (let i = 0; i < NPIX; i++) mask[i] = hm[i] ? 255 : 0;
  await sharp(Buffer.from(mask.buffer), { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .toColourspace('b-w').png({ compressionLevel: 9 }).toFile(path.join(dirs.out, 'harbour-mask.png'));
  let inHarbourInter = 0, outInter = 0;
  for (let i = 0; i < NPIX; i++) if (classes[i] === CLS_INTERTIDAL) (hm[i] ? inHarbourInter++ : outInter++);
  console.log(`harbour mask: intertidal inside ${inHarbourInter} px, spurious outside ${outInter} px`);
}

const tidesFlat = b1.tidesPerBin[0];
fs.writeFileSync(path.join(dirs.out, 'drying-height.json'), JSON.stringify({
  description: 'Intertidal drying height for Tauranga Harbour, NZ — the tide height (m above chart datum, LINZ Tauranga) at which each pixel transitions from exposed to submerged. Waterline method from Sentinel-2 L2A NDWI.',
  bbox: { west: BBOX.w, south: BBOX.s, east: BBOX.e, north: BBOX.n, crs: 'EPSG:4326' },
  size: { width: SIZE, height: SIZE },
  note: 'Pixels are NOT square: bbox is 0.44 deg lon x 0.38 deg lat rendered square, so ground resolution is ~14.9 m (E-W) x 16.2 m (N-S).',
  files: {
    'drying-height.png': '16-bit grayscale, 1 channel, PNG colour type 0 (verified by verify.mjs)',
    'classes.png': '8-bit single-channel class raster',
    'misfit.png': '8-bit, number of scenes disagreeing with the fitted step (0 = perfect)',
    'harbour-mask.png': '8-bit, 255 inside the Tauranga Harbour polygon, 0 outside. APPLY THIS BEFORE RENDERING — pixels outside it carry non-tidal flicker (ocean glint, flooded farmland) that the step fit misreads as intertidal.',
  },
  encoding: {
    format: 'uint16', subtidal: SUBTIDAL, supratidal: SUPRATIDAL, intertidalRange: [1, 65534],
    heightMin: H_MIN, heightMax: H_MAX,
    toHeightMetres: 'h = 0.0 + (v - 1) / 65533 * 2.5   // valid for 1 <= v <= 65534',
    toCode: 'v = round(1 + (h - 0.0) / 2.5 * 65533)',
    datum: 'metres above chart datum, LINZ Tauranga standard port',
  },
  classes: { nodata: CLS_NODATA, subtidal: CLS_SUBTIDAL, intertidal: CLS_INTERTIDAL, supratidal: CLS_SUPRATIDAL },
  minValidScenes: MIN_VALID_SCENES,
  render: 'water(pixel, tideMetres) = class==subtidal || (class==intertidal && heightMetres <= tideMetres)',
  tidalLag: {
    model: 'tau(pixel) = TAU0_MIN + LAG_SLOPE_MIN_PER_KM * alongChannelKm(pixel)',
    tau0Min: TAU0_MIN, slopeMinPerKm: LAG_SLOPE_MIN_PER_KM,
    maxAlongChannelKm: +maxD.toFixed(2), maxLagMin: +(TAU0_MIN + LAG_SLOPE_MIN_PER_KM * maxD).toFixed(1),
    rationale: 'The water level over the flats lags the open-sea tide, and freshly exposed flats stay saturated; the lag grows with the distance the tidal wave has travelled up-channel. Selected in 3s-spatial-lag.mjs.',
  },
  threshold: { mode: meta.thresholdMode, rationale: meta.rationale, ndwi: meta.medianOtsuNdwi, otsuSpreadNdwi: meta.otsuSpreadNdwi },
  counts: { analysed, nodata: cNo, subtidal: cSub, intertidal: cInter, supratidal: cSupra, meanMisfitScenes: +(residSum / residN).toFixed(4) },
  sceneCount: n,
  tideRange: [+Math.min(...tidesFlat).toFixed(3), +Math.max(...tidesFlat).toFixed(3)],
  fittedHeightRange: [+minH.toFixed(3), +maxH.toFixed(3)],
  scenes: scenes.map(s => ({ id: s.id, datetime: s.datetime, tide: s.tide, tideGauge: s.tideGauge, cloud: s.cloud, waterFrac: s.waterFrac })),
  provenance: {
    imagery: 'Sentinel-2 L2A via Earth Search STAC (AWS open data), tile 60HVD; NDWI = (green - nir)/(green + nir) rendered by titiler.xyz',
    tides: 'tide/tauranga-tide.js — 23-constituent harmonic model with analytic nodal corrections, fitted to LINZ Tauranga tide tables 2023-2027',
    method: 'waterline method, cf. NHESS 23, 3125 (2023), doi:10.5194/nhess-23-3125-2023',
  },
}, null, 2));

fs.writeFileSync(path.join(dirs.out, 'fit.bin'), Buffer.concat([
  Buffer.from(heightCode.buffer), Buffer.from(classes.buffer), Buffer.from(misfitArr.buffer),
]));
fs.writeFileSync(path.join(dirs.out, 'alongchannel.bin'), Buffer.from(dist.buffer));
console.log('\nwrote drying-height.png, classes.png, misfit.png, drying-height.json, fit.bin, alongchannel.bin');
