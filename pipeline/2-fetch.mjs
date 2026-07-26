// Stage 2 — fetch the NDWI render of every scene on the master grid.
// titiler.xyz rejects single requests > ~1400 px/side, so the 2600x2600 grid is
// fetched as 2x2 tiles of 1300 and cached on disk. Re-runs are free: a cached
// tile that is a valid PNG of the right size is never re-fetched.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { BBOX, TILE, GRID, STAC_ITEM, dirs } from './lib/config.mjs';

const CONCURRENCY = +(process.env.CONCURRENCY || 4);
const MAX_ATTEMPTS = 5;

const dLon = (BBOX.e - BBOX.w) / GRID;
const dLat = (BBOX.n - BBOX.s) / GRID;

export function tileBbox(gx, gy) {
  const w = BBOX.w + gx * dLon, e = w + dLon;
  const n = BBOX.n - gy * dLat, s = n - dLat;
  return { w, s, e, n };
}

export function tileUrl(sceneId, gx, gy) {
  const { w, s, e, n } = tileBbox(gx, gy);
  const item = encodeURIComponent(STAC_ITEM(sceneId));
  const expr = encodeURIComponent('(b1-b2)/(b1+b2)');
  return `https://titiler.xyz/stac/bbox/${w},${s},${e},${n}/${TILE}x${TILE}.png`
    + `?url=${item}&assets=green&assets=nir&expression=${expr}&rescale=-1,1`;
}

export const tilePath = (sceneId, gx, gy) => path.join(dirs.cache, `${sceneId}_${gx}${gy}.png`);

async function validPng(file) {
  try {
    if (!fs.existsSync(file)) return false;
    if (fs.statSync(file).size < 5000) return false;
    const m = await sharp(file).metadata();
    return m.width === TILE && m.height === TILE;
  } catch { return false; }
}

async function fetchTile(sceneId, gx, gy) {
  const file = tilePath(sceneId, gx, gy);
  if (await validPng(file)) return 'cached';
  const url = tileUrl(sceneId, gx, gy);
  let lastErr = 'unknown';
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) { lastErr = `HTTP ${r.status}`; }
      else {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 5000) lastErr = `short body ${buf.length}B`;
        else {
          fs.writeFileSync(file, buf);
          if (await validPng(file)) return 'fetched';
          fs.rmSync(file, { force: true });
          lastErr = 'invalid png';
        }
      }
    } catch (e) { lastErr = e.name === 'TimeoutError' ? 'timeout' : String(e.message || e); }
    if (a < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 2000 * a * a));
  }
  throw new Error(`${sceneId} tile ${gx}${gy}: ${lastErr}`);
}

const { pathToFileURL } = await import('url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync(dirs.cache, { recursive: true });
  const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
  const jobs = [];
  for (const s of scenes) for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) jobs.push({ s, gx, gy });
  console.log(`${scenes.length} scenes x ${GRID * GRID} tiles = ${jobs.length} tiles, concurrency ${CONCURRENCY}`);

  let done = 0, fetched = 0, cached = 0;
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const j = jobs[cursor++];
      try {
        const how = await fetchTile(j.s.id, j.gx, j.gy);
        how === 'cached' ? cached++ : fetched++;
      } catch (e) { failures.push(String(e.message)); }
      if (++done % 10 === 0 || done === jobs.length) {
        process.stdout.write(`\r  ${done}/${jobs.length}  fetched ${fetched}  cached ${cached}  failed ${failures.length}   `);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('');
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  ' + f)); }
  const bytes = fs.readdirSync(dirs.cache).filter(f => f.endsWith('.png'))
    .reduce((a, f) => a + fs.statSync(path.join(dirs.cache, f)).size, 0);
  console.log(`cache: ${fs.readdirSync(dirs.cache).filter(f => f.endsWith('.png')).length} tiles, ${(bytes / 1e6).toFixed(0)} MB`);
  if (failures.length) process.exit(1);
}
