// J2 city-lights rebuild: NASA GIBS VIIRS reality-check layer.
//
// GIBS keyless WMTS, layer VIIRS_SNPP_DayNightBand_At_Sensor_Radiance, TileMatrixSet "500m".
// The whole field bbox (0.44 x 0.38 deg) fits inside a single level-7 tile (2.25 deg/tile):
// col=158, row=56 — computed from the WMTSCapabilities TopLeftCorner(-180,90) grid, verified
// against the bbox corners.
//
// The "default/default" (latest) time returned an all-zero/transparent placeholder tile for
// this location — GIBS does that when the auto-picked date has no scene. Falls back through a
// short list of explicit dates (see DATES) until one returns real data (checked by non-zero
// pixel count), then crops to the field bbox and resamples+smooths onto the render grid.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BBOX = { west: 175.93, south: -37.79, east: 176.37, north: -37.41 };
const P = 4096;
const OUT_DIR = path.join(HERE, '../research/overnight-2026-07-27/lights');
const RAW_DIR = path.join(OUT_DIR, 'viirs_raw');
fs.mkdirSync(RAW_DIR, { recursive: true });

const LEVEL = 7, TMS = '500m', ROW = 56, COL = 158;
// tile geographic extent at this level (2.25 deg per tile, top-left corner -180,90)
const TILE_DEG = 2.25, TILE_PX = 512;
const tileWest = -180 + COL * TILE_DEG, tileNorth = 90 - ROW * TILE_DEG;

const urlFor = date => `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/${date}/${TMS}/${LEVEL}/${ROW}/${COL}.png`;

const DATES = ['2026-07-20', '2026-06-15', '2025-07-20']; // most-recent-first fallbacks, all confirmed non-empty during probing

async function nonZeroCount(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 10) n++;
  return n;
}

let chosen = null;
for (const date of DATES) {
  const file = path.join(RAW_DIR, `tile_${LEVEL}_${ROW}_${COL}_${date}.png`);
  if (!fs.existsSync(file)) {
    console.log(`[fetch] VIIRS tile for ${date}`);
    execFileSync('curl', ['-s', '-m', '30', '-o', file, urlFor(date)]);
  }
  try {
    const nz = await nonZeroCount(file);
    console.log(`[check] ${date}: ${nz} non-zero px`);
    if (nz > 10000) { chosen = { file, date }; break; }
  } catch (err) {
    console.log(`[err] ${date}: ${err.message}`);
  }
}

if (!chosen) {
  console.log('No usable VIIRS tile found across fallback dates — skipping VIIRS reality check.');
  process.exit(0);
}
console.log(`using VIIRS tile from ${chosen.date}`);

// crop the tile to the field bbox (pixel math against the tile's known geographic extent)
const left = Math.round((BBOX.west - tileWest) / TILE_DEG * TILE_PX);
const top = Math.round((tileNorth - BBOX.north) / TILE_DEG * TILE_PX);
const width = Math.round((BBOX.east - BBOX.west) / TILE_DEG * TILE_PX);
const height = Math.round((BBOX.north - BBOX.south) / TILE_DEG * TILE_PX);
console.log(`crop box: left=${left} top=${top} width=${width} height=${height} (source px, ~500m each)`);

// Extract channel R as the intensity proxy (colour-ramp PNG; the ramp is monotonic dark->bright
// with radiance, so R alone tracks it well enough for a coarse multiplier), crop, upsample with
// cubic, then heavily blur — this is 500 m data stretched ~40x per axis onto a 4096 grid, so
// without the blur it would tile into hard macro-blocks instead of reading as a soft prior.
const grey = await sharp(chosen.file).extractChannel(0).extract({ left, top, width, height }).toBuffer();
await sharp(grey)
  .resize(P, P, { kernel: 'cubic' })
  .blur(48)
  .png()
  .toFile(path.join(OUT_DIR, 'viirs_resampled.png'));

console.log(`wrote ${path.join(OUT_DIR, 'viirs_resampled.png')}`);
