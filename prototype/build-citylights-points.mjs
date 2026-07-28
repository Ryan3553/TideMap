// Build the renderer's city-lights texture as a dedicated, point-based sprite field instead of a
// blurred road/building/landuse mask.
//
// Ryan's brief: "golden, brighter, sparklier — small bright pinpricks with a corona", referencing
// dense fields of point lights seen from orbit. The old data/citylights.png (see
// build-citylights.mjs, now retired — see prep-field3.mjs) rasterizes ROADS AS FILLED LINES and
// BUILDINGS AS FILLED POLYGONS, then blurs the whole mask with two Gaussians (sigma 1 and 10).
// That is an area/line raster, not a point field — there is no per-light structure for a shader to
// hang a tight core + corona + twinkle on, which is why the old look reads as soft glowing
// blobs/ribbons rather than individual sparkling points. Fix: synthesize actual point positions
// (streetlights spaced along each road way, one light per building centroid) from the SAME cached
// OSM ways (research/overnight-2026-07-27/lights/osm/*.json — 13,092 highway ways, 55,246 building
// polygons, 2,142 landuse ways; verified via a node/way count pass, no point/street_lamp nodes were
// ever fetched), then splat each point individually into two channels: a tight core and a soft
// corona. No new network fetch needed — offline, matches TideMap's philosophy.
//
// Output: data/citylights-points.png (+ .json sidecar) — R=core, G=corona, B=coolness. Consumed by
// template-v2.html (uLights, texture unit 5) and look.mjs (cityLightsTerm). Promoted from the
// prototype at _bake-lights-try.mjs after verification renders (_after_wide/_cbd/_close.png).
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OSM_DIR = path.join(HERE, '../research/overnight-2026-07-27/lights/osm');
const OUT_PNG = path.join(HERE, 'data/citylights-points.png');
const OUT_JSON = path.join(HERE, 'data/citylights-points.json');

const BBOX = { west: 175.93, south: -37.79, east: 176.37, north: -37.41 };
const P = Number(process.argv[2] ?? 4096);   // matches field-v3/relief's grid
const LAT_MID = (BBOX.north + BBOX.south) / 2;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos(LAT_MID * Math.PI / 180);

const lonToX = lon => (lon - BBOX.west) / (BBOX.east - BBOX.west) * P;
const latToY = lat => (BBOX.north - lat) / (BBOX.north - BBOX.south) * P;

// ---- 1. load + dedupe ways (Overpass returns a way whole from every tile it touches) ----------
const files = fs.readdirSync(OSM_DIR).filter(f => f.endsWith('.json'));
const seen = new Set();
const ways = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(OSM_DIR, f), 'utf8'));
  for (const e of j.elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.some(g => g == null)) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    ways.push(e);
  }
}
console.log(`loaded ${ways.length} unique ways from ${files.length} tiles`);

// ---- deterministic hash, same family as the shader's hash(vec2) / look.mjs's hash(x,y) --------
const frac = x => x - Math.floor(x);
const hash1 = seed => frac(Math.sin(seed * 127.1 + 311.7) * 43758.5453123);

// ---- 2. rasterize a low-res landuse label field, used only to weight building brightness ------
const LU = 1536; // coarse — this is a weighting prior, not geometry
const luLonToX = lon => (lon - BBOX.west) / (BBOX.east - BBOX.west) * LU;
const luLatToY = lat => (BBOX.north - lat) / (BBOX.north - BBOX.south) * LU;
const luCommercial = new Uint8Array(LU * LU); // 1 if commercial/retail/industrial
const luResidential = new Uint8Array(LU * LU);
function rasterizePolyMask(mask, ring) {
  if (ring.length < 3) return;
  const pts = ring.map(([lon, lat]) => [luLonToX(lon), luLatToY(lat)]);
  let minY = LU, maxY = 0;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(LU - 1, Math.ceil(maxY));
  if (maxY - minY > 1200) return;
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5; const xs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) xs.push(x0 + (yc - y0) / (y1 - y0) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.round(xs[i])), xb = Math.min(LU - 1, Math.round(xs[i + 1]));
      for (let x = xa; x <= xb; x++) mask[y * LU + x] = 1;
    }
  }
}
const COMMERCIAL_TAGS = new Set(['commercial', 'retail', 'industrial']);
let nLanduse = 0;
for (const w of ways) {
  const tags = w.tags || {};
  if (!tags.landuse) continue;
  const coords = w.geometry.map(g => [g.lon, g.lat]);
  const closed = coords.length > 2 &&
    Math.abs(coords[0][0] - coords.at(-1)[0]) < 1e-9 && Math.abs(coords[0][1] - coords.at(-1)[1]) < 1e-9;
  if (!closed) continue;
  if (COMMERCIAL_TAGS.has(tags.landuse)) { rasterizePolyMask(luCommercial, coords); nLanduse++; }
  else if (tags.landuse === 'residential') { rasterizePolyMask(luResidential, coords); nLanduse++; }
}
console.log(`landuse prior: ${nLanduse} polygons rasterized at ${LU}px`);
function landuseAt(lon, lat) {
  const x = Math.max(0, Math.min(LU - 1, Math.round(luLonToX(lon))));
  const y = Math.max(0, Math.min(LU - 1, Math.round(luLatToY(lat))));
  const i = y * LU + x;
  if (luCommercial[i]) return 'commercial';
  if (luResidential[i]) return 'residential';
  return 'none';
}

// ---- 3. synthesize point lights -----------------------------------------------------------
// power: relative brightness (~lumen proxy). coolness: 0 = warm sodium/amber, 1 = whiter-gold
// (brighter commercial/security lighting reads less saturated-orange than a residential street
// lamp — matches the subtle hue variation in the reference photo).
const points = []; // {x,y,power,coolness}

const HIGHWAY_SPACING_M = { motorway: 55, trunk: 50, primary: 33, secondary: 35, tertiary: 40, residential: 42, service: 55 };
const HIGHWAY_POWER =     { motorway: 0.55, trunk: 0.60, primary: 0.95, secondary: 0.85, tertiary: 0.68, residential: 0.52, service: 0.30 };
const HIGHWAY_COOL  =     { motorway: 0.55, trunk: 0.55, primary: 0.45, secondary: 0.40, tertiary: 0.25, residential: 0.10, service: 0.10 };

let nRoadPts = 0;
for (const w of ways) {
  const tags = w.tags || {};
  const cls = tags.highway;
  if (!cls || !HIGHWAY_SPACING_M[cls]) continue;
  const spacing = HIGHWAY_SPACING_M[cls], power = HIGHWAY_POWER[cls], cool = HIGHWAY_COOL[cls];
  const coords = w.geometry.map(g => [g.lon, g.lat]);
  let carry = hash1(w.id) * spacing; // phase-offset so adjacent ways don't all start a lamp at node 0
  for (let i = 0; i + 1 < coords.length; i++) {
    const [lon0, lat0] = coords[i], [lon1, lat1] = coords[i + 1];
    const segM = Math.hypot((lon1 - lon0) * M_PER_DEG_LON, (lat1 - lat0) * M_PER_DEG_LAT);
    if (segM < 1e-6) continue;
    let d = spacing - carry;
    while (d < segM) {
      const t = d / segM;
      const lon = lon0 + (lon1 - lon0) * t, lat = lat0 + (lat1 - lat0) * t;
      const seed = w.id * 97.13 + i * 7.77 + d;
      // small jitter (~1-3m in each axis) so the row doesn't look laser-ruled at close zoom
      const jLon = (hash1(seed) - 0.5) * 2.4 / M_PER_DEG_LON;
      const jLat = (hash1(seed + 0.31) - 0.5) * 2.4 / M_PER_DEG_LAT;
      const skip = hash1(seed + 0.62) < 0.06; // ~6% outage — organic, not uniform
      if (!skip) {
        const powJit = power * (0.82 + 0.36 * hash1(seed + 0.44));
        points.push({ lon: lon + jLon, lat: lat + jLat, power: powJit, cool });
        nRoadPts++;
      }
      d += spacing;
    }
    carry = d - segM;
  }
}
console.log(`road lamp points: ${nRoadPts}`);

let nBuildingPts = 0;
for (const w of ways) {
  const tags = w.tags || {};
  if (!tags.building) continue;
  const coords = w.geometry.map(g => [g.lon, g.lat]);
  const closed = coords.length > 2 &&
    Math.abs(coords[0][0] - coords.at(-1)[0]) < 1e-9 && Math.abs(coords[0][1] - coords.at(-1)[1]) < 1e-9;
  if (!closed) continue;
  let clon = 0, clat = 0, n = coords.length - 1;
  if (n < 1) continue;
  for (let i = 0; i < n; i++) { clon += coords[i][0]; clat += coords[i][1]; }
  clon /= n; clat /= n;
  const lu = landuseAt(clon, clat);
  const litProb = lu === 'commercial' ? 0.90 : lu === 'residential' ? 0.55 : 0.42;
  const seed = w.id * 53.7;
  if (hash1(seed) > litProb) continue; // not every building has an exterior/window light lit
  const powBase = lu === 'commercial' ? 0.62 : lu === 'residential' ? 0.30 : 0.34;
  const power = powBase * (0.75 + 0.5 * hash1(seed + 0.19));
  const cool = lu === 'commercial' ? 0.55 + 0.25 * hash1(seed + 0.51) : 0.05 + 0.15 * hash1(seed + 0.51);
  points.push({ lon: clon, lat: clat, power, cool });
  nBuildingPts++;
}
console.log(`building points: ${nBuildingPts} (of ${ways.filter(w => w.tags?.building).length} building ways)`);
console.log(`total point lights: ${points.length}`);

// ---- 4. splat cores + coolness (TIGHT kernel only — see corona note below) -----------------
const core = new Float32Array(P * P);
const coolNum = new Float32Array(P * P);
const coolDen = new Float32Array(P * P);

const CORE_SIGMA = 0.60;      // px — a tight, near-single-texel pinprick
const CORE_GAIN = 1.35;

// CORONA DESIGN NOTE (measured, not guessed): the first version of this bake gave every point its
// own analytic wide-gaussian corona splat (radius growing with brightness). That produced a
// 3.9-10 MB PNG because thousands of overlapping wide splats merge into large nonzero regions whose
// per-pixel VALUE still varies with local point density/power — high-frequency-enough to defeat
// PNG's row filters. A real Gaussian BLUR of the (already tight, already correctly-placed) core
// buffer produces visually the same "soft halo growing from each point" but as a genuinely smooth
// field with tiny row-to-row deltas, which zlib compresses far better: measured at 4096px, sigma=6
// blur of the core channel alone was 710 kB vs ~1.17 MB for the analytic per-point splat covering
// the same visual area — smaller AND simpler code. Two-scale (tight+wide), same composition idea as
// the OLD build-citylights.mjs halo, but now emanating from real point positions instead of a
// road/building footprint mask.
function splat(px0, py0, power, cool) {
  const cix = Math.round(px0), ciy = Math.round(py0);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = cix + dx, py = ciy + dy;
    if (px < 0 || py < 0 || px >= P || py >= P) continue;
    const d2 = (px0 - px) ** 2 + (py0 - py) ** 2;
    const w = Math.exp(-d2 / (2 * CORE_SIGMA * CORE_SIGMA));
    const i = py * P + px;
    const contrib = power * CORE_GAIN * w;
    core[i] += contrib;
    coolNum[i] += cool * contrib;
    coolDen[i] += contrib;
  }
}
for (const p of points) splat(lonToX(p.lon), latToY(p.lat), p.power, p.cool);
console.log('splatted all core points');

function pctScale(arr) {
  const sorted = Float32Array.from(arr).sort();
  const p999 = sorted[Math.min(sorted.length - 1, Math.floor(0.999 * sorted.length))];
  return p999 > 0 ? 255 / p999 : 1;
}
const coreScale = pctScale(core);
const coreBuf = Buffer.alloc(P * P);
for (let i = 0; i < P * P; i++) coreBuf[i] = Math.max(0, Math.min(255, Math.round(core[i] * coreScale)));

// Single-scale corona derived from the normalized core buffer (real Gaussian blur, sharp/libvips).
// A two-scale (tight+wide) sum was tried first and measured LARGER (1.42 MB vs 610 kB for a single
// sigma=8 blur alone at 4096px) — summing two different-smoothness fields reintroduces enough
// per-pixel variation to hurt zlib's row-delta compression, defeating the point of using a blur
// instead of the analytic per-point splat in the first place. One sigma, chosen to read as a
// believable ~75 m (8px * ~9.5 m/px) soft halo, does the job at a fraction of the size.
const CORONA_SIGMA = 8, CORONA_GAIN = 0.9;
const coronaRaw = await sharp(coreBuf, { raw: { width: P, height: P, channels: 1 } })
  .toColourspace('b-w').blur(CORONA_SIGMA).raw().toBuffer();
if (coronaRaw.length !== P * P) throw new Error('corona blur buffer size mismatch');
const coronaFinal = new Float32Array(P * P);
for (let i = 0; i < P * P; i++) coronaFinal[i] = coronaRaw[i] * CORONA_GAIN;

// ---- 5. normalize + pack RGB (percentile-based, same discipline as the old build-citylights.mjs) --
const coronaScale = pctScale(coronaFinal);
const out = Buffer.alloc(P * P * 3);
for (let i = 0; i < P * P; i++) {
  out[i * 3] = coreBuf[i];
  out[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(coronaFinal[i] * coronaScale)));
  out[i * 3 + 2] = coolDen[i] > 1e-6 ? Math.max(0, Math.min(255, Math.round((coolNum[i] / coolDen[i]) * 255))) : 20;
}
await sharp(out, { raw: { width: P, height: P, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile(OUT_PNG);

const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`wrote ${OUT_PNG} (${kb(OUT_PNG)}) at ${P}x${P}`);

fs.writeFileSync(OUT_JSON, JSON.stringify({
  description: 'City-lights texture — point-sprite field (road lamp spacing + building centroids) from cached OSM ways, R=core G=corona B=coolness(0 warm sodium..1 white-gold)',
  size: P, bbox: BBOX,
  points: { total: points.length, roads: nRoadPts, buildings: nBuildingPts },
  params: { HIGHWAY_SPACING_M, HIGHWAY_POWER, HIGHWAY_COOL, CORE_SIGMA, CORE_GAIN, CORONA_SIGMA, CORONA_GAIN },
}, null, 2));
