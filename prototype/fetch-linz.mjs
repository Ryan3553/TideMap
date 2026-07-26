// Fetch LINZ 0.1 m aerial (LDS layer 123991, BoP 2025) over the harbour and reproject it
// from Web Mercator onto the same equirectangular grid the drying-height raster uses.
// The API key is used at BUILD time only and never reaches the published page.
import fs from 'fs';
import sharp from 'sharp';

const KEY = process.env.LINZ_KEY;
if (!KEY) throw new Error('set LINZ_KEY in the environment');
const LAYER = 123991;
const Z = Number(process.argv[2] ?? 14);
const OUT = process.argv[3] ?? 'data/base-linz.jpg';
const OUT_PX = Number(process.argv[4] ?? 4096);

const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));
const { west: W, south: S, east: E, north: Nn } = META.bbox;

const R = 6378137;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));   // normalised y
const tileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const tileY = (lat, z) => (1 - merc(lat) / Math.PI) / 2 * 2 ** z;

const x0 = Math.floor(tileX(W, Z)), x1 = Math.ceil(tileX(E, Z));
const y0 = Math.floor(tileY(Nn, Z)), y1 = Math.ceil(tileY(S, Z));
const nx = x1 - x0, ny = y1 - y0, TS = 256;
console.log(`z${Z}: ${nx}x${ny} = ${nx * ny} tiles -> mosaic ${nx * TS}x${ny * TS}`);

const url = (x, y) => `https://data.linz.govt.nz/services;key=${KEY}/tiles/v4/layer=${LAYER}/EPSG:3857/${Z}/${x}/${y}.png`;
const jobs = [];
for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) jobs.push([tx, ty]);

const mosaic = Buffer.alloc(nx * TS * ny * TS * 3);
let done = 0, empty = 0;
async function work(queue) {
  while (queue.length) {
    const [tx, ty] = queue.pop();
    let buf = null;
    for (let a = 0; a < 4 && !buf; a++) {
      try {
        const r = await fetch(url(tx, ty));
        if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 400) buf = b; else empty++; }
      } catch { /* retry */ }
      if (!buf) await new Promise(z => setTimeout(z, 400 * (a + 1)));
    }
    if (buf) {
      const px = await sharp(buf).removeAlpha().resize(TS, TS).raw().toBuffer();
      const ox = (tx - x0) * TS, oy = (ty - y0) * TS, rowW = nx * TS;
      for (let r2 = 0; r2 < TS; r2++) {
        px.copy(mosaic, ((oy + r2) * rowW + ox) * 3, r2 * TS * 3, (r2 + 1) * TS * 3);
      }
    }
    if (++done % 60 === 0) console.log(`  ${done}/${jobs.length}`);
  }
}
const queue = jobs.slice();
await Promise.all(Array.from({ length: 12 }, () => work(queue)));
console.log(`fetched ${done} tiles (${empty} empty)`);

// ---- archive the RAW source mosaic before any reprojection ----
// Reprojection is lossy and opinionated; the untouched mercator mosaic is the thing worth
// keeping. Bytes live on disk (gitignored); provenance is committed.
if (process.env.ARCHIVE) {
  const crypto = await import('crypto');
  fs.mkdirSync('../sources/linz-aerial', { recursive: true });
  const raw = `../sources/linz-aerial/mosaic-z${Z}-mercator.png`;
  await sharp(mosaic, { raw: { width: nx*TS, height: ny*TS, channels: 3 } }).png().toFile(raw);
  const bytes = fs.readFileSync(raw);
  fs.writeFileSync(`../sources/linz-aerial/mosaic-z${Z}.json`, JSON.stringify({
    source: 'LINZ Data Service', layer: LAYER,
    layerName: 'Bay of Plenty 0.1m Urban Aerial Photos (2025)',
    licence: 'CC BY 4.0 — attribution to Toitu Te Whenua LINZ required',
    service: 'https://data.linz.govt.nz/services;key=<KEY>/tiles/v4/layer=123991/EPSG:3857/{z}/{x}/{y}.png',
    crs: 'EPSG:3857', zoom: Z, tileSize: TS,
    tileRange: { x0, x1, y0, y1 }, tiles: (x1-x0)*(y1-y0),
    mosaicPx: [nx*TS, ny*TS],
    groundResolutionM: 156543.03392 * Math.cos(37.6*Math.PI/180) / 2**Z,
    nativeSourceResolutionM: 0.1,
    coversBbox: { west: W, south: S, east: E, north: Nn },
    file: `mosaic-z${Z}-mercator.png`, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    fetched: process.env.FETCH_DATE ?? null,
    note: 'Raw, unreprojected. The renderer consumes a reprojected+composited derivative; regenerate with fetch-linz.mjs + compose-base.mjs.',
  }, null, 2));
  console.log(`archived ${raw} (${(bytes.length/1e6).toFixed(1)} MB)`);
}

// ---- reproject mercator mosaic -> equirectangular over the raster bbox ----
const mW = nx * TS, mH = ny * TS;
const lonOfCol = c => (x0 + c / TS) / 2 ** Z * 360 - 180;
const mercTop = merc(Nn), mercBot = merc(S);
const rowOfLat = lat => (tileY(lat, Z) - y0) * TS;

const out = Buffer.alloc(OUT_PX * OUT_PX * 3);
const lonW = W, lonSpan = E - W, latN = Nn, latSpan = Nn - S;
const colScale = mW / (lonOfCol(mW) - lonOfCol(0));
for (let j = 0; j < OUT_PX; j++) {
  const lat = latN - (j + 0.5) / OUT_PX * latSpan;
  const sy = rowOfLat(lat);
  const y0i = Math.max(0, Math.min(mH - 1, Math.floor(sy))), fy = sy - y0i;
  const y1i = Math.min(mH - 1, y0i + 1);
  for (let i = 0; i < OUT_PX; i++) {
    const lon = lonW + (i + 0.5) / OUT_PX * lonSpan;
    const sx = (lon - lonOfCol(0)) * colScale;
    const x0i = Math.max(0, Math.min(mW - 1, Math.floor(sx))), fx = sx - x0i;
    const x1i = Math.min(mW - 1, x0i + 1);
    const o = (j * OUT_PX + i) * 3;
    for (let k = 0; k < 3; k++) {
      const a = mosaic[(y0i * mW + x0i) * 3 + k], b = mosaic[(y0i * mW + x1i) * 3 + k];
      const c = mosaic[(y1i * mW + x0i) * 3 + k], d = mosaic[(y1i * mW + x1i) * 3 + k];
      out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
}
await sharp(out, { raw: { width: OUT_PX, height: OUT_PX, channels: 3 } })
  .jpeg({ quality: 76, mozjpeg: true }).toFile(OUT);
console.log(`${OUT} ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB  ${OUT_PX}px  ~${(0.44 * 111320 * Math.cos(37.6 * Math.PI / 180) / OUT_PX).toFixed(1)} m/px`);
