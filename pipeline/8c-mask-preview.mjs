// Visual check of the shipped mask, plus the polygon-vs-mask symmetric difference.
import fs from 'fs'; import path from 'path'; import sharp from 'sharp';
import { NPIX, SIZE, dirs, CLS_INTERTIDAL, CLS_SUBTIDAL, CLS_SUPRATIDAL } from './lib/config.mjs';
import { harbourMask, pixelAreaKm2 } from './lib/regions.mjs';
const A = pixelAreaKm2();
const fit = fs.readFileSync(path.join(dirs.out, 'fit.bin'));
const classes = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 2, NPIX);
const png = await sharp(path.join(dirs.out, 'harbour-mask.png')).raw().toBuffer({ resolveWithObject: true });
const ch = png.info.channels;
const M = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
const poly = harbourMask();
let onlyPoly = 0, onlyMask = 0, both = 0;
for (let i = 0; i < NPIX; i++) {
  if (classes[i] !== CLS_INTERTIDAL) continue;
  const m = M[i * ch] === 255, p = poly[i] === 1;
  if (m && p) both++; else if (p) onlyPoly++; else if (m) onlyMask++;
}
console.log(`intertidal in BOTH ${(both * A).toFixed(1)} km2 | only old polygon ${(onlyPoly * A).toFixed(1)} km2 | only new mask ${(onlyMask * A).toFixed(1)} km2`);
console.log(`symmetric difference ${((onlyPoly + onlyMask) * A).toFixed(1)} km2 = ${(100 * (onlyPoly + onlyMask) / (both + onlyPoly + onlyMask)).toFixed(1)}% of the scored pixel set`);
const rgb = new Uint8Array(NPIX * 3);
for (let i = 0; i < NPIX; i++) {
  const m = M[i * ch] === 255;
  let c;
  if (classes[i] === CLS_INTERTIDAL) c = m ? [235, 190, 95] : [225, 40, 40];
  else if (classes[i] === CLS_SUBTIDAL) c = m ? [30, 90, 175] : [14, 26, 52];
  else c = m ? [90, 130, 90] : [34, 38, 32];
  rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
}
await sharp(Buffer.from(rgb.buffer), { raw: { width: SIZE, height: SIZE, channels: 3 } })
  .resize(1300, 1300, { kernel: 'nearest' }).png().toFile(path.join(dirs.out, 'preview-harbour-mask.png'));
console.log('wrote out/preview-harbour-mask.png  (tan/blue = inside mask, RED = intertidal dropped, dark = outside)');
