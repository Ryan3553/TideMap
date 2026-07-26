// Reproject the ARCHIVED LINZ z14 mercator mosaic onto the raster's equirectangular grid.
// Same maths as fetch-linz.mjs but reads sources/linz-aerial/ instead of the network, so it
// needs no LINZ_KEY. Output size is 5120, not 4096: the archived mosaic is 5376x5888 over
// this bbox (7.57 m/px), so 4096 was throwing away a quarter of the detail that was already
// on disk. Past ~5120 there is nothing left to recover — that is the z14 ceiling.
import fs from 'fs';
import sharp from 'sharp';

const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));
const { west: W, south: S, east: E, north: Nn } = META.bbox;
const SRC = '../sources/linz-aerial/mosaic-z14-mercator.png';
const PROV = JSON.parse(fs.readFileSync('../sources/linz-aerial/mosaic-z14.json', 'utf8'));
const OUT = process.argv[2] ?? 'data/base-linz.jpg';
const OUT_PX = Number(process.argv[3] ?? 5120);
const Z = PROV.zoom, TS = PROV.tileSize, { x0, y0 } = PROV.tileRange;

const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const tileY = (lat, z) => (1 - merc(lat) / Math.PI) / 2 * 2 ** z;

const { data: mosaic, info } = await sharp(SRC).removeAlpha().toColourspace('srgb')
  .raw().toBuffer({ resolveWithObject: true });
const mW = info.width, mH = info.height;
if (info.channels !== 3) throw new Error(`mosaic channels ${info.channels}`);
if (mW !== PROV.mosaicPx[0] || mH !== PROV.mosaicPx[1]) throw new Error('mosaic size does not match provenance');
console.log(`mosaic ${mW}x${mH} -> ${OUT_PX}x${OUT_PX}`);

const lonOfCol = c => (x0 + c / TS) / 2 ** Z * 360 - 180;
const rowOfLat = lat => (tileY(lat, Z) - y0) * TS;
const colScale = mW / (lonOfCol(mW) - lonOfCol(0));
const lon0 = lonOfCol(0), lonSpan = E - W, latSpan = Nn - S;

const out = Buffer.alloc(OUT_PX * OUT_PX * 3);
for (let j = 0; j < OUT_PX; j++) {
  const sy = rowOfLat(Nn - (j + 0.5) / OUT_PX * latSpan);
  const yA = Math.max(0, Math.min(mH - 1, Math.floor(sy))), fy = sy - yA;
  const yB = Math.min(mH - 1, yA + 1);
  for (let i = 0; i < OUT_PX; i++) {
    const sx = (W + (i + 0.5) / OUT_PX * lonSpan - lon0) * colScale;
    const xA = Math.max(0, Math.min(mW - 1, Math.floor(sx))), fx = sx - xA;
    const xB = Math.min(mW - 1, xA + 1);
    const o = (j * OUT_PX + i) * 3;
    const iA = (yA * mW + xA) * 3, iB = (yA * mW + xB) * 3, iC = (yB * mW + xA) * 3, iD = (yB * mW + xB) * 3;
    for (let k = 0; k < 3; k++) {
      out[o + k] = (mosaic[iA + k] * (1 - fx) + mosaic[iB + k] * fx) * (1 - fy)
                 + (mosaic[iC + k] * (1 - fx) + mosaic[iD + k] * fx) * fy;
    }
  }
  if ((j + 1) % 512 === 0) process.stdout.write(`\r  ${j + 1}/${OUT_PX}  `);
}
await sharp(out, { raw: { width: OUT_PX, height: OUT_PX, channels: 3 } })
  .jpeg({ quality: 82, mozjpeg: true }).toFile(OUT);
console.log(`\n${OUT} ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB  ${OUT_PX}px  ~${(0.44 * 111320 * Math.cos(37.6 * Math.PI / 180) / OUT_PX).toFixed(2)} m/px`);
