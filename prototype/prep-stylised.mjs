// Stylised build: NORTH UP, 4:3, no rotation. Packs three data planes into one RGB image:
//   R = drying height (0..2.5 m)   G = class   B = blurred city-light glow
import fs from 'fs';
import sharp from 'sharp';

const SRC_RASTER = 'data/drying-height.png';
const SRC_MASK   = 'data/harbour-mask.png';
const SRC_BASE   = '../research/series/tauranga_0p31m_2023-06-14.jpg'; // same bbox, 3900px
const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));
const N = META.size.width, OUT_W = 1600, OUT_H = 1200;
const { heightMax } = META.encoding;

// sharp cannot read 16-bit PNGs (silently truncates to 8-bit) — decode properly.
const { decodeGray16 } = await import('../pipeline/lib/png16.mjs');
const dec = decodeGray16(fs.readFileSync(SRC_RASTER));
const h16 = dec.samples ?? dec.data ?? dec;
// sharp expands 1-channel PNGs to RGB on raw output — extractChannel or the geometry scrambles.
const harbour = await sharp(SRC_MASK).extractChannel(0).raw().toBuffer();
const base = await sharp(SRC_BASE).resize(N, N, { kernel: 'lanczos3' }).raw().toBuffer();

// --- despeckle: drop intertidal components under 0.05 km2 (the mask handles the big glint) ---
const PX_KM2 = 14.9 * 16.2 / 1e6, MIN_KM2 = 0.05;
const isInter = new Uint8Array(N * N);
for (let i = 0; i < N * N; i++) isInter[i] = (h16[i] !== 0 && h16[i] !== 65535) ? 1 : 0;
const lab = new Int32Array(N * N).fill(-1), st = new Int32Array(N * N), sizes = [];
for (let s = 0; s < N * N; s++) {
  if (!isInter[s] || lab[s] >= 0) continue;
  const id = sizes.length; let sp = 0, cnt = 0; st[sp++] = s; lab[s] = id;
  while (sp) {
    const p = st[--sp]; cnt++; const x = p % N, y = (p / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const q = ny * N + nx;
      if (isInter[q] && lab[q] < 0) { lab[q] = id; st[sp++] = q; }
    }
  }
  sizes.push(cnt);
}
const keep = sizes.map(c => c * PX_KM2 >= MIN_KM2);

// --- city lights ---
// Three filters, because the first two are not enough:
//   bright        - towns are bright
//   near-grey     - beach SAND is bright and warm; concrete and roofs are grey
//   set back from the water - breaking SURF is bright and white too, and passes the chroma
//                   test. What separates it from a town is that surf sits on the waterline
//                   and towns do not. Erode the land mask and only light what is inland.
const landMask = Buffer.alloc(N * N);
for (let i = 0; i < N * N; i++) landMask[i] = h16[i] === 65535 ? 255 : 0;
const landIn = await sharp(landMask, { raw: { width: N, height: N, channels: 1 } })
  .blur(4).extractChannel(0).raw().toBuffer();      // blur+threshold ~= erosion

const urban = Buffer.alloc(N * N);
let rejSand = 0, rejEdge = 0;
for (let i = 0; i < N * N; i++) {
  if (h16[i] !== 65535) continue;
  const R = base[i * 3], G = base[i * 3 + 1], B = base[i * 3 + 2];
  const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  if (lum <= 0.42) continue;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  if (mx > 0 && (mx - mn) / mx > 0.20) { rejSand++; continue; }
  if (landIn[i] < 250) { rejEdge++; continue; }     // within ~4 px of water -> surf/beach
  urban[i] = Math.min(255, (lum - 0.42) * 620);
}
const glow = await sharp(urban, { raw: { width: N, height: N, channels: 1 } })
  .blur(9).extractChannel(0).raw().toBuffer();
// Bake crisp cores AND halo into one channel so the shader needs no live heuristics.
const light = Buffer.alloc(N * N);
let lit = 0;
for (let i = 0; i < N * N; i++) {
  light[i] = Math.min(255, urban[i] * 0.85 + glow[i]);
  if (urban[i] > 0) lit++;
}
console.log(`city lights: ${lit} px (${(lit * PX_KM2).toFixed(1)} km2); rejected ${rejSand} sandy, ${rejEdge} shoreline`);

// --- pack ---
const packed = Buffer.alloc(N * N * 3);
let frozen = 0;
for (let i = 0; i < N * N; i++) {
  const v = h16[i];
  let r = 0, g;
  if (v === 0) g = 0;
  else if (v === 65535) g = 255;
  else if (!keep[lab[i]] || harbour[i] < 128) {
    const R = base[i * 3], G = base[i * 3 + 1], B = base[i * 3 + 2];
    const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
    g = (B > R && lum < 0.34) ? 0 : 255; frozen++;
  } else { g = 128; r = Math.round((v - 1) / 65533 * heightMax / 2.5 * 255); }
  packed[i * 3] = r; packed[i * 3 + 1] = g; packed[i * 3 + 2] = light[i];
}
console.log(`frozen ${(frozen * PX_KM2).toFixed(1)} km2 of non-harbour / speckle`);

// --- choose the NORTH-UP 4:3 crop from the real extent of the intertidal ---
// Use percentiles, not min/max: a few stray pixels at the frame edge would otherwise
// drag the crop right across the harbour.
const xs = [], ys = [];
for (let i = 0; i < N * N; i++) {
  if (packed[i * 3 + 1] !== 128) continue;
  xs.push(i % N); ys.push((i / N) | 0);
}
xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
const q = (arr, p) => arr[Math.floor((arr.length - 1) * p)];
const minX = q(xs, 0.002), maxX = q(xs, 0.998), minY = q(ys, 0.002), maxY = q(ys, 0.998);
console.log(`intertidal extent (0.2-99.8 pct): x ${minX}..${maxX}  y ${minY}..${maxY}`);

// The harbour is TALLER than a 4:3 landscape frame allows at full width (N-S extent 1890 px
// vs 3/4 of its E-W extent = 1326), so a frame containing all of it is forced to full width
// and fills 40% of the screen with empty ocean. Zoom in instead and let the far ends run off
// frame — the reference does exactly this.
const cw = Math.min(N, Math.round((maxX - minX) * 1.06));
const ch = Math.min(N, Math.round(cw * 3 / 4));
const midX = q(xs, 0.5), midY = q(ys, 0.5);          // median = the mass of the flats
const left = Math.max(0, Math.min(N - cw, midX - (cw >> 1)));
const top  = Math.max(0, Math.min(N - ch, midY - (ch >> 1)));
console.log(`crop ${cw}x${ch} at (${left},${top}) centred on median intertidal (${midX},${midY})`);

const region = { left, top, width: cw, height: ch };
await sharp(packed, { raw: { width: N, height: N, channels: 3 } })
  .extract(region)
  .resize(OUT_W, OUT_H, { kernel: 'nearest' })
  .png({ compressionLevel: 9 }).toFile('data/field-nu.png');

// two steps: resize to the raster grid first, THEN crop, so the extract region is
// unambiguously in raster coordinates
const baseGrid = await sharp(SRC_BASE).resize(N, N, { kernel: 'lanczos3' }).png().toBuffer();
await sharp(baseGrid).extract(region)
  .resize(OUT_W, OUT_H).jpeg({ quality: 84 }).toFile('data/base-nu.jpg');

const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`field-nu.png ${kb('data/field-nu.png')}   base-nu.jpg ${kb('data/base-nu.jpg')}`);
