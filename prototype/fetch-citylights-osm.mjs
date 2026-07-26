// J2 city-lights rebuild: fetch OSM roads/buildings/landuse for the field bbox via Overpass.
// Caches raw JSON per tile so re-runs are free. Not part of the forbidden-file list
// (template-v2.html / look.mjs / prep-field.mjs) — standalone research/build tool.
//
// Uses curl as a subprocess rather than node's fetch: in this sandbox node's own network
// stack cannot reach any external host (ETIMEDOUT even on hosts that answer curl instantly),
// while curl works fine. Diagnosed once by direct comparison; not worth re-probing per run.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BBOX = { west: 175.93, south: -37.79, east: 176.37, north: -37.41 };
const OUT_DIR = path.join(HERE, '../research/overnight-2026-07-27/lights/osm');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Overpass mirrors that answered with real 200s during connectivity probing this session
// (overpass-api.de itself returned 406 Not Acceptable for every path tried — status/root/
// interpreter — with a legitimate-looking Apache banner but always rejected; kumi.systems and
// private.coffee both timed out outright). z.overpass-api.de and the France FR mirror both
// answered normal Overpass JSON immediately.
const MIRRORS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const GRID = 3; // 3x3 sub-bboxes to stay under response-size / timeout limits
const tiles = [];
for (let ty = 0; ty < GRID; ty++) {
  for (let tx = 0; tx < GRID; tx++) {
    const w = BBOX.west + (tx / GRID) * (BBOX.east - BBOX.west);
    const e = BBOX.west + ((tx + 1) / GRID) * (BBOX.east - BBOX.west);
    const n = BBOX.north - (ty / GRID) * (BBOX.north - BBOX.south);
    const s = BBOX.north - ((ty + 1) / GRID) * (BBOX.north - BBOX.south);
    tiles.push({ id: `${tx}_${ty}`, w, s, e, n });
  }
}

const query = ({ s, w, n, e }) => `[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service)$"](${s},${w},${n},${e});
  way["building"](${s},${w},${n},${e});
  way["landuse"~"^(residential|commercial|industrial|retail)$"](${s},${w},${n},${e});
);
out geom;`;

function curlPost(url, data, outFile) {
  execFileSync('curl', [
    '-s', '-m', '150',
    '-X', 'POST',
    '--data-urlencode', `data=${data}`,
    '-o', outFile,
    '-w', '%{http_code}',
    url,
  ], { encoding: 'utf8' });
}

async function fetchTile(tile) {
  const cacheFile = `${OUT_DIR}/tile_${tile.id}.json`;
  if (fs.existsSync(cacheFile)) {
    const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`[cache] tile ${tile.id}: ${j.elements.length} elements`);
    return;
  }
  const tmp = `${cacheFile}.tmp`;
  let lastErr;
  for (const mirror of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`[fetch] tile ${tile.id} via ${mirror} attempt ${attempt + 1}`);
        curlPost(mirror, query(tile), tmp);
        const text = fs.readFileSync(tmp, 'utf8');
        const json = JSON.parse(text); // throws if not JSON (rate-limit / error HTML)
        if (!Array.isArray(json.elements)) throw new Error('no elements array');
        fs.writeFileSync(cacheFile, JSON.stringify(json));
        fs.unlinkSync(tmp);
        console.log(`[ok] tile ${tile.id}: ${json.elements.length} elements`);
        return;
      } catch (err) {
        lastErr = err;
        console.log(`[err] tile ${tile.id}: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  throw new Error(`tile ${tile.id} failed on all mirrors: ${lastErr?.message}`);
}

for (const tile of tiles) {
  await fetchTile(tile);
}
console.log('all tiles fetched');
