// ARCHIVED z13 path — kept working as a reference/fallback. The active source is now
// fetch-relief.mjs (LINZ Basemaps elevation z15 terrain-rgb, ~3.8 m/px, baked at P=4096).
// This file is otherwise untouched from the z13-source version.
//
// Land relief for the raking dawn/dusk light (queue item 2, bullet 4).
//
// Fetches LINZ Basemaps' combined `elevation` tileset as Terrain-RGB tiles (z13,
// WebMercator; elevation = -10000 + (R*65536 + G*256 + B) * 0.1 metres) with the
// LINZ_BASEMAPS_KEY, stitches the bbox, reprojects to the project's equirectangular
// grid, and bakes a NORMAL-GRADIENT texture: R = dz/dEast, G = dz/dNorth (metres per
// metre, clamped +-GRAD_MAX, byte-encoded), B = 0. Water and nodata are zero vectors.
// The shader turns this into a gentle azimuth-aware hillshade on land at low sun.
//
// z13 is ~15.1 m/px at this latitude — the bake grid is ~19-21 m/px, so this is a
// slight downsample (small pre-smooth, then bilinear; no upsample artifacts possible).
// The tileset merges every LiDAR survey LINZ has (Bay of Plenty 1m 2024 included)
// over the 8m national DEM.
//
// Usage: LINZ_BASEMAPS_KEY=<basemaps key, ULID>  node fetch-relief.mjs [P=2048]
// Writes data/relief.png + data/relief.json. Tiles are cached in data/relief-tiles/.
import fs from 'fs';
import sharp from 'sharp';

const P = Number(process.argv[2] ?? 2048);
const WEST = 175.93, SOUTH = -37.79, EAST = 176.37, NORTH = -37.41;
const Z = 13, TS = 256;
const GRAD_MAX = 1.5;                       // encode range for dz/dx (150% slope)
const KEY = process.env.LINZ_BASEMAPS_KEY;
if (!KEY) throw new Error('LINZ_BASEMAPS_KEY env var required (Basemaps key, ULID format)');

const RAD = Math.PI / 180;
const mercX = lon => (lon + 180) / 360 * (1 << Z);
const mercY = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) / Math.PI) / 2 * (1 << Z);

const x0 = Math.floor(mercX(WEST)), x1 = Math.floor(mercX(EAST));
const y0 = Math.floor(mercY(NORTH)), y1 = Math.floor(mercY(SOUTH));
const NX = x1 - x0 + 1, NY = y1 - y0 + 1;
console.log(`z${Z} tiles x ${x0}..${x1} y ${y0}..${y1} (${NX * NY} tiles)`);

fs.mkdirSync('data/relief-tiles', { recursive: true });
const mosaic = new Float32Array(NX * TS * NY * TS);   // metres; 0 where nodata/ocean
const MW = NX * TS;

async function fetchTile(xt, yt) {
  const cache = `data/relief-tiles/${Z}-${xt}-${yt}.png`;
  let buf;
  if (fs.existsSync(cache)) buf = fs.readFileSync(cache);
  else {
    const url = `https://basemaps.linz.govt.nz/v1/tiles/elevation/WebMercatorQuad/${Z}/${xt}/${yt}.png?api=${KEY}&pipeline=terrain-rgb`;
    const r = await fetch(url);
    if (r.status === 404 || r.status === 204) { fs.writeFileSync(cache, Buffer.alloc(0)); return; }
    if (!r.ok) throw new Error(`tile ${xt}/${yt}: HTTP ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(cache, buf);
  }
  if (buf.length === 0) return;                        // cached miss
  const raw = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  if (info.width !== TS || info.height !== TS) throw new Error(`tile ${xt}/${yt} is ${info.width}px`);
  const ox = (xt - x0) * TS, oy = (yt - y0) * TS;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const i = (y * TS + x) * 4;
    if (data[i + 3] < 128) continue;                   // transparent = nodata
    const e = -10000 + (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) * 0.1;
    if (e > -50 && e < 4000) mosaic[(oy + y) * MW + ox + x] = Math.max(0, e);
  }
}

{
  const jobs = [];
  for (let yt = y0; yt <= y1; yt++) for (let xt = x0; xt <= x1; xt++) jobs.push([xt, yt]);
  const POOL = 8;
  for (let i = 0; i < jobs.length; i += POOL) {
    await Promise.all(jobs.slice(i, i + POOL).map(([a, b]) => fetchTile(a, b)));
    process.stdout.write(`\r${Math.min(i + POOL, jobs.length)}/${jobs.length} tiles`);
  }
  console.log('');
}

// small pre-smooth on the mosaic (sigma ~0.8 px) before the slight downsample
function blurSep(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let t = -r; t <= r; t++) a += src[y * w + Math.min(w - 1, Math.max(0, x + t))] * k[t + r];
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let t = -r; t <= r; t++) a += tmp[Math.min(h - 1, Math.max(0, y + t)) * w + x] * k[t + r];
    out[y * w + x] = a;
  }
  return out;
}
const smooth = blurSep(mosaic, MW, NY * TS, 0.8);

// reproject to equirect P x P (row 0 = north), bilinear
const elev = new Float32Array(P * P);
for (let j = 0; j < P; j++) {
  const lat = NORTH - (j + 0.5) / P * (NORTH - SOUTH);
  const my = (mercY(lat) - y0) * TS - 0.5;
  for (let i = 0; i < P; i++) {
    const lon = WEST + (i + 0.5) / P * (EAST - WEST);
    const mx = (mercX(lon) - x0) * TS - 0.5;
    const xf = Math.max(0, Math.min(MW - 1.001, mx)), yf = Math.max(0, Math.min(NY * TS - 1.001, my));
    const xi = xf | 0, yi = yf | 0, fx = xf - xi, fy = yf - yi;
    elev[j * P + i] =
      (smooth[yi * MW + xi] * (1 - fx) + smooth[yi * MW + xi + 1] * fx) * (1 - fy) +
      (smooth[(yi + 1) * MW + xi] * (1 - fx) + smooth[(yi + 1) * MW + xi + 1] * fx) * fy;
  }
}
let emax = 0; for (let i = 0; i < P * P; i++) if (elev[i] > emax) emax = elev[i];
console.log(`equirect ${P}px elevation baked, max ${emax.toFixed(0)} m`);

// gradients in metres-per-metre (per-axis scales differ on an equirect grid)
const M_PER_PX_E = (EAST - WEST) * 111320 * Math.cos(37.6 * RAD) / P;
const M_PER_PX_N = (NORTH - SOUTH) * 110950 / P;
const png = Buffer.alloc(P * P * 3);
for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
  const iw = i > 0 ? i - 1 : 0, ie = i < P - 1 ? i + 1 : P - 1;
  const jn = j > 0 ? j - 1 : 0, js = j < P - 1 ? j + 1 : P - 1;
  const e0 = elev[j * P + i];
  let gx = 0, gy = 0;
  if (e0 > 0.05) {                                     // land only; water stays a zero vector
    gx = (elev[j * P + ie] - elev[j * P + iw]) / ((ie - iw) * M_PER_PX_E);
    // row index grows SOUTH; dz/dNorth = -(dz/drow)
    gy = -(elev[js * P + i] - elev[jn * P + i]) / ((js - jn) * M_PER_PX_N);
  }
  const o = (j * P + i) * 3;
  png[o]     = Math.round((Math.max(-GRAD_MAX, Math.min(GRAD_MAX, gx)) / GRAD_MAX * 0.5 + 0.5) * 255);
  png[o + 1] = Math.round((Math.max(-GRAD_MAX, Math.min(GRAD_MAX, gy)) / GRAD_MAX * 0.5 + 0.5) * 255);
  png[o + 2] = 0;
}
await sharp(png, { raw: { width: P, height: P, channels: 3 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true }).toFile('data/relief.png');

fs.writeFileSync('data/relief.json', JSON.stringify({
  description: 'Land relief gradients for the raking-light hillshade. R = dz/dEast, G = dz/dNorth (metres per metre, byte = grad/GRAD_MAX*0.5+0.5), B unused. Zero vector on water/nodata.',
  size: P, gradMax: GRAD_MAX,
  source: `LINZ Basemaps combined elevation tileset, Terrain-RGB z${Z} (~15.1 m/px here), which merges the regional LiDAR DEMs (incl. Bay of Plenty 1m 2024) over the national 8m DEM`,
  request: `https://basemaps.linz.govt.nz/v1/tiles/elevation/WebMercatorQuad/${Z}/{x}/{y}.png?api=<LINZ_BASEMAPS_KEY>&pipeline=terrain-rgb`,
  tiles: { z: Z, x: [x0, x1], y: [y0, y1] },
  bbox: [WEST, SOUTH, EAST, NORTH],
  licence: 'CC BY 4.0, attribution Toitu Te Whenua Land Information New Zealand',
  fetched: '2026-07-27',
}, null, 2));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`data/relief.png ${kb('data/relief.png')} at ${P}px`);
