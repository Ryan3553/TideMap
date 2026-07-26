// Stage 9 — remove water that is not water.
//
// THE DEFECT. Dark or bluish urban pixels — roof shadow, wet asphalt, the port's
// deep-water berths — sit on the wet side of the global NDWI threshold in enough
// scenes that the step fit calls them SUBTIDAL, or finds a bogus step in them and
// calls them INTERTIDAL. Rendered, they are permanent blue holes punched through
// Mount Maunganui, the CBD and the port, following the street grid. They are
// visible at whole-harbour framing and they do not move with the tide, so they
// read as damage rather than as data.
//
// TWO TESTS, both derived from the data, neither hand-drawn.
//
// 1. SEA-CONNECTED. Real harbour water — subtidal channel or intertidal flat — is
//    one connected body reaching the open sea. A roof is not. Label the water
//    classes 8-connected and keep only the component containing the ocean; every
//    other water pixel becomes land. This also drops inland flooded paddocks and
//    river stage, which stage 8 had to exclude with a mask.
//
// 2. THE WET STATE MUST LOOK LIKE WATER. A pixel the fit calls intertidal is
//    claimed to be submerged in every scene above its drying height. Average the
//    NDWI over exactly those scenes: real flats go strongly positive (median
//    +0.57 harbour-wide), because they are under water. Urban pixels hover at
//    zero — they only ever grazed the threshold. Demote intertidal pixels whose
//    submerged state never actually looks wet.
//
// Test 2 runs FIRST, because urban speckle is what bridges a city block to the
// shoreline and lets test 1 keep it.
//
// Writes classes.png / drying-height.png IN PLACE so every consumer benefits.
// out/fit.bin keeps the raw pre-clean fit; re-running 4-fit.mjs reverts this, so
// run 9-clean.mjs after it (see the Reproducing list in docs/pipeline-validation.md).
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  NPIX, SIZE, dirs, SUBTIDAL, SUPRATIDAL, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL,
  CLS_NODATA, decodeHeight, encodeHeight,
} from './lib/config.mjs';
import { ndwiOf } from './lib/raster.mjs';
import { readComposite } from './2b-composite.mjs';
import { labelComponents } from './lib/components.mjs';
import { pixelAreaKm2, xOf, yOf, lonOf, latOf } from './lib/regions.mjs';
import { encodeGray16 } from './lib/png16.mjs';

const WET_MIN = +(process.env.WET_MIN ?? 0.25);   // NDWI; see the sweep in the report
const MIN_WET_SCENES = 3;                          // below this the mean is not worth trusting
const A = pixelAreaKm2();

const fit = fs.readFileSync(path.join(dirs.out, 'fit.bin'));
const hgt0 = new Uint16Array(fit.buffer, fit.byteOffset, NPIX);
const cls0 = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 2, NPIX);
const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));

// ---- per-pixel mean NDWI over the scenes the fit says are submerged ---------
// Cached: the stream is 1.5 GB and the fit does not change between reruns.
const wetFile = path.join(dirs.out, 'wetness.bin');
let wetMean;
if (fs.existsSync(wetFile) && fs.statSync(wetFile).size === NPIX * 6) {
  const b = fs.readFileSync(wetFile);
  wetMean = new Float32Array(b.buffer, b.byteOffset, NPIX);
  console.log('wet-state NDWI: cached');
} else {
  console.log(`wet-state NDWI: streaming ${scenes.length} composites...`);
  const sum = new Float32Array(NPIX), cnt = new Uint16Array(NPIX);
  const h = new Float32Array(NPIX);
  for (let i = 0; i < NPIX; i++) h[i] = cls0[i] === CLS_INTERTIDAL ? decodeHeight(hgt0[i]) : NaN;
  for (let s = 0; s < scenes.length; s++) {
    const { gray, valid } = readComposite(scenes[s].id);
    const tide = scenes[s].tide;
    for (let i = 0; i < NPIX; i++) {
      const hi = h[i];
      if (!(hi === hi) || tide <= hi) continue;
      if (!((valid[i >>> 5] >>> (i & 31)) & 1)) continue;
      sum[i] += gray[i]; cnt[i]++;
    }
    if ((s + 1) % 25 === 0) process.stdout.write(`\r  ${s + 1}/${scenes.length}   `);
  }
  wetMean = new Float32Array(NPIX).fill(NaN);
  for (let i = 0; i < NPIX; i++) if (cnt[i] >= MIN_WET_SCENES) wetMean[i] = ndwiOf(sum[i] / cnt[i]);
  fs.writeFileSync(wetFile, Buffer.concat([Buffer.from(wetMean.buffer), Buffer.from(cnt.buffer)]));
  console.log('\n  written to out/wetness.bin');
}

const classes = Uint8Array.from(cls0);
const before = { sub: 0, inter: 0, supra: 0 };
for (let i = 0; i < NPIX; i++) {
  if (classes[i] === CLS_SUBTIDAL) before.sub++;
  else if (classes[i] === CLS_INTERTIDAL) before.inter++;
  else if (classes[i] === CLS_SUPRATIDAL) before.supra++;
}
console.log(`\nbefore: subtidal ${(before.sub*A).toFixed(1)}  intertidal ${(before.inter*A).toFixed(1)}  supratidal ${(before.supra*A).toFixed(1)} km2`);

// ---- test 2: the wet state must look like water ----------------------------
let demotedSpectral = 0;
for (let i = 0; i < NPIX; i++) {
  if (classes[i] !== CLS_INTERTIDAL) continue;
  if (wetMean[i] === wetMean[i] && wetMean[i] < WET_MIN) { classes[i] = CLS_SUPRATIDAL; demotedSpectral++; }
}
console.log(`test 2 (wet NDWI < ${WET_MIN}): ${(demotedSpectral*A).toFixed(2)} km2 intertidal -> land`);

// ---- test 1: keep only water connected to the open sea ---------------------
const water = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) water[i] = (classes[i] === CLS_SUBTIDAL || classes[i] === CLS_INTERTIDAL) ? 1 : 0;
const seedOcean = yOf(-37.50) * SIZE + xOf(176.32);
if (!water[seedOcean]) throw new Error('ocean seed is not water');
const { labels, sizes } = labelComponents(water);
const seaId = labels[seedOcean];
console.log(`test 1: sea-connected water body = ${(sizes[seaId]*A).toFixed(1)} km2 of ${((before.sub+before.inter)*A).toFixed(1)} km2 water`);

let demotedSub = 0, demotedInter = 0;
const orphan = sizes.map((n, k) => ({ k, km2: n * A })).filter(c => c.k && c.k !== seaId).sort((a, b) => b.km2 - a.km2);
for (let i = 0; i < NPIX; i++) {
  if (!water[i] || labels[i] === seaId) continue;
  if (classes[i] === CLS_SUBTIDAL) demotedSub++; else demotedInter++;
  classes[i] = CLS_SUPRATIDAL;
}
console.log(`  ${orphan.length} orphan water components -> land: ${(demotedSub*A).toFixed(2)} km2 subtidal + ${(demotedInter*A).toFixed(2)} km2 intertidal`);
console.log(`  largest orphans (km2): ${orphan.slice(0, 8).map(c => c.km2.toFixed(2)).join(', ')}`);

// ---- rewrite the rasters ----------------------------------------------------
const heightCode = new Uint16Array(NPIX);
const after = { sub: 0, inter: 0, supra: 0 };
for (let i = 0; i < NPIX; i++) {
  if (classes[i] === CLS_NODATA) { heightCode[i] = hgt0[i]; continue; }
  if (classes[i] === CLS_SUBTIDAL) { heightCode[i] = SUBTIDAL; after.sub++; }
  else if (classes[i] === CLS_SUPRATIDAL) { heightCode[i] = SUPRATIDAL; after.supra++; }
  else { heightCode[i] = hgt0[i]; after.inter++; }
}
console.log(`after:  subtidal ${(after.sub*A).toFixed(1)}  intertidal ${(after.inter*A).toFixed(1)}  supratidal ${(after.supra*A).toFixed(1)} km2`);

fs.writeFileSync(path.join(dirs.out, 'drying-height.png'), encodeGray16(heightCode, SIZE, SIZE));
await sharp(Buffer.from(classes.buffer), { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .toColourspace('b-w').png({ compressionLevel: 9 }).toFile(path.join(dirs.out, 'classes.png'));
fs.writeFileSync(path.join(dirs.out, 'clean.bin'), Buffer.concat([Buffer.from(heightCode.buffer), Buffer.from(classes.buffer)]));

// a raster of exactly what stage 9 removed, so the change is auditable
const removed = new Uint8Array(NPIX);
for (let i = 0; i < NPIX; i++) removed[i] = (cls0[i] !== classes[i]) ? 255 : 0;
await sharp(Buffer.from(removed.buffer), { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .toColourspace('b-w').png({ compressionLevel: 9 }).toFile(path.join(dirs.out, 'cleaned-away.png'));

// the figure §5 tells consumers to reproduce
const hmask = await sharp(path.join(dirs.out, 'harbour-mask.png')).extractChannel(0).raw().toBuffer();
let inBefore = 0, inAfter = 0;
for (let i = 0; i < NPIX; i++) {
  if (hmask[i] < 128) continue;
  if (cls0[i] === CLS_INTERTIDAL) inBefore++;
  if (classes[i] === CLS_INTERTIDAL) inAfter++;
}
console.log(`harbour intertidal (inside harbour-mask.png): ${(inBefore*A).toFixed(1)} -> ${(inAfter*A).toFixed(1)} km2`);

fs.writeFileSync(path.join(dirs.out, 'clean.json'), JSON.stringify({
  beforeHarbourIntertidalKm2: +(inBefore*A).toFixed(2),
  afterHarbourIntertidalKm2: +(inAfter*A).toFixed(2),
  description: 'Stage 9 — removal of non-tidal water from the fitted classes. Applied IN PLACE to classes.png and drying-height.png; out/fit.bin holds the pre-clean fit.',
  wetMinNdwi: WET_MIN, minWetScenes: MIN_WET_SCENES,
  pixelAreaKm2: A,
  beforeKm2: { subtidal: +(before.sub*A).toFixed(2), intertidal: +(before.inter*A).toFixed(2), supratidal: +(before.supra*A).toFixed(2) },
  afterKm2: { subtidal: +(after.sub*A).toFixed(2), intertidal: +(after.inter*A).toFixed(2), supratidal: +(after.supra*A).toFixed(2) },
  removedKm2: {
    spectralIntertidal: +(demotedSpectral*A).toFixed(2),
    orphanSubtidal: +(demotedSub*A).toFixed(2),
    orphanIntertidal: +(demotedInter*A).toFixed(2),
  },
  orphanComponents: orphan.length,
  largestOrphansKm2: orphan.slice(0, 20).map(c => +c.km2.toFixed(3)),
}, null, 2));
console.log('\nwrote classes.png, drying-height.png (in place), clean.bin, cleaned-away.png, clean.json');
