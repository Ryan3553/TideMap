// Bakes an "open coast" ocean mask into the BLUE channel of data/relief.png.
//
// R and G already carry the land-relief gradient (dz/dEast, dz/dNorth, see
// fetch-relief.mjs) and are byte-identical, untouched here. B was all-zero and
// free; the renderer wants B = 255 on open Pacific water (seaward of Matakana
// Island / Bowentown / the Mount Maunganui-Papamoa coast), 0 on land AND on all
// water *inside* Tauranga Harbour, softly feathered at the two harbour
// entrances and along every shore.
//
// Method (morphological seal + flood fill), all at the project's PxP
// equirectangular grid (bbox lon 175.93..176.37, lat -37.41..-37.79, row 0 =
// north — same grid as relief.png; depth-composite-raw.f32 is fixed at 4096px
// regardless of P):
//   1. Downsample (or, when P == SRC, pass through) the depth composite to
//      PxP by ratio x ratio box averaging, ratio = SRC/P.
//      waterMask = elevation < 0.
//   2. Seal the harbour entrances: dilate the LAND mask by a disc of radius
//      SEAL_RADIUS px to close both the ~500 m Tauranga entrance and the
//      Bowentown entrance. sealedWater = waterMask AND NOT dilatedLand.
//   3. Flood-fill sealedWater (8-connected) from every sealedWater pixel on
//      the map's north/east edges (the open Pacific). The seal guarantees the
//      harbour interior is unreachable from here.
//   4. Grow the resulting ocean label back out through the ORIGINAL waterMask
//      (8-neighbour dilation, GROW_ITERS iterations == BFS depth cap).
//      This recovers the beach-adjacent strip the seal ate and lets the ocean
//      push a little way into the entrance throats — the desired feather.
//   5. mask = 255 where ocean else 0, gaussian blur sigma BLUR_SIGMA px, write
//      into relief.png's B channel. R and G are copied through unmodified and
//      the copy is verified byte-identical before anything is written to disk.
//
// Connectivity note: the spec only pins down 8-neighbour connectivity for the
// step-4 dilation; the step-3 edge flood fill here also uses 8-connectivity
// (matches step 4, avoids spurious disconnects through diagonal-only water
// pixels at this resolution).
//
// PIXEL-CONSTANT SCALING (2026-07-28, relief upgrade to P=4096): SEAL_RADIUS,
// GROW_ITERS and BLUR_SIGMA all encode *physical* distances (entrance-closure
// radius, feather reach) that were tuned in pixels at the original P=2048 grid
// (~19-21 m/px). Doubling P to 4096 halves the grid spacing to ~9.5-10.3 m/px,
// so those pixel counts are scaled by SCALE = P/2048 to keep the same
// real-world distances (the harbour-entrance seal in particular depends on
// this: see the original tuning note below, preserved unscaled for context).
//   original tuning @ P=2048: SEAL_RADIUS 20px (~380m — the spec's original
//   16px estimate leaves a ~380m clear-water gap through the Bowentown throat
//   even past its one mid-channel shoal, which leaks the entire harbour into
//   the open-ocean flood fill; 18px was the bare minimum, 20px the safety
//   margin), GROW_ITERS 24px (~456-504m), BLUR_SIGMA 2.5px (~47-52m).
//
// Usage: node bake-oceanmask.mjs
// Reads data/depth-composite-raw.f32 + data/relief.png.
// Writes data/relief.png (B channel only), data/relief.json (+blueChannel
// field), data/_debug_oceanmask.png.
import fs from 'fs';
import sharp from 'sharp';

const P = 4096;
const SRC = 4096;
const N = P * P;
const WEST = 175.93, SOUTH = -37.79, EAST = 176.37, NORTH = -37.41;
// SEAL_RADIUS: spec called for 16px (~300m/side, ~600m total closure) at the original
// P=2048 grid. Measured against the actual bathymetry, the Bowentown/Katikati entrance
// throat has a clear-water gap of ~380m even past its one mid-channel shoal, so a 16px
// seal (verified against sample points inside the harbour: Omokoroa, the inner Bowentown
// channel) leaks the whole harbour into the ocean flood fill. 18px is the minimum that
// closes it; 20px is used for a safety margin. The main Tauranga entrance (~500m, per
// spec) was already fully closed at 16px. All three pixel constants below are scaled by
// SCALE = P/2048 to preserve those physical distances at the current grid resolution.
const SCALE = P / 2048;
const SEAL_RADIUS = Math.round(20 * SCALE);  // px, disc dilation of land to seal entrances
const GROW_ITERS = Math.round(24 * SCALE);   // px, BFS depth cap == iteration count of the recovery dilation
const BLUR_SIGMA = 2.5 * SCALE;              // px, final feather

const RELIEF_PNG = 'data/relief.png';
const RELIEF_JSON = 'data/relief.json';
const DEPTH_RAW = 'data/depth-composite-raw.f32';
const BASE_JPG = 'data/base-fused.jpg';
const DEBUG_PNG = 'data/_debug_oceanmask.png';

// ---- 1. load + downsample elevation, threshold to water ----------------
const rawBuf = fs.readFileSync(DEPTH_RAW);
if (rawBuf.length !== SRC * SRC * 4) throw new Error(`unexpected depth-composite-raw.f32 size ${rawBuf.length}, expected ${SRC * SRC * 4}`);
const elevSrc = new Float32Array(rawBuf.buffer, rawBuf.byteOffset, SRC * SRC);

const elev = new Float32Array(N);
const ratio = SRC / P;
if (!Number.isInteger(ratio)) throw new Error(`SRC/P must be an integer ratio, got ${SRC}/${P}`);
if (ratio === 1) {
  elev.set(elevSrc);                          // P now matches SRC (4096) exactly — no downsample needed
} else {
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < P; i++) {
      let sum = 0;
      for (let dy = 0; dy < ratio; dy++) for (let dx = 0; dx < ratio; dx++) {
        sum += elevSrc[(j * ratio + dy) * SRC + (i * ratio + dx)];
      }
      elev[j * P + i] = sum / (ratio * ratio);
    }
  }
}

const waterMask = new Uint8Array(N);
for (let k = 0; k < N; k++) waterMask[k] = elev[k] < 0 ? 1 : 0;
{
  let w = 0; for (let k = 0; k < N; k++) w += waterMask[k];
  console.log(`waterMask: ${w}/${N} px (${(w / N * 100).toFixed(1)}%)`);
}

// ---- 2. seal harbour entrances: dilate land by a disc, radius 16 px ----
const landMask = new Uint8Array(N);
for (let k = 0; k < N; k++) landMask[k] = waterMask[k] ? 0 : 1;

// Only land pixels touching water can extend the dilated-land footprint into
// water (interior land dilation is already subsumed by the land mask itself),
// so restrict the (expensive) disc stamp to the coastline shell.
const boundaryLand = [];
for (let j = 0; j < P; j++) {
  for (let i = 0; i < P; i++) {
    const k = j * P + i;
    if (!landMask[k]) continue;
    let isBoundary = false;
    for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
      const ny = j + dy;
      if (ny < 0 || ny >= P) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = i + dx;
        if (nx < 0 || nx >= P) continue;
        if (!landMask[ny * P + nx]) { isBoundary = true; break; }
      }
    }
    if (isBoundary) boundaryLand.push(k);
  }
}
console.log(`boundary land (coastline shell): ${boundaryLand.length} px`);

const R = SEAL_RADIUS, R2 = R * R;
const halfWidth = new Int32Array(2 * R + 1);
for (let dy = -R; dy <= R; dy++) halfWidth[dy + R] = Math.floor(Math.sqrt(Math.max(0, R2 - dy * dy)));

const dilatedLand = new Uint8Array(N);
for (let idx = 0; idx < boundaryLand.length; idx++) {
  const k = boundaryLand[idx];
  const cy = (k / P) | 0, cx = k % P;
  for (let dy = -R; dy <= R; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= P) continue;
    const hw = halfWidth[dy + R];
    let x0 = cx - hw, x1 = cx + hw;
    if (x0 < 0) x0 = 0;
    if (x1 >= P) x1 = P - 1;
    dilatedLand.fill(1, ny * P + x0, ny * P + x1 + 1);
  }
}

const sealedWater = new Uint8Array(N);
for (let k = 0; k < N; k++) sealedWater[k] = (waterMask[k] && !dilatedLand[k]) ? 1 : 0;

// ---- 3. flood fill sealedWater from the north/east edges ---------------
const oceanCore = new Uint8Array(N);
const queue = new Int32Array(N);
let qh = 0, qt = 0;
for (let i = 0; i < P; i++) {                 // north edge, row 0
  const k = i;
  if (sealedWater[k] && !oceanCore[k]) { oceanCore[k] = 1; queue[qt++] = k; }
}
for (let j = 0; j < P; j++) {                 // east edge, col P-1
  const k = j * P + (P - 1);
  if (sealedWater[k] && !oceanCore[k]) { oceanCore[k] = 1; queue[qt++] = k; }
}
while (qh < qt) {
  const k = queue[qh++];
  const cy = (k / P) | 0, cx = k % P;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= P) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx;
      if (nx < 0 || nx >= P) continue;
      const nk = ny * P + nx;
      if (sealedWater[nk] && !oceanCore[nk]) { oceanCore[nk] = 1; queue[qt++] = nk; }
    }
  }
}
{
  let c = 0; for (let k = 0; k < N; k++) c += oceanCore[k];
  console.log(`ocean core (sealed flood fill from N/E edges): ${c} px`);
}

// ---- 4. grow ocean label back through the ORIGINAL waterMask, 24 iters -
const dist = new Int8Array(N).fill(-1);
qh = 0; qt = 0;
for (let k = 0; k < N; k++) if (oceanCore[k]) { dist[k] = 0; queue[qt++] = k; }
while (qh < qt) {
  const k = queue[qh++];
  const d = dist[k];
  if (d >= GROW_ITERS) continue;
  const cy = (k / P) | 0, cx = k % P;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= P) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx;
      if (nx < 0 || nx >= P) continue;
      const nk = ny * P + nx;
      if (waterMask[nk] && dist[nk] === -1) { dist[nk] = d + 1; queue[qt++] = nk; }
    }
  }
}
const oceanMask = new Uint8Array(N);
let oceanCount = 0;
for (let k = 0; k < N; k++) if (dist[k] >= 0) { oceanMask[k] = 1; oceanCount++; }
const oceanFraction = oceanCount / N;
console.log(`ocean mask (post-growth): ${oceanCount}/${N} px, fraction = ${oceanFraction.toFixed(4)}`);

// ---- 5. gaussian-blur the binary mask, sigma ~2.5 px --------------------
const maskBytes = Buffer.alloc(N);
for (let k = 0; k < N; k++) maskBytes[k] = oceanMask[k] ? 255 : 0;
const blurredRaw = await sharp(maskBytes, { raw: { width: P, height: P, channels: 1 } })
  .blur(BLUR_SIGMA)
  .raw().toBuffer({ resolveWithObject: true });
// sharp (this version) promotes a 1-channel raw input to 3 identical channels
// through .blur(); take channel 0 either way (single-channel fast path if it
// ever stops doing that).
if (blurredRaw.info.channels !== 1 && blurredRaw.info.channels !== 3) throw new Error(`blurred mask has ${blurredRaw.info.channels} channels, expected 1 or 3`);
const bch2 = blurredRaw.info.channels;
const blurredMask = Buffer.alloc(N);
for (let k = 0; k < N; k++) blurredMask[k] = blurredRaw.data[k * bch2];

// ---- read original relief.png, verify format, compose new B channel ----
const orig = await sharp(RELIEF_PNG).raw().toBuffer({ resolveWithObject: true });
if (orig.info.width !== P || orig.info.height !== P) throw new Error(`relief.png is ${orig.info.width}x${orig.info.height}, expected ${P}x${P}`);
if (orig.info.channels !== 3) throw new Error(`relief.png has ${orig.info.channels} channels, expected 3 (RGB)`);
const origData = orig.data;

const newRaw = Buffer.alloc(N * 3);
for (let k = 0; k < N; k++) {
  const o = k * 3;
  newRaw[o] = origData[o];
  newRaw[o + 1] = origData[o + 1];
  newRaw[o + 2] = blurredMask[k];
}

const newPngBuffer = await sharp(newRaw, { raw: { width: P, height: P, channels: 3 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

// round-trip verification: R and G must be byte-identical to the original
const check = await sharp(newPngBuffer).raw().toBuffer({ resolveWithObject: true });
if (check.info.channels !== 3) throw new Error(`re-encoded relief.png has ${check.info.channels} channels, expected 3`);
let rgMismatch = 0;
for (let k = 0; k < N; k++) {
  const o = k * 3;
  if (check.data[o] !== origData[o] || check.data[o + 1] !== origData[o + 1]) rgMismatch++;
}
if (rgMismatch > 0) {
  throw new Error(`ABORT: R/G channel mismatch at ${rgMismatch} px after round-trip encode — refusing to overwrite relief.png`);
}
console.log('R/G channel round-trip check: byte-identical, OK to write.');

fs.writeFileSync(RELIEF_PNG, newPngBuffer);
console.log(`wrote ${RELIEF_PNG} (${(newPngBuffer.length / 1024).toFixed(0)} kB)`);

// ---- update relief.json --------------------------------------------------
const reliefJson = JSON.parse(fs.readFileSync(RELIEF_JSON, 'utf8'));
reliefJson.description = 'Land relief gradients for the raking-light hillshade, plus an open-coast ocean mask. R = dz/dEast, G = dz/dNorth (metres per metre, byte = grad/GRAD_MAX*0.5+0.5). Zero vector on water/nodata. B = ocean mask, see blueChannel.';
reliefJson.blueChannel = {
  description: `B = open-Pacific ocean mask (255 = open coast water, 0 = land or Tauranga Harbour interior water), gaussian-feathered sigma ~${BLUR_SIGMA}px at shores and the two harbour entrances (Tauranga, Bowentown). Baked from data/depth-composite-raw.f32 by morphological seal (land dilated ${SEAL_RADIUS}px to close the harbour entrances) + edge flood fill (open Pacific from the N/E map edges) + ${GROW_ITERS}-iteration masked regrowth through the original water mask. R and G are untouched land-relief gradients.`,
  bakedBy: 'bake-oceanmask.mjs',
  sealRadiusPx: SEAL_RADIUS,
  growIterations: GROW_ITERS,
  blurSigmaPx: BLUR_SIGMA,
  oceanFraction: Number(oceanFraction.toFixed(4)),
  note: 'If fetch-relief.mjs ever regenerates relief.png, this B channel is lost (fetch-relief.mjs writes B=0) — re-run bake-oceanmask.mjs afterward.',
};
fs.writeFileSync(RELIEF_JSON, JSON.stringify(reliefJson, null, 2));
console.log(`updated ${RELIEF_JSON} with blueChannel field.`);

// ---- debug overlay: base-fused.jpg + 40% red where mask is set ---------
const base = await sharp(BASE_JPG).resize(P, P).raw().toBuffer({ resolveWithObject: true });
const bch = base.info.channels;
if (bch < 3) throw new Error(`base-fused.jpg raw has ${bch} channels, expected >=3`);
const ALPHA_MAX = 0.4;
const overlay = Buffer.alloc(N * 3);
for (let k = 0; k < N; k++) {
  const bo = k * bch, oo = k * 3;
  const a = (blurredMask[k] / 255) * ALPHA_MAX;
  overlay[oo] = Math.round(base.data[bo] * (1 - a) + 255 * a);
  overlay[oo + 1] = Math.round(base.data[bo + 1] * (1 - a));
  overlay[oo + 2] = Math.round(base.data[bo + 2] * (1 - a));
}
await sharp(overlay, { raw: { width: P, height: P, channels: 3 } }).png().toFile(DEBUG_PNG);
console.log(`wrote ${DEBUG_PNG}`);

console.log(`\nSUMMARY: ocean fraction = ${oceanFraction.toFixed(4)} (expected ~0.25-0.40)`);
