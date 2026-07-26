// Build the renderer's field texture.
//
// The old field packed a CLASS channel — water / intertidal / land — and the shader
// thresholded it. That is what made the waterline look pixelated: a class raster has no
// meaning between samples, so it had to be read with NEAREST, and every coastline came out
// as 15 m staircases.
//
// This field carries ONE continuous surface instead: drying height, with always-wet water
// pushed below the tide range and always-dry land pushed above it. Nothing is a category any
// more, so the texture can be filtered, resampled and blurred like an elevation model, and
// the waterline becomes a smooth iso-contour the shader can antialias per screen pixel.
//
//   R  drying height, linear over H_LO..H_HI metres   (water = H_LO, land = H_HI)
//   G  bathymetric depth proxy: normalised distance from the water's edge, heavily smoothed.
//      The satellites cannot see under water at all (validation §4.3), so this is a shape,
//      not a measurement — it exists so the deep channels read as deep, and so night glow can
//      follow depth. Labelled a proxy everywhere it is used.
//   B  city lights: bright, near-grey, inland pixels of the basemap.
import fs from 'fs';
import sharp from 'sharp';

const N = 2600;                 // pipeline grid
const P = Number(process.argv[2] ?? 4096);   // output grid
const H_LO = -0.75, H_HI = 3.25;             // metres; tide range is 0.332..2.127
const DEEP_PX = 220;             // distance (source px, ~15 m each) at which the proxy saturates — wide, so the harbour channels sit mid-ramp and only the open sea reaches the far end

const enc = h => Math.max(0, Math.min(255, Math.round((h - H_LO) / (H_HI - H_LO) * 255)));

const { decodeGray16 } = await import('../pipeline/lib/png16.mjs');
const dec = decodeGray16(fs.readFileSync('data/drying-height.png'));
const h16 = dec.samples ?? dec.data ?? dec;
if (h16.length !== N * N) throw new Error(`drying-height is ${h16.length} px, expected ${N * N}`);
const harbour = await sharp('data/harbour-mask.png').extractChannel(0).raw().toBuffer();
const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));
const { heightMax } = META.encoding;

// ---- 1. the continuous height surface ---------------------------------------
const H = new Float32Array(N * N);
const isWater = new Uint8Array(N * N);
let nWater = 0, nLand = 0, nInter = 0, nFrozen = 0;
for (let i = 0; i < N * N; i++) {
  const v = h16[i];
  if (v === 0) { H[i] = H_LO; isWater[i] = 1; nWater++; }            // subtidal (and nodata)
  else if (v === 65535) { H[i] = H_HI; nLand++; }                     // supratidal
  else if (harbour[i] < 128) { H[i] = H_LO; isWater[i] = 1; nFrozen++; } // glint/surf outside the harbour: sea
  else { H[i] = (v - 1) / 65533 * heightMax; nInter++; }
}
console.log(`height surface: ${nWater} water, ${nInter} intertidal, ${nLand} land, ${nFrozen} frozen-as-sea`);

// ---- 2. bathymetric depth PROXY ---------------------------------------------
// Two-pass chamfer distance from the water's edge. Not a depth measurement — see the header.
const INF = 1e9;
const d = new Float32Array(N * N);
for (let i = 0; i < N * N; i++) d[i] = isWater[i] ? INF : 0;
const D1 = 1, D2 = 1.41421356;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = y * N + x; if (!d[i]) continue;
  let m = d[i];
  if (x > 0) m = Math.min(m, d[i - 1] + D1);
  if (y > 0) m = Math.min(m, d[i - N] + D1);
  if (x > 0 && y > 0) m = Math.min(m, d[i - N - 1] + D2);
  if (x < N - 1 && y > 0) m = Math.min(m, d[i - N + 1] + D2);
  d[i] = m;
}
for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
  const i = y * N + x; if (!d[i]) continue;
  let m = d[i];
  if (x < N - 1) m = Math.min(m, d[i + 1] + D1);
  if (y < N - 1) m = Math.min(m, d[i + N] + D1);
  if (x < N - 1 && y < N - 1) m = Math.min(m, d[i + N + 1] + D2);
  if (x > 0 && y < N - 1) m = Math.min(m, d[i + N - 1] + D2);
  d[i] = m;
}
const bathy = Buffer.alloc(N * N);
for (let i = 0; i < N * N; i++) {
  const t = Math.min(1, d[i] / DEEP_PX);
  bathy[i] = Math.round(255 * (t * t * (3 - 2 * t)));      // smoothstep, so the shelf eases in
}

// ---- 3. city lights ----------------------------------------------------------
// Bright AND near-grey AND set back from the water — surf is bright and white too. The
// luminance cut is adaptive (a fixed cut does not transfer between scenes: sun angle, season).
const baseN = await sharp('data/base-aerial.jpg').resize(N, N).removeAlpha().toColourspace('srgb').raw().toBuffer();
if (baseN.length !== N * N * 3) throw new Error(`base channels ${baseN.length / (N * N)}`);
const landMask = Buffer.alloc(N * N);
for (let i = 0; i < N * N; i++) landMask[i] = H[i] > 2.6 ? 255 : 0;
const landIn = await sharp(landMask, { raw: { width: N, height: N, channels: 1 } })
  .blur(4).extractChannel(0).raw().toBuffer();
const landLum = [];
for (let i = 0; i < N * N; i++) {
  if (H[i] <= 2.6 || landIn[i] < 250) continue;
  landLum.push((0.299 * baseN[i * 3] + 0.587 * baseN[i * 3 + 1] + 0.114 * baseN[i * 3 + 2]) / 255);
}
landLum.sort((a, b) => a - b);
const CUT = landLum[Math.floor(landLum.length * 0.985)];
const urban = Buffer.alloc(N * N);
let lit = 0;
for (let i = 0; i < N * N; i++) {
  if (H[i] <= 2.6 || landIn[i] < 250) continue;
  const R = baseN[i * 3], G = baseN[i * 3 + 1], B = baseN[i * 3 + 2];
  const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  if (lum <= CUT) continue;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  if (mx > 0 && (mx - mn) / mx > 0.20) continue;
  urban[i] = Math.min(255, Math.round((lum - CUT) / Math.max(1 - CUT, 0.02) * 255)); lit++;
}
const PX_KM2 = 14.9 * 16.2 / 1e6;
console.log(`city-light cut ${CUT.toFixed(3)} (98.5th pct of ${landLum.length} inland px); lit ${(lit * PX_KM2).toFixed(1)} km2`);

// ---- 4. resample to the render grid and smooth -------------------------------
// 'mitchell' rather than lanczos: lanczos rings at the land/water step and a ring in a height
// field is a phantom shoreline. The blur that follows is what actually removes the 15 m
// staircase; it is deliberately small (~1 output px = ~9 m) so it softens the raster without
// inventing flats on steep shores.
const h8raw = Buffer.alloc(N * N);
for (let i = 0; i < N * N; i++) h8raw[i] = enc(H[i]);
// A 3x3 median before anything else. The step fit leaves isolated pixels a bracket or two off
// their neighbours; blurring smears those into visible dark freckles across the flats, whereas
// a median deletes them outright and leaves real edges where they are.
const h8 = await sharp(h8raw, { raw: { width: N, height: N, channels: 1 } })
  .median(3).extractChannel(0).raw().toBuffer();
const up = async (buf, sigma) => {
  let p = sharp(buf, { raw: { width: N, height: N, channels: 1 } })
    .resize(P, P, { kernel: 'mitchell' });
  if (sigma) p = p.blur(sigma);
  return p.extractChannel(0).raw().toBuffer();
};
const hUp = await up(h8, 1.1);
const bUp = await up(bathy, 6 * P / 4096);
const cUp = await up(urban, 2 * P / 4096);
const glow = await sharp(urban, { raw: { width: N, height: N, channels: 1 } })
  .resize(P, P, { kernel: 'mitchell' }).blur(9 * P / 4096).extractChannel(0).raw().toBuffer();

const packed = Buffer.alloc(P * P * 3);
for (let i = 0; i < P * P; i++) {
  packed[i * 3] = hUp[i];
  packed[i * 3 + 1] = bUp[i];
  packed[i * 3 + 2] = Math.min(255, cUp[i] * 0.85 + glow[i]);
}
await sharp(packed, { raw: { width: P, height: P, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile('data/field-v2.png');

fs.writeFileSync('data/field-v2.json', JSON.stringify({
  description: 'Renderer field. R = continuous drying height, G = bathymetric depth PROXY (not measured), B = city lights.',
  size: P, sourceSize: N,
  heightEncoding: { lo: H_LO, hi: H_HI, toMetres: 'h = lo + r/255 * (hi - lo)' },
  waterSentinel: H_LO, landSentinel: H_HI,
  depthProxy: { method: 'chamfer distance from the water edge, saturating at ' + DEEP_PX + ' source px', saturatesAtKm: +(DEEP_PX * 0.0155).toFixed(2), measured: false },
  smoothing: { resampleKernel: 'mitchell', heightBlurSigmaPx: 1.1 },
}, null, 2));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`data/field-v2.png ${kb('data/field-v2.png')} at ${P}px`);
