// Stage 1 — build the scene list: Sentinel-2 L2A passes over tile 60HVD,
// near-cloud-free, each labelled with the LINZ-predicted tide height at the
// exact acquisition instant. Writes out/scenes.json.
import fs from 'fs';
import path from 'path';
import { STAC_SEARCH, TILE_ID, DATE_RANGE, MAX_CLOUD, MAX_NODATA, BBOX, TIDE_LAG_MIN, dirs } from './lib/config.mjs';
import { tideAt, tideCoverage, yearsLoaded } from './lib/tide.mjs';
import { predict } from '../tide/tauranga-tide.js';

// Tide labels come from the SHARED module (tide/tauranga-tide.js), not from a
// pipeline-local fit. It ties the local fit on height at the LINZ extrema
// (0.0310 vs 0.0303 m rmse, both at the 0.1 m quantisation floor) but is 31%
// better on turning-point TIMING (9.35 vs 13.46 min mean |error|), which is
// what actually matters when labelling a scene at an arbitrary instant. It
// also carries analytic 18.6-year nodal corrections, so unlike the local fit
// it can legitimately be evaluated back to 2015. See 1c-tide-compare.mjs.
const harmonic = (ms) => predict(new Date(ms));

console.log('LINZ tide tables loaded for years:', yearsLoaded.join(', '));
console.log('tide extrema coverage:', tideCoverage);

const feats = [];
let body = {
  collections: ['sentinel-2-l2a'],
  bbox: [BBOX.w, BBOX.s, BBOX.e, BBOX.n],
  datetime: DATE_RANGE,
  query: { 'eo:cloud_cover': { lt: MAX_CLOUD }, 's2:nodata_pixel_percentage': { lt: MAX_NODATA } },
  limit: 100,
};
for (let page = 0; page < 40; page++) {
  const r = await fetch(STAC_SEARCH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`STAC ${r.status}`);
  const j = await r.json();
  feats.push(...j.features);
  const next = (j.links || []).find(l => l.rel === 'next');
  if (!next) break;
  body = next.body || body;
}
console.log(`STAC returned ${feats.length} features`);

const byId = new Map();
for (const f of feats) {
  if (!f.id.includes(TILE_ID)) continue;
  const ms = Date.parse(f.properties.datetime);
  const cos = tideAt(ms);
  byId.set(f.id, {
    id: f.id,
    datetime: f.properties.datetime,
    cloud: +(f.properties['eo:cloud_cover'] ?? 0).toFixed(2),
    nodata: +(f.properties['s2:nodata_pixel_percentage'] ?? 0).toFixed(2),
    // `tide` is the EFFECTIVE water level over the flats (lagged); `tideGauge`
    // is the instantaneous prediction at the Tauranga entrance.
    tide: +harmonic(ms - TIDE_LAG_MIN * 60000).toFixed(3),
    tideGauge: +harmonic(ms).toFixed(3),
    tideLagMin: TIDE_LAG_MIN,
    tideCosine: cos == null ? null : +cos.toFixed(3),
    tideSource: cos == null ? 'harmonic-extrapolated' : 'harmonic',
  });
}
// DEDUPLICATE by acquisition instant. Earth Search carries reprocessed baseline
// versions of the same pass as separate items (…_0_L2A and …_1_L2A). Keeping
// both would double-weight that observation in the step-fit AND — far worse —
// leak a held-out scene's twin into the training set during leave-one-out
// validation, inflating the score. Prefer the higher processing index (the
// reprocessed product), tie-break on lower cloud.
const byPass = new Map();
for (const r of byId.values()) {
  const key = r.datetime.slice(0, 16);
  const ver = +(r.id.match(/_(\d+)_L2A$/)?.[1] ?? 0);
  const prev = byPass.get(key);
  if (!prev || ver > prev.ver || (ver === prev.ver && r.cloud < prev.r.cloud)) byPass.set(key, { r, ver });
}
const nDup = byId.size - byPass.size;
console.log(`deduplicated ${byId.size} items -> ${byPass.size} distinct acquisitions (${nDup} reprocessed duplicates dropped)`);
const rows = [...byPass.values()].map(v => v.r);
rows.sort((a, b) => a.tide - b.tide);

const extrap = rows.filter(r => r.tideCosine == null);
console.log(`${TILE_ID} scenes: ${rows.length} (all labelled by the harmonic model)`);
console.log(`  ${extrap.length} outside the local tide-table window (2023) -> harmonic extrapolation:`);
for (const e of extrap) console.log(`    ${e.datetime.slice(0, 10)}  ${e.tide.toFixed(2)} m`);
console.log(`  effective-tide lag applied: ${TIDE_LAG_MIN} min`);
const dis = rows.filter(r => r.tideCosine != null).map(r => Math.abs(r.tideGauge - r.tideCosine));
console.log(`  harmonic vs cosine-interp on the other ${dis.length}: mean |diff| ${(dis.reduce((a, b) => a + b, 0) / dis.length).toFixed(3)} m, max ${Math.max(...dis).toFixed(3)} m`);
console.log(`tide range: ${rows[0].tide.toFixed(2)} .. ${rows.at(-1).tide.toFixed(2)} m`);

const bins = new Array(10).fill(0);
for (const r of rows) bins[Math.min(9, Math.floor(r.tide / 0.25))]++;
bins.forEach((n, i) => console.log(`  ${(i * 0.25).toFixed(2)}-${(i * 0.25 + 0.25).toFixed(2)} m : ${'#'.repeat(n)} ${n}`));

fs.mkdirSync(dirs.out, { recursive: true });
fs.writeFileSync(path.join(dirs.out, 'scenes.json'), JSON.stringify(rows, null, 2));
console.log(`\nwrote out/scenes.json (${rows.length} scenes)`);
