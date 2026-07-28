// Fetch high-resolution LINZ aerial tiles (LDS layer 123991, BoP 0.1 m 2025) beyond the
// z14 already used for data/base-linz.jpg, to power a zoomable detail layer:
//   - z15, z16 fetched FULLY over the project bbox into data/hires-tiles/{z}/{x}-{y}.png
//   - z17 fetched ONLY for a coastal band (harbour shoreline +- ~1.5 km)
//   - a doubled-resolution basemap (data/base-8k.jpg, 8192px) stitched from the z15 set
//
// Same URL recipe, tile maths and bilinear reprojection as fetch-linz.mjs / reproject-linz.mjs;
// same resumable per-tile disk cache + empty-file-for-404/204 pattern as fetch-relief.mjs.
//
// Usage:
//   LINZ_KEY=<key> node fetch-hires-tiles.mjs estimate
//   LINZ_KEY=<key> node fetch-hires-tiles.mjs fetch 15 [concurrency]
//   LINZ_KEY=<key> node fetch-hires-tiles.mjs fetch 16 [concurrency]
//   LINZ_KEY=<key> node fetch-hires-tiles.mjs band17 [concurrency]
//   node fetch-hires-tiles.mjs base8k         (no key needed; reads cached z15 tiles)
//   LINZ_KEY=<key> node fetch-hires-tiles.mjs verify
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const LAYER = 123991;
const TS = 256;
const WEST = 175.93, SOUTH = -37.79, EAST = 176.37, NORTH = -37.41;
const LAT_MID = 37.6; // convention used throughout this repo for ground-resolution maths
const TILE_DIR = 'data/hires-tiles';

const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const tileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const tileY = (lat, z) => (1 - merc(lat) / Math.PI) / 2 * 2 ** z;
const lonOfTileX = (tx, z) => tx / 2 ** z * 360 - 180;
const latOfTileY = (ty, z) => {
  const n = Math.PI - 2 * Math.PI * ty / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const groundResM = z => 156543.03392 * Math.cos(LAT_MID * Math.PI / 180) / 2 ** z;

function tileRange(Z) {
  const x0 = Math.floor(tileX(WEST, Z)), x1 = Math.ceil(tileX(EAST, Z));
  const y0 = Math.floor(tileY(NORTH, Z)), y1 = Math.ceil(tileY(SOUTH, Z));
  return { x0, x1, y0, y1, nx: x1 - x0, ny: y1 - y0 };
}

function url(KEY, Z, x, y) {
  return `https://data.linz.govt.nz/services;key=${KEY}/tiles/v4/layer=${LAYER}/EPSG:3857/${Z}/${x}/${y}.png`;
}

function cachePath(Z, x, y) {
  return path.join(TILE_DIR, String(Z), `${x}-${y}.png`);
}

// Resumable fetch of a single tile. Mirrors fetch-relief.mjs: an existing cache file
// (even 0 bytes) means "already resolved" and is never re-requested. 0 bytes = confirmed
// 404/204 (no imagery there, e.g. open sea outside the aerial survey extent or bbox edge).
async function fetchTileCached(KEY, Z, x, y, stats) {
  const file = cachePath(Z, x, y);
  if (fs.existsSync(file)) { stats.cached++; return; }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url(KEY, Z, x, y));
      if (r.status === 404 || r.status === 204) {
        fs.writeFileSync(file, Buffer.alloc(0));
        stats.empty++;
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 50) { // suspiciously small - treat as a soft miss, don't cache, retry
        throw new Error(`tiny response ${buf.length}B`);
      }
      fs.writeFileSync(file, buf);
      stats.fetched++;
      stats.bytes += buf.length;
      return;
    } catch (e) {
      stats.retries++;
      if (attempt === 4) {
        stats.failed++;
        stats.failedList.push(`${Z}/${x}-${y}: ${e.message}`);
        return;
      }
      await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
    }
  }
}

function newStats() {
  return { fetched: 0, cached: 0, empty: 0, failed: 0, retries: 0, bytes: 0, failedList: [] };
}

async function runPool(jobs, worker, concurrency) {
  const queue = jobs.slice();
  let done = 0;
  const total = jobs.length;
  async function work() {
    while (queue.length) {
      const job = queue.pop();
      await worker(job);
      done++;
      if (done % 200 === 0 || done === total) {
        process.stdout.write(`\r  ${done}/${total}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, work));
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
async function cmdEstimate() {
  const KEY = process.env.LINZ_KEY;
  if (!KEY) throw new Error('set LINZ_KEY in the environment');
  fs.mkdirSync(TILE_DIR, { recursive: true });
  console.log('Tile-count estimate over bbox', { WEST, SOUTH, EAST, NORTH });
  const report = [];
  for (const Z of [15, 16, 17]) {
    const { nx, ny, x0, y0 } = tileRange(Z);
    const total = nx * ny;
    fs.mkdirSync(path.join(TILE_DIR, String(Z)), { recursive: true });
    // 20 evenly-strided samples across the tile grid (deterministic, spatially spread)
    const N_SAMPLE = 20;
    const stride = Math.max(1, Math.floor(total / N_SAMPLE));
    const samples = [];
    for (let i = 0; i < total && samples.length < N_SAMPLE; i += stride) {
      const tx = x0 + (i % nx), ty = y0 + Math.floor(i / nx);
      samples.push([tx, ty]);
    }
    const stats = newStats();
    await runPool(samples, ([tx, ty]) => fetchTileCached(KEY, Z, tx, ty, stats), 6);
    const nonEmptyN = stats.fetched + stats.cached; // cached here only if a prior run touched them
    const avgBytes = stats.fetched > 0 ? stats.bytes / stats.fetched : 0;
    const emptyFrac = stats.empty / samples.length;
    const estTotalBytes = avgBytes * total * (1 - emptyFrac);
    report.push({ z: Z, nx, ny, total, sampled: samples.length, sampleFetched: stats.fetched,
      sampleEmpty: stats.empty, avgBytesPerTile: Math.round(avgBytes), emptyFrac: +emptyFrac.toFixed(2),
      estTotalMB: +(estTotalBytes / 1e6).toFixed(1), groundResM: +groundResM(Z).toFixed(3) });
  }
  console.log('\nz  | tiles(nx x ny)      | sample avg KB | empty frac | est total MB | ground res m/px');
  for (const r of report) {
    console.log(`${r.z} | ${r.total} (${r.nx}x${r.ny}) | ${(r.avgBytesPerTile/1024).toFixed(1)} KB | ${r.emptyFrac} | ${r.estTotalMB} MB | ${r.groundResM}`);
  }
  return report;
}

// ---------------------------------------------------------------------------
async function cmdFetch(Z, concurrency) {
  const KEY = process.env.LINZ_KEY;
  if (!KEY) throw new Error('set LINZ_KEY in the environment');
  const { x0, x1, y0, y1, nx, ny } = tileRange(Z);
  fs.mkdirSync(path.join(TILE_DIR, String(Z)), { recursive: true });
  const jobs = [];
  for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) jobs.push([tx, ty]);
  console.log(`z${Z}: ${nx}x${ny} = ${jobs.length} tiles, concurrency ${concurrency}`);
  const stats = newStats();
  const t0 = Date.now();
  await runPool(jobs, ([tx, ty]) => fetchTileCached(KEY, Z, tx, ty, stats), concurrency);
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`z${Z} done in ${dt}s: fetched ${stats.fetched}, cached(skip) ${stats.cached}, empty(water/404) ${stats.empty}, failed ${stats.failed}, retries ${stats.retries}, bytes ${(stats.bytes/1e6).toFixed(1)} MB`);
  if (stats.failed) console.log('  failures:', stats.failedList.slice(0, 20));
  return stats;
}

// ---------------------------------------------------------------------------
// Coastal band for z17: pixels within ~1.5 km of the harbour-mask shoreline (the boundary
// between 255-inside/0-outside), on EITHER side - so the strip covers both the near-shore
// water and the adjoining land, which is what a "zoomable detail layer" near the coast wants.
// Falls back to classes.png>=64 (everything except pure open subtidal water) if the mask
// file is missing or degenerate (all-0 or all-255).
function loadMaskGrid(file) {
  if (!fs.existsSync(file)) return null;
  return file; // existence check only here; actual decode happens in caller (async)
}

async function buildCoastalBandMask(bufferKm) {
  const P = 2600; // harbour-mask.png / classes.png / drying-height.png grid size
  let raw, source;
  const maskFile = 'data/harbour-mask.png';
  const classesFile = 'data/classes.png';
  // sharp's raw() decode promotes these single-channel PNGs to N (often 3) identical
  // channels rather than the 1 that metadata() reports - read the first channel with the
  // actual stride rather than assuming channels===1.
  let usable = false;
  if (fs.existsSync(maskFile)) {
    const { data, info } = await sharp(maskFile).raw().toBuffer({ resolveWithObject: true });
    if (info.width === P && info.height === P) {
      const ch = info.channels;
      const px = new Uint8Array(P * P);
      for (let i = 0; i < P * P; i++) px[i] = data[i * ch];
      let zeros = 0, ones = 0;
      for (let i = 0; i < px.length; i++) { if (px[i] === 0) zeros++; else if (px[i] === 255) ones++; }
      // usable if it's actually a binary-ish mask with a meaningful interior (not degenerate)
      if (zeros + ones > px.length * 0.9 && ones > px.length * 0.02 && ones < px.length * 0.98) {
        raw = px; usable = true; source = 'data/harbour-mask.png (255=inside harbour)';
      }
    }
  }
  if (!usable) {
    const { data, info } = await sharp(classesFile).raw().toBuffer({ resolveWithObject: true });
    if (info.width !== P || info.height !== P) throw new Error('classes.png unexpected shape');
    const ch = info.channels;
    raw = Buffer.alloc(P * P);
    for (let i = 0; i < P * P; i++) raw[i] = data[i * ch] >= 64 ? 255 : 0;
    source = 'data/classes.png >=64 fallback (nodata|intertidal|supratidal, i.e. not pure open subtidal water)';
  }

  // boundary = pixels adjacent (4-connected) to a pixel of the opposite class
  const boundary = new Uint8Array(P * P);
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < P; i++) {
      const v = raw[j * P + i];
      const l = i > 0 ? raw[j * P + i - 1] : v;
      const r = i < P - 1 ? raw[j * P + i + 1] : v;
      const u = j > 0 ? raw[(j - 1) * P + i] : v;
      const d = j < P - 1 ? raw[(j + 1) * P + i] : v;
      if (v !== l || v !== r || v !== u || v !== d) boundary[j * P + i] = 1;
    }
  }

  // pixel size (m) - same convention as fetch-relief.mjs
  const mPerPxE = (EAST - WEST) * 111320 * Math.cos(LAT_MID * Math.PI / 180) / P;
  const mPerPxN = (NORTH - SOUTH) * 110950 / P;
  const mPerPx = (mPerPxE + mPerPxN) / 2;
  const rPx = Math.max(1, Math.round(bufferKm * 1000 / mPerPx));

  // separable grayscale dilation (monotonic-deque sliding max) -> "within rPx of a boundary pixel"
  function maxFilterRows(src, w, h, r) {
    const out = new Uint8Array(w * h);
    const deque = new Int32Array(w); // indices
    for (let y = 0; y < h; y++) {
      let head = 0, tail = 0; // deque[head..tail)
      const base = y * w;
      for (let x = 0; x < w + r; x++) {
        if (x < w) {
          while (tail > head && src[base + deque[tail - 1]] <= src[base + x]) tail--;
          deque[tail++] = x;
        }
        const outX = x - r;
        while (head < tail && deque[head] < outX - r) head++;
        if (outX >= 0 && outX < w) out[base + outX] = src[base + deque[head]];
      }
    }
    return out;
  }
  function maxFilterCols(src, w, h, r) {
    const out = new Uint8Array(w * h);
    const deque = new Int32Array(h);
    for (let x = 0; x < w; x++) {
      let head = 0, tail = 0;
      for (let y = 0; y < h + r; y++) {
        if (y < h) {
          const v = src[y * w + x];
          while (tail > head && src[deque[tail - 1] * w + x] <= v) tail--;
          deque[tail++] = y;
        }
        const outY = y - r;
        while (head < tail && deque[head] < outY - r) head++;
        if (outY >= 0 && outY < h) out[outY * w + x] = src[deque[head] * w + x];
      }
    }
    return out;
  }
  const dilated = maxFilterCols(maxFilterRows(boundary, P, P, rPx), P, P, rPx);

  return { band: dilated, P, source, rPx, mPerPx };
}

function z17TileIntersectsBand(band, P, tx, ty, Z) {
  const lonA = lonOfTileX(tx, Z), lonB = lonOfTileX(tx + 1, Z);
  const latA = latOfTileY(ty, Z), latB = latOfTileY(ty + 1, Z); // latA > latB (north to south)
  let colA = Math.floor((lonA - WEST) / (EAST - WEST) * P);
  let colB = Math.ceil((lonB - WEST) / (EAST - WEST) * P);
  let rowA = Math.floor((NORTH - latA) / (NORTH - SOUTH) * P);
  let rowB = Math.ceil((NORTH - latB) / (NORTH - SOUTH) * P);
  colA = Math.max(0, Math.min(P - 1, colA)); colB = Math.max(0, Math.min(P - 1, colB));
  rowA = Math.max(0, Math.min(P - 1, rowA)); rowB = Math.max(0, Math.min(P - 1, rowB));
  for (let j = rowA; j <= rowB; j++) for (let i = colA; i <= colB; i++) {
    if (band[j * P + i]) return true;
  }
  return false;
}

async function computeBand17Tiles(bufferKm) {
  const { band, P, source, rPx, mPerPx } = await buildCoastalBandMask(bufferKm);
  const Z = 17;
  const { x0, x1, y0, y1 } = tileRange(Z);
  const tiles = [];
  for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) {
    if (z17TileIntersectsBand(band, P, tx, ty, Z)) tiles.push([tx, ty]);
  }
  return { tiles, source, rPx, mPerPx, bufferKm };
}

async function cmdBand17(concurrency) {
  const KEY = process.env.LINZ_KEY;
  if (!KEY) throw new Error('set LINZ_KEY in the environment');
  let bufferKm = 1.5;
  let result = await computeBand17Tiles(bufferKm);
  console.log(`coastal band source: ${result.source}`);
  console.log(`buffer ${bufferKm} km -> ${result.rPx}px radius (~${result.mPerPx.toFixed(1)} m/px grid) -> z17 tiles needed: ${result.tiles.length}`);
  if (result.tiles.length > 9000) {
    const halvedKm = bufferKm / 2;
    console.log(`  exceeds 9000-tile cap; falling back to half-width buffer (${halvedKm} km, "nearest the shoreline")`);
    result = await computeBand17Tiles(halvedKm);
    console.log(`  buffer ${halvedKm} km -> ${result.rPx}px radius -> z17 tiles needed: ${result.tiles.length}`);
    if (result.tiles.length > 9000) {
      console.log(`  STILL exceeds 9000 after halving (${result.tiles.length}); proceeding anyway per spec (halve once, then fetch)`);
    }
  }
  fs.mkdirSync(path.join(TILE_DIR, '17'), { recursive: true });
  const stats = newStats();
  const t0 = Date.now();
  await runPool(result.tiles, ([tx, ty]) => fetchTileCached(KEY, 17, tx, ty, stats), concurrency);
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`z17 band done in ${dt}s: fetched ${stats.fetched}, cached(skip) ${stats.cached}, empty(water/404) ${stats.empty}, failed ${stats.failed}, retries ${stats.retries}, bytes ${(stats.bytes/1e6).toFixed(1)} MB`);
  if (stats.failed) console.log('  failures:', stats.failedList.slice(0, 20));
  return { result, stats };
}

// ---------------------------------------------------------------------------
async function cmdBase8k(OUT_PX = 8192) {
  const Z = 15;
  const { x0, x1, y0, y1, nx, ny } = tileRange(Z);
  const mW = nx * TS, mH = ny * TS;
  console.log(`stitching z${Z} mosaic ${mW}x${mH} from data/hires-tiles/${Z}/ ...`);
  const mosaic = Buffer.alloc(mW * mH * 3); // black where a tile is missing/empty
  let used = 0, missing = 0;
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      const file = cachePath(Z, tx, ty);
      if (!fs.existsSync(file)) { missing++; continue; }
      const buf = fs.readFileSync(file);
      if (buf.length === 0) { missing++; continue; }
      const px = await sharp(buf).removeAlpha().resize(TS, TS).raw().toBuffer();
      const ox = (tx - x0) * TS, oy = (ty - y0) * TS;
      for (let r2 = 0; r2 < TS; r2++) {
        px.copy(mosaic, ((oy + r2) * mW + ox) * 3, r2 * TS * 3, (r2 + 1) * TS * 3);
      }
      used++;
    }
  }
  console.log(`  mosaic filled from ${used} tiles, ${missing} missing/empty (left black)`);
  if (missing > nx * ny * 0.05) console.log(`  WARNING: ${missing} missing tiles (>5%) - run "fetch 15" fully first`);

  // reproject mercator mosaic -> equirectangular OUT_PX x OUT_PX, same maths as fetch-linz.mjs
  const lonOfCol = c => (x0 + c / TS) / 2 ** Z * 360 - 180;
  const rowOfLat = lat => (tileY(lat, Z) - y0) * TS;
  const colScale = mW / (lonOfCol(mW) - lonOfCol(0));
  const lon0 = lonOfCol(0), lonSpan = EAST - WEST, latSpan = NORTH - SOUTH;

  const out = Buffer.alloc(OUT_PX * OUT_PX * 3);
  for (let j = 0; j < OUT_PX; j++) {
    const lat = NORTH - (j + 0.5) / OUT_PX * latSpan;
    const sy = rowOfLat(lat);
    const y0i = Math.max(0, Math.min(mH - 1, Math.floor(sy))), fy = sy - y0i;
    const y1i = Math.min(mH - 1, y0i + 1);
    for (let i = 0; i < OUT_PX; i++) {
      const lon = WEST + (i + 0.5) / OUT_PX * lonSpan;
      const sx = (lon - lon0) * colScale;
      const x0i = Math.max(0, Math.min(mW - 1, Math.floor(sx))), fx = sx - x0i;
      const x1i = Math.min(mW - 1, x0i + 1);
      const o = (j * OUT_PX + i) * 3;
      for (let k = 0; k < 3; k++) {
        const a = mosaic[(y0i * mW + x0i) * 3 + k], b = mosaic[(y0i * mW + x1i) * 3 + k];
        const c = mosaic[(y1i * mW + x0i) * 3 + k], d = mosaic[(y1i * mW + x1i) * 3 + k];
        out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    }
    if ((j + 1) % 1024 === 0) process.stdout.write(`\r  ${j + 1}/${OUT_PX}`);
  }
  process.stdout.write('\n');

  const OUT = 'data/base-8k.jpg';
  await sharp(out, { raw: { width: OUT_PX, height: OUT_PX, channels: 3 } })
    .jpeg({ quality: 82, mozjpeg: true }).toFile(OUT);
  const bytes = fs.statSync(OUT).size;
  const outResM = (EAST - WEST) * 111320 * Math.cos(LAT_MID * Math.PI / 180) / OUT_PX;
  console.log(`${OUT} ${(bytes / 1024).toFixed(0)} kB  ${OUT_PX}px  ~${outResM.toFixed(2)} m/px`);

  fs.writeFileSync('data/base-8k.json', JSON.stringify({
    description: 'Doubled-resolution embedded basemap: LINZ z15 aerial (BoP 0.1m Urban Aerial Photos 2025, layer 123991), stitched and reprojected to the project equirectangular grid.',
    source: 'LINZ Data Service', layer: LAYER,
    layerName: 'Bay of Plenty 0.1m Urban Aerial Photos (2025)',
    licence: 'CC BY 4.0 - attribution to Toitu Te Whenua LINZ required',
    service: `https://data.linz.govt.nz/services;key=<KEY>/tiles/v4/layer=${LAYER}/EPSG:3857/{z}/{x}/{y}.png`,
    crs: 'EPSG:3857 source, reprojected to EPSG:4326 equirectangular',
    zoom: Z, tileSize: TS,
    tileRange: { x0, x1, y0, y1 }, tilesTotal: nx * ny, tilesUsed: used, tilesMissing: missing,
    mosaicPx: [mW, mH],
    sourceGroundResolutionM: +groundResM(Z).toFixed(3),
    nativeSourceResolutionM: 0.1,
    outputPx: OUT_PX,
    outputResolutionM: +outResM.toFixed(3),
    bbox: { west: WEST, south: SOUTH, east: EAST, north: NORTH, crs: 'EPSG:4326' },
    file: 'base-8k.jpg', bytes, quality: 82, encoder: 'mozjpeg',
    comparedTo: 'data/base-linz.jpg (z14, ~7.57 m/px source, 5120px reproject) - this is the z15 double-zoom successor',
    fetched: '2026-07-28',
  }, null, 2));
  console.log('data/base-8k.json written');
}

// ---------------------------------------------------------------------------
const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'estimate': await cmdEstimate(); break;
  case 'fetch': {
    const Z = Number(rest[0]);
    const conc = Number(rest[1] ?? 8);
    if (![15, 16, 17].includes(Z)) throw new Error('fetch <15|16|17> [concurrency]');
    await cmdFetch(Z, conc);
    break;
  }
  case 'band17': await cmdBand17(Number(rest[0] ?? 8)); break;
  case 'bandcount': {
    for (const km of [1.5, 0.75]) {
      const r = await computeBand17Tiles(km);
      console.log(`buffer ${km} km -> ${r.rPx}px radius (~${r.mPerPx.toFixed(1)} m/px grid), source: ${r.source}`);
      console.log(`  z17 tiles needed: ${r.tiles.length}`);
    }
    break;
  }
  case 'base8k': await cmdBase8k(Number(rest[0] ?? 8192)); break;
  default:
    console.log('usage: node fetch-hires-tiles.mjs <estimate|fetch Z [conc]|band17 [conc]|base8k [px]>');
    process.exit(1);
}
