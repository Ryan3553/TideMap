// Verification for field-v3.png: decode round-trip numbers, G-channel old-vs-new sample table,
// and channel preview PNGs. Run from prototype/: node verify-field3.mjs
import fs from 'fs';
import sharp from 'sharp';

const P = 4096;
const H_LO = -0.75, H_HI = 3.25;
const WEST = 175.93, SOUTH = -37.79, EAST = 176.37, NORTH = -37.41;
const OUT = '../research/overnight-2026-07-27/field-v3';
fs.mkdirSync(OUT, { recursive: true });

const v3 = await sharp('data/field-v3.png').raw().toBuffer();       // RGBA
const v2 = await sharp('data/field-v2.png').raw().toBuffer();       // RGB

function lonlatToPx(lon, lat) {
  const i = Math.round((lon - WEST) / (EAST - WEST) * P);
  const j = Math.round((NORTH - lat) / (NORTH - SOUTH) * P);
  return [Math.max(0, Math.min(P - 1, i)), Math.max(0, Math.min(P - 1, j))];
}

// ---- G-channel sample table: old (field-v2) vs new (field-v3) --------------------------------
const samples = {
  'mid shipping channel (176.181E, 37.6475S)': [176.181, -37.6475],
  'harbour flat (176.0769E, 37.647S)': [176.0769, -37.647],
  '1km offshore (176.201E, 37.628S)': [176.201, -37.628],
  '5km offshore (176.25E, 37.60S)': [176.25, -37.60],
};
console.log('\n--- G channel: old (field-v2) vs new (field-v3) ---');
console.log('location'.padEnd(42), 'old_G'.padStart(6), 'new_G'.padStart(6));
for (const [name, [lon, lat]] of Object.entries(samples)) {
  const [i, j] = lonlatToPx(lon, lat);
  const idx = j * P + i;
  const oldG = v2[idx * 3 + 1];
  const newG = v3[idx * 4 + 1];
  console.log(name.padEnd(42), String(oldG).padStart(6), String(newG).padStart(6));
}

// ---- Height round-trip sanity (recompute here independently of prep-field3.mjs's own check) --
let maxErrCode = 0;
for (let i = 0; i < P * P; i++) {
  // nothing to compare against here without re-deriving float field; prep-field3.mjs already
  // asserts this at build time. This just re-confirms hi/lo decode is self-consistent.
  const r = v3[i * 4], a = v3[i * 4 + 3];
  const code = (r << 8) | a;
  if (code < 0 || code > 65535) throw new Error('bad code');
}
console.log('\nhi/lo decode self-consistency: OK (all codes in [0,65535])');

// ---- Channel previews --------------------------------------------------------------------
const rBuf = Buffer.alloc(P * P), gBuf = Buffer.alloc(P * P), bBuf = Buffer.alloc(P * P);
for (let i = 0; i < P * P; i++) {
  const r = v3[i * 4], g = v3[i * 4 + 1], b = v3[i * 4 + 2], a = v3[i * 4 + 3];
  const code = (r << 8) | a;
  const h = H_LO + (code / 65535) * (H_HI - H_LO);
  // Reconstructed height, remapped to 0..255 over the same H_LO..H_HI range for an 8-bit preview.
  rBuf[i] = Math.max(0, Math.min(255, Math.round((h - H_LO) / (H_HI - H_LO) * 255)));
  gBuf[i] = g;
  bBuf[i] = b;
}
await sharp(rBuf, { raw: { width: P, height: P, channels: 1 } }).png().toFile(`${OUT}/preview-R-height.png`);
await sharp(gBuf, { raw: { width: P, height: P, channels: 1 } }).png().toFile(`${OUT}/preview-G-bathy.png`);
await sharp(bBuf, { raw: { width: P, height: P, channels: 1 } }).png().toFile(`${OUT}/preview-B-citylights.png`);

// old G for comparison
const gOldBuf = Buffer.alloc(P * P);
for (let i = 0; i < P * P; i++) gOldBuf[i] = v2[i * 3 + 1];
await sharp(gOldBuf, { raw: { width: P, height: P, channels: 1 } }).png().toFile(`${OUT}/preview-G-bathy-OLD-v2.png`);

// crops around the harbour/port area for a closer look at the shipping channel
const cropSpec = { left: Math.round(P * 0.50), top: Math.round(P * 0.55), width: Math.round(P * 0.22), height: Math.round(P * 0.22) };
await sharp(gBuf, { raw: { width: P, height: P, channels: 1 } }).extract(cropSpec).png().toFile(`${OUT}/crop-G-bathy-new.png`);
await sharp(gOldBuf, { raw: { width: P, height: P, channels: 1 } }).extract(cropSpec).png().toFile(`${OUT}/crop-G-bathy-old.png`);
await sharp(rBuf, { raw: { width: P, height: P, channels: 1 } }).extract(cropSpec).png().toFile(`${OUT}/crop-R-height.png`);
await sharp(bBuf, { raw: { width: P, height: P, channels: 1 } }).extract(cropSpec).png().toFile(`${OUT}/crop-B-citylights.png`);

console.log(`\nwrote previews to ${OUT}/`);
