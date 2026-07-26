// J2 city-lights rebuild.
//
// The old B channel (prep-field.mjs step 3) picked "bright, near-grey, land pixels of the
// basemap" as a proxy for artificial light. That heuristic answers a different question —
// where is the ground pale and low-saturation — and rural NW paddocks/bare-earth/gravel yards
// answer it more strongly than the CBD's shadowed, tree-lined, saturated-roof streets do. The
// brightest B==255 cluster in the whole 4096 grid sits at ~175.956E 37.505S, open farmland
// north of Omokoroa — nowhere near a settlement — while Tauranga CBD (176.167E 37.686S) and
// Mount Maunganui (176.183E 37.633S) sample under B=32 even at a 60px search radius. Confirmed
// by direct sampling (see README) rather than reading the generator code further: the fix is a
// rebuild from data that actually encodes where light sources are, not a rebuild of the guess.
//
// This script rasterizes real streetlight/building/landuse geometry from OSM instead.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OSM_DIR = path.join(HERE, '../research/overnight-2026-07-27/lights/osm');
const OUT_DIR = path.join(HERE, 'data');

const BBOX = { west: 175.93, south: -37.79, east: 176.37, north: -37.41 };
const P = 4096;

const lonToX = lon => (lon - BBOX.west) / (BBOX.east - BBOX.west) * P;
const latToY = lat => (BBOX.north - lat) / (BBOX.north - BBOX.south) * P;

// ---- 1. load + merge all tiles -----------------------------------------------
const files = fs.readdirSync(OSM_DIR).filter(f => f.endsWith('.json'));
const elements = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(OSM_DIR, f), 'utf8'));
  elements.push(...j.elements);
}
console.log(`loaded ${elements.length} elements from ${files.length} tiles`);

// Duplicates across tile boundaries are expected (a way with any node inside a tile's bbox is
// returned whole). Harmless here: every layer below is composited with max(), so redrawing the
// same geometry twice does not double-brighten it.

const HIGHWAY_WEIGHT = {
  motorway: 1.0, trunk: 1.0, primary: 1.0,
  secondary: 0.8,
  tertiary: 0.65,
  residential: 0.55,
  service: 0.3,
};
const HIGHWAY_HALFWIDTH = { // px at 4096/0.44deg (~9.44 m/px)
  motorway: 1.4, trunk: 1.4, primary: 1.4,
  secondary: 1.0,
  tertiary: 0.85,
  residential: 0.75,
  service: 0.5,
};
const LANDUSE_WEIGHT = {
  commercial: 0.5, retail: 0.5, industrial: 0.5,
  residential: 0.2,
};

// ---- 2. rasterizers -----------------------------------------------------------
const roads = new Float32Array(P * P);
const buildings = new Float32Array(P * P);
const landuse = new Float32Array(P * P);

function setMax(layer, x, y, v) {
  if (x < 0 || y < 0 || x >= P || y >= P) return;
  const i = y * P + x;
  if (v > layer[i]) layer[i] = v;
}

function rasterizeLine(layer, x0, y0, x1, y1, halfWidth, value) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - halfWidth - 1));
  const maxX = Math.min(P - 1, Math.ceil(Math.max(x0, x1) + halfWidth + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - halfWidth - 1));
  const maxY = Math.min(P - 1, Math.ceil(Math.max(y0, y1) + halfWidth + 1));
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = len2 > 1e-9 ? ((x - x0) * dx + (y - y0) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = x0 + t * dx, py = y0 + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d <= halfWidth) setMax(layer, x, y, value);
    }
  }
}

// Even-odd scanline fill for a closed ring given as [[lon,lat],...] (first==last, per OSM).
function rasterizePolygon(layer, ring, value) {
  if (ring.length < 3) return;
  const pts = ring.map(([lon, lat]) => [lonToX(lon), latToY(lat)]);
  let minY = P, maxY = 0;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(P - 1, Math.ceil(maxY));
  if (maxY - minY > 2000) return; // guard against a rogue giant/degenerate ring
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) {
        xs.push(x0 + (yc - y0) / (y1 - y0) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.round(xs[i])), xb = Math.min(P - 1, Math.round(xs[i + 1]));
      for (let x = xa; x <= xb; x++) setMax(layer, x, y, value);
    }
  }
}

let nRoads = 0, nBuildings = 0, nLanduse = 0;
for (const e of elements) {
  if (e.type !== 'way' || !e.geometry || e.geometry.some(g => g == null)) continue;
  const coords = e.geometry.map(g => [g.lon, g.lat]);
  const tags = e.tags || {};
  if (tags.highway && HIGHWAY_WEIGHT[tags.highway] != null) {
    const w = HIGHWAY_WEIGHT[tags.highway], hw = HIGHWAY_HALFWIDTH[tags.highway];
    for (let i = 0; i + 1 < coords.length; i++) {
      const x0 = lonToX(coords[i][0]), y0 = latToY(coords[i][1]);
      const x1 = lonToX(coords[i + 1][0]), y1 = latToY(coords[i + 1][1]);
      rasterizeLine(roads, x0, y0, x1, y1, hw, w);
    }
    nRoads++;
  } else if (tags.building) {
    const closed = coords.length > 2 &&
      Math.abs(coords[0][0] - coords[coords.length - 1][0]) < 1e-9 &&
      Math.abs(coords[0][1] - coords[coords.length - 1][1]) < 1e-9;
    if (closed) { rasterizePolygon(buildings, coords, 1.0); nBuildings++; }
  } else if (tags.landuse && LANDUSE_WEIGHT[tags.landuse] != null) {
    const closed = coords.length > 2 &&
      Math.abs(coords[0][0] - coords[coords.length - 1][0]) < 1e-9 &&
      Math.abs(coords[0][1] - coords[coords.length - 1][1]) < 1e-9;
    if (closed) { rasterizePolygon(landuse, coords, LANDUSE_WEIGHT[tags.landuse]); nLanduse++; }
  }
}
console.log(`rasterized: ${nRoads} highway ways, ${nBuildings} building polygons, ${nLanduse} landuse polygons`);

// ---- 3. composite + two-scale halo --------------------------------------------
const raw = new Float32Array(P * P);
for (let i = 0; i < P * P; i++) {
  raw[i] = roads[i] + buildings[i] * 0.35 + landuse[i];
}

const toBuf = f32 => {
  const b = Buffer.alloc(P * P);
  let max = 0; for (let i = 0; i < P * P; i++) max = Math.max(max, f32[i]);
  const scale = max > 0 ? 255 / max : 1;
  for (let i = 0; i < P * P; i++) b[i] = Math.round(Math.min(255, f32[i] * scale));
  return b;
};
const rawBuf = toBuf(raw);

// Tight core (sodium-lamp point) + wide soft halo (sky-glow bleed), then recombine.
// sharp trap: any processing op (blur, resize...) on a raw single-channel input silently
// promotes the output to 3-channel sRGB unless the colourspace is pinned to 'b-w' first —
// verified by a minimal repro earlier in this job. Assert lengths so a regression here throws
// instead of quietly corrupting every sample downstream (this bit the first run: the whole
// composite came back near-zero at every acceptance point because core/halo were being read
// with single-channel stride against 3-channel buffers).
const core = await sharp(rawBuf, { raw: { width: P, height: P, channels: 1 } })
  .toColourspace('b-w').blur(1.0).raw().toBuffer();
const halo = await sharp(rawBuf, { raw: { width: P, height: P, channels: 1 } })
  .toColourspace('b-w').blur(10).raw().toBuffer();
if (core.length !== P * P) throw new Error(`core buffer is ${core.length}, expected ${P * P}`);
if (halo.length !== P * P) throw new Error(`halo buffer is ${halo.length}, expected ${P * P}`);

const combined = new Float32Array(P * P);
for (let i = 0; i < P * P; i++) {
  combined[i] = core[i] * 0.75 + halo[i] * 0.55;
}

// ---- 4. optional VIIRS multiplier ----------------------------------------------
let viirsUsed = false, viirsNote = 'not attempted';
const viirsPath = path.join(HERE, '../research/overnight-2026-07-27/lights/viirs_resampled.png');
if (fs.existsSync(viirsPath)) {
  try {
    const v = await sharp(viirsPath).resize(P, P).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (v.info.channels >= 1 && v.data.length >= P * P) {
      let vmax = 0;
      const vraw = new Float32Array(P * P);
      for (let i = 0; i < P * P; i++) { const val = v.data[i * v.info.channels]; vraw[i] = val; vmax = Math.max(vmax, val); }
      for (let i = 0; i < P * P; i++) {
        const vnorm = vmax > 0 ? vraw[i] / vmax : 0;
        combined[i] *= 0.35 + 0.65 * vnorm;
      }
      viirsUsed = true;
      viirsNote = 'applied as multiplier 0.35+0.65*viirsNorm';
    }
  } catch (err) {
    viirsNote = `present but failed to apply: ${err.message}`;
  }
} else {
  viirsNote = 'VIIRS/GIBS fetch skipped or failed — see README';
}

// ---- 5. normalize: CBD/Mount peak near 255, isolated rural points <=60 --------
// A flat gain that saturates only the true peak makes the whole CBD-to-Mount corridor clip to
// 255 in a solid slab (that corridor really is ~10% of the grid — see README) with no texture.
// Normalize against a high percentile instead of the raw max, so the very densest blocks clip
// but the corridor still shows internal gradient; GAIN then applies a final trim, tuned against
// the acceptance sample points logged below.
const sorted = Float32Array.from(combined).sort();
const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const P999 = pct(0.999);
const autoScale = P999 > 0 ? 255 / P999 : 1;
const GAIN = Number(process.argv[2] ?? 1.0) * autoScale;
console.log(`normalize: p99.9=${P999.toFixed(4)} autoScale=${autoScale.toFixed(3)} finalGain=${GAIN.toFixed(3)}`);
const out = Buffer.alloc(P * P);
for (let i = 0; i < P * P; i++) {
  out[i] = Math.max(0, Math.min(255, Math.round(combined[i] * GAIN)));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// sharp trap (per the job brief): a bare 1-channel raw input still gets promoted to a 3-channel
// sRGB PNG on write unless the colourspace is pinned to 'b-w' first — verified by a minimal
// repro before trusting any downstream sample. Confirmed 1-channel greyscale after this fix.
await sharp(out, { raw: { width: P, height: P, channels: 1 } })
  .toColourspace('b-w')
  .png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'citylights.png'));

const json = {
  description: 'City lights raster for Tauranga Harbour, rebuilt from OSM road/building/landuse geometry (J2). 8-bit grayscale, 0 = dark.',
  size: { width: P, height: P },
  bbox: { ...BBOX, crs: 'EPSG:4326' },
  projection: 'equirectangular (pixel-linear in lon/lat, matching field-v2.png / drying-height.png)',
  sources: {
    osm: {
      api: 'Overpass API',
      mirrorsUsed: ['https://z.overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter'],
      note: 'overpass-api.de itself returned HTTP 406 on every endpoint tried this session; kumi.systems and private.coffee mirrors timed out. Both working mirrors answered normal Overpass JSON.',
      queried: 'highway in {motorway,trunk,primary,secondary,tertiary,residential,service}; building=*; landuse in {residential,commercial,industrial,retail}',
      tiling: '3x3 sub-bboxes, cached at research/overnight-2026-07-27/lights/osm/tile_{x}_{y}.json',
      elementCounts: { highwayWays: nRoads, buildingPolygons: nBuildings, landuseWays: nLanduse, totalElementsFetched: elements.length },
    },
    viirs: { used: viirsUsed, note: viirsNote },
  },
  weights: {
    highway: HIGHWAY_WEIGHT,
    highwayHalfWidthPx: HIGHWAY_HALFWIDTH,
    buildingFill: 0.35,
    landuse: LANDUSE_WEIGHT,
  },
  blur: { coreSigmaPx: 1.0, haloSigmaPx: 10, coreGain: 0.75, haloGain: 0.55 },
  normalizeGain: GAIN,
};
fs.writeFileSync(path.join(OUT_DIR, 'citylights.json'), JSON.stringify(json, null, 2));

const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`wrote data/citylights.png (${kb(path.join(OUT_DIR, 'citylights.png'))}) and citylights.json`);

// quick self-report on the acceptance sample points
const sampleAt = (lon, lat, rad = 20) => {
  const cx = Math.round(lonToX(lon)), cy = Math.round(latToY(lat));
  let max = 0;
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
    if (x < 0 || y < 0 || x >= P || y >= P) continue;
    max = Math.max(max, out[y * P + x]);
  }
  return max;
};
console.log('sample maxima (radius 20px):');
console.log('  Tauranga CBD        ', sampleAt(176.167, -37.686));
console.log('  Mount Maunganui     ', sampleAt(176.183, -37.633));
console.log('  Papamoa strip       ', sampleAt(176.245, -37.685));  // real Papamoa shops cluster, not the earlier guess
console.log('  Omokoroa            ', sampleAt(176.036, -37.639));  // real Omokoroa township, not the earlier guess
console.log('  Katikati            ', sampleAt(175.935, -37.552));
console.log('  rural SW corner     ', sampleAt(175.97, -37.77));
console.log('  Matakana Island mid ', sampleAt(176.15, -37.55));
