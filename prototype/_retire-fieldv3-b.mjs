// SCRATCH (disposable) — one-shot in-place edit of data/field-v3.png: zero the B channel (city
// lights moved to data/citylights-points.png, see prep-field3.mjs). R/A carry the packed 16-bit
// height (sub-mm precision) and G is bathymetry — they MUST survive byte-identical. Backs up the
// original to a temp file, re-encodes, then reloads and asserts R/G/A unchanged and B==0
// everywhere before declaring success. Never pass `effort` to sharp .png() here — see build-v2.mjs
// header comment: it corrupts RGBA wherever alpha<255, which is everywhere in this file.
import fs from 'fs';
import sharp from 'sharp';

const FILE = 'data/field-v3.png';
const BACKUP = 'data/field-v3.png.pre-b-retire.bak';

fs.copyFileSync(FILE, BACKUP);

const before = await sharp(BACKUP).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
if (before.info.channels !== 4) throw new Error(`expected 4 channels, got ${before.info.channels}`);
const { width, height } = before.info;
const N = width * height;

const out = Buffer.alloc(N * 4);
before.data.copy(out);
for (let i = 0; i < N; i++) out[i * 4 + 2] = 0; // B = 0

await sharp(out, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(FILE);

const after = await sharp(FILE).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
if (after.info.channels !== 4) throw new Error(`post-write: expected 4 channels, got ${after.info.channels}`);
if (after.info.width !== width || after.info.height !== height) throw new Error('post-write: dimension mismatch');

let rMismatch = 0, gMismatch = 0, aMismatch = 0, bNonzero = 0;
for (let i = 0; i < N; i++) {
  const o = i * 4;
  if (after.data[o] !== before.data[o]) rMismatch++;
  if (after.data[o + 1] !== before.data[o + 1]) gMismatch++;
  if (after.data[o + 2] !== 0) bNonzero++;
  if (after.data[o + 3] !== before.data[o + 3]) aMismatch++;
}
console.log(`R mismatches: ${rMismatch}, G mismatches: ${gMismatch}, A mismatches: ${aMismatch}, B nonzero: ${bNonzero} (of ${N})`);
if (rMismatch || gMismatch || aMismatch || bNonzero) {
  fs.copyFileSync(BACKUP, FILE); // restore on failure
  throw new Error('ABORT: byte-identity or B==0 assertion failed — restored original field-v3.png from backup');
}
console.log('PASS: R, G, A byte-identical; B==0 everywhere.');
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`field-v3.png: ${kb(BACKUP)} -> ${kb(FILE)}`);
fs.unlinkSync(BACKUP);
