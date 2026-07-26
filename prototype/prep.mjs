// Prepare prototype assets: pack the drying-height raster + a basemap into
// browser-readable images, rotated 38 deg and cropped 4:3 for iPad landscape.
import fs from 'fs';
import sharp from 'sharp';

const SRC_RASTER = 'data/drying-height.png';     // 16-bit, 2600x2600
const SRC_CLASS  = 'data/classes.png';           // 8-bit
const SRC_BASE   = '../research/series/tauranga_0p31m_2023-06-14.jpg'; // same bbox, 3900x3900
const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));

const ROT = -38;
const OUT_W = 1400, OUT_H = 1050;                // 4:3
const N = META.size.width;

// --- read the 16-bit height raster and the class raster ---
// sharp SILENTLY downconverts 16-bit PNG input to 8 bits — it cannot be used to read
// this raster. Decode the PNG properly instead (same decoder the pipeline verifies with).
const { decodeGray16 } = await import('../pipeline/lib/png16.mjs');
const decoded = decodeGray16(fs.readFileSync(SRC_RASTER));
const h16 = decoded.samples ?? decoded.data ?? decoded;
const cls = await sharp(SRC_CLASS).raw().toBuffer();
if (h16.length !== N * N) throw new Error(`height raster is ${h16.length}, expected ${N * N}`);

// sanity: the encoding says 0 = subtidal, 65535 = supratidal, else height
let sub = 0, sup = 0, inter = 0, hmin = 9, hmax = -9;
const { heightMax } = META.encoding;
for (let i = 0; i < h16.length; i++) {
  const v = h16[i];
  if (v === 0) sub++;
  else if (v === 65535) sup++;
  else { inter++; const h = (v - 1) / 65533 * heightMax; if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
}
console.log(`raster: subtidal ${(sub / h16.length * 100).toFixed(1)}%  intertidal ${(inter / h16.length * 100).toFixed(1)}%  supratidal ${(sup / h16.length * 100).toFixed(1)}%`);
console.log(`intertidal drying height range: ${hmin.toFixed(2)} .. ${hmax.toFixed(2)} m`);

// Ocean glint and flooded farmland carry plausible-but-meaningless drying heights. They
// are excluded from the pipeline's statistics, but they WOULD flicker on screen, so they
// must be neutralised here.
//
// Two defences, because they catch different things:
//   1. harbour-mask.png (round 4, derived from the data by eroding until the entrance necks
//      sever — no hand-drawn polygon). Verified here: intertidal 138.2 km2 inside vs 29.9
//      outside, 4.6:1. This catches the ~21 km2 of open-water sun glint, which arrives as
//      LARGE connected components that despeckling cannot touch.
//   2. connected-component despeckling, for the 6,403 sub-0.05 km2 blobs (7.3 km2).
//
// NB: sharp silently expands a 1-channel PNG to RGB on raw output, so the mask MUST be read
// with extractChannel(0). Indexing the interleaved buffer as if it were single-channel
// scrambles the geometry and produces a convincing-looking but meaningless mask.
const MIN_KM2 = 0.05;
const PX_KM2 = 14.9 * 16.2 / 1e6;
const isInter = new Uint8Array(N * N);
for (let i = 0; i < N * N; i++) isInter[i] = (h16[i] !== 0 && h16[i] !== 65535) ? 1 : 0;

const lab = new Int32Array(N * N).fill(-1), stack = new Int32Array(N * N), sizes = [];
for (let s = 0; s < N * N; s++) {
  if (!isInter[s] || lab[s] >= 0) continue;
  const id = sizes.length; let sp = 0, cnt = 0; stack[sp++] = s; lab[s] = id;
  while (sp) {
    const p = stack[--sp]; cnt++;
    const x = p % N, y = (p / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const q = ny * N + nx;
      if (isInter[q] && lab[q] < 0) { lab[q] = id; stack[sp++] = q; }
    }
  }
  sizes.push(cnt);
}
const keep = sizes.map(c => c * PX_KM2 >= MIN_KM2);
const harbour = await sharp('data/harbour-mask.png').extractChannel(0).raw().toBuffer();
const baseSmall = await sharp(SRC_BASE).resize(N, N, { kernel: 'nearest' }).raw().toBuffer();

const packed = Buffer.alloc(N * N * 3);
let dropped = 0;
for (let i = 0; i < N * N; i++) {
  const v = h16[i];
  let r = 0, g;
  if (v === 0) { g = 0; }                                   // subtidal — always wet
  else if (v === 65535) { g = 255; }                        // supratidal — always dry
  else if (!keep[lab[i]] || harbour[i] < 128) {             // speckle or non-harbour — freeze
    const R = baseSmall[i * 3], G = baseSmall[i * 3 + 1], B = baseSmall[i * 3 + 2];
    const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
    g = (B > R && lum < 0.34) ? 0 : 255;                    // sea-like -> water, else land
    dropped++;
  } else { g = 128; r = Math.round((v - 1) / 65533 * heightMax / 2.5 * 255); }
  packed[i * 3] = r; packed[i * 3 + 1] = g; packed[i * 3 + 2] = cls[i];
}
console.log(`frozen ${dropped} px = ${(dropped * PX_KM2).toFixed(1)} km2 (speckle + outside harbour mask)`);

// Rotate a square source and take the largest centred 4:3 crop that stays inside
// the rotated square's inscribed circle (so no black corners creep in).
async function frame(input, side, opts) {
  // rotate must be re-encoded before it can be read back as an image
  const rot = await sharp(input, opts).rotate(ROT, { background: '#000' }).png().toBuffer();
  const m = await sharp(rot).metadata();
  const R = side / 2;
  const h = Math.floor(2 * R / Math.hypot(4 / 3, 1) * 0.995), w = Math.round(h * 4 / 3);
  return sharp(rot).extract({
    left: Math.round((m.width - w) / 2), top: Math.round((m.height - h) / 2), width: w, height: h,
  });
}

// nearest-neighbour for the data raster — never interpolate a class boundary
await (await frame(packed, N, { raw: { width: N, height: N, channels: 3 } }))
  .resize(OUT_W, OUT_H, { kernel: 'nearest' })
  .png({ compressionLevel: 9 })
  .toFile('data/field.png');

await (await frame(SRC_BASE, 3900))
  .resize(OUT_W, OUT_H)
  .jpeg({ quality: 82 })
  .toFile('data/base.jpg');

const stat = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`field.png ${stat('data/field.png')}   base.jpg ${stat('data/base.jpg')}   ${OUT_W}x${OUT_H}`);
fs.writeFileSync('data/field.json', JSON.stringify({
  width: OUT_W, height: OUT_H, rotationDeg: ROT,
  encoding: { heightFromRed: 'h = R/255*2.5', classGreen: { 0: 'subtidal', 128: 'intertidal', 255: 'supratidal' } },
  sourceBbox: META.bbox, note: 'rotated and cropped from the 2600px north-up raster',
}, null, 2));
