// High-res build. Bakes the FULL raster extent (not a fixed crop) so framing can be
// changed live in the renderer, and pulls the basemap at native Sentinel-2 resolution.
import fs from 'fs';
import sharp from 'sharp';

const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));
const { west: W, south: S, east: E, north: Nn } = META.bbox;
const N = META.size.width;                 // 2600 data grid
const BASE_PX = 2800;                      // ~12.9 m/px over the full extent
const { heightMax } = META.encoding;
const SCENE = 'S2A_60HVD_20240703_0_L2A';  // cloud-free, 0.42 m — most exposed flats

// sharp's raw output channel count depends on the input's alpha, NOT on what you expect.
// Every bug in this file so far has been a channel-count assumption, so assert it.
async function rawRGB(input, w, h, opts) {
  const b = await sharp(input, opts).removeAlpha().toColourspace('srgb').raw().toBuffer();
  if (b.length !== w * h * 3) throw new Error(`expected ${w*h*3} bytes of RGB, got ${b.length} (${(b.length/(w*h)).toFixed(2)} channels)`);
  return b;
}


// ---------- basemap at native resolution, tiled (titiler caps ~1400 px/request) ----------
const G = 3, T = Math.ceil(BASE_PX / G);
const dLon = (E - W) / G, dLat = (Nn - S) / G;
const item = `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${SCENE}`;
const href = (await (await fetch(item)).json()).assets.visual.href;

async function tile(gx, gy) {
  const w = W + gx * dLon, e = w + dLon, n = Nn - gy * dLat, s = n - dLat;
  const u = `https://titiler.xyz/cog/bbox/${w},${s},${e},${n}/${T}x${T}.png?url=${href}`;
  for (let a = 0; a < 5; a++) {
    const r = await fetch(u);
    if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 5000) return b; }
    await new Promise(z => setTimeout(z, 1200 * (a + 1)));
  }
  throw new Error(`tile ${gx},${gy}`);
}
if (!fs.existsSync('data/base-hi.png')) {
  const parts = [];
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) parts.push({ gx, gy, buf: await tile(gx, gy) });
  await sharp({ create: { width: T * G, height: T * G, channels: 3, background: '#000' } })
    .composite(parts.map(p => ({ input: p.buf, left: p.gx * T, top: p.gy * T })))
    .png().toFile('data/base-hi.png');
  console.log(`basemap composited ${T * G}x${T * G}`);
}


// ---------- data planes at the raster grid ----------
const { decodeGray16 } = await import('../pipeline/lib/png16.mjs');
const dec = decodeGray16(fs.readFileSync('data/drying-height.png'));
const h16 = dec.samples ?? dec.data ?? dec;
const harbour = await sharp('data/harbour-mask.png').extractChannel(0).raw().toBuffer();
const baseN = await rawRGB(await sharp('data/base-hi.png').resize(N, N).png().toBuffer(), N, N);

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

// city lights: bright AND near-grey AND set back from the water (surf is bright and white too)
const landMask = Buffer.alloc(N * N);
for (let i = 0; i < N * N; i++) landMask[i] = h16[i] === 65535 ? 255 : 0;
const landIn = await sharp(landMask, { raw: { width: N, height: N, channels: 1 } })
  .blur(4).extractChannel(0).raw().toBuffer();
// Adaptive threshold: a fixed cut does not transfer between scenes (sun angle, season).
// Take the top slice of the land-luminance distribution instead.
const landLum = [];
for (let i = 0; i < N * N; i++) {
  if (h16[i] !== 65535 || landIn[i] < 250) continue;
  landLum.push((0.299 * baseN[i * 3] + 0.587 * baseN[i * 3 + 1] + 0.114 * baseN[i * 3 + 2]) / 255);
}
landLum.sort((a, b) => a - b);
const CUT = landLum[Math.floor(landLum.length * 0.985)];
console.log(`city-light luminance cut ${CUT.toFixed(3)} (98.5th pct of ${landLum.length} inland px)`);

const urban = Buffer.alloc(N * N);
let lit = 0;
for (let i = 0; i < N * N; i++) {
  if (h16[i] !== 65535) continue;
  const R = baseN[i * 3], Gc = baseN[i * 3 + 1], B = baseN[i * 3 + 2];
  const lum = (0.299 * R + 0.587 * Gc + 0.114 * B) / 255;
  if (lum <= CUT) continue;
  const mx = Math.max(R, Gc, B), mn = Math.min(R, Gc, B);
  if (mx > 0 && (mx - mn) / mx > 0.20) continue;
  if (landIn[i] < 250) continue;
  urban[i] = Math.min(255, (lum - CUT) / Math.max(1 - CUT, 0.02) * 255); lit++;
}
const glow = await sharp(urban, { raw: { width: N, height: N, channels: 1 } })
  .blur(9).extractChannel(0).raw().toBuffer();

const packed = Buffer.alloc(N * N * 3);
for (let i = 0; i < N * N; i++) {
  const v = h16[i];
  let r = 0, g;
  if (v === 0) g = 0;
  else if (v === 65535) g = 255;
  else if (!keep[lab[i]] || harbour[i] < 128) {
    const R = baseN[i * 3], Gc = baseN[i * 3 + 1], B = baseN[i * 3 + 2];
    const lum = (0.299 * R + 0.587 * Gc + 0.114 * B) / 255;
    g = (B > R && lum < 0.34) ? 0 : 255;
  } else { g = 128; r = Math.round((v - 1) / 65533 * heightMax / 2.5 * 255); }
  packed[i * 3] = r; packed[i * 3 + 1] = g; packed[i * 3 + 2] = Math.min(255, urban[i] * 0.85 + glow[i]);
}
console.log(`city lights ${(lit * PX_KM2).toFixed(1)} km2`);

await sharp(packed, { raw: { width: N, height: N, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile('data/field-hi.png');
// straight PNG -> JPEG, no raw round trip to get the channels wrong
await sharp('data/base-hi.png').resize(BASE_PX, BASE_PX).removeAlpha()
  .jpeg({ quality: 78, mozjpeg: true }).toFile('data/base-hi.jpg');

const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`field-hi.png ${kb('data/field-hi.png')} (${N}px)   base-hi.jpg ${kb('data/base-hi.jpg')} (${BASE_PX}px)`);
