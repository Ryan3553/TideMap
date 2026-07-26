// Stage 1d — why is the low-tide end so thin? Is it cloud, or is it the fixed
// overpass time? Queries EVERY 60HVD pass 2015-2026 with no cloud filter and
// compares the tide distribution of all passes against the usable subset.
import fs from 'fs'; import path from 'path';
import { STAC_SEARCH, TILE_ID, DATE_RANGE, BBOX, TIDE_LAG_MIN, dirs } from './lib/config.mjs';
import { predict } from '../tide/tauranga-tide.js';
const H = (ms) => predict(new Date(ms));

const feats = [];
let body = { collections: ['sentinel-2-l2a'], bbox: [BBOX.w, BBOX.s, BBOX.e, BBOX.n], datetime: DATE_RANGE, limit: 100 };
for (let p = 0; p < 60; p++) {
  const r = await fetch(STAC_SEARCH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  feats.push(...j.features.filter(f => f.id.includes(TILE_ID)));
  const nx = (j.links || []).find(l => l.rel === 'next'); if (!nx) break; body = nx.body || body;
}
const byPass = new Map();
for (const f of feats) {
  const k = f.properties.datetime.slice(0, 16);
  const cur = { cloud: f.properties['eo:cloud_cover'] ?? 100, nodata: f.properties['s2:nodata_pixel_percentage'] ?? 100, dt: f.properties.datetime };
  const prev = byPass.get(k);
  if (!prev || cur.cloud < prev.cloud) byPass.set(k, cur);
}
const all = [...byPass.values()].map(x => ({ ...x, tideGauge: H(Date.parse(x.dt)), tide: H(Date.parse(x.dt) - TIDE_LAG_MIN * 60000) }));
console.log(`ALL 60HVD passes 2015-2026 (deduped): ${all.length}`);
const times = [...new Set(all.map(a => a.dt.slice(11, 16)))].sort();
console.log(`acquisition times (UTC): ${times.join(', ')}`);

const bins = (rows, label) => {
  const b = new Array(10).fill(0);
  for (const r of rows) { const i = Math.floor(r.tide / 0.25); if (i >= 0 && i < 10) b[i]++; }
  console.log(`\n${label} (n=${rows.length})`);
  b.forEach((c, i) => console.log(`  ${(i * 0.25).toFixed(2)}-${(i * 0.25 + 0.25).toFixed(2)} m : ${String(c).padStart(3)} ${'#'.repeat(Math.min(60, c))}`));
};
bins(all, 'ALL passes regardless of cloud');
bins(all.filter(r => r.cloud < 5 && r.nodata < 5), 'cloud<5% & nodata<5% (the shipped set)');
bins(all.filter(r => r.cloud < 20 && r.nodata < 5), 'cloud<20% & nodata<5%');
bins(all.filter(r => r.cloud < 40 && r.nodata < 5), 'cloud<40% & nodata<5%');

const low = all.filter(r => r.tide < 0.55).sort((a, b) => a.tide - b.tide);
console.log(`\npasses with effective tide < 0.55 m: ${low.length}`);
for (const r of low.slice(0, 18)) console.log(`  ${r.dt.slice(0, 10)}  eff ${r.tide.toFixed(2)}  gauge ${r.tideGauge.toFixed(2)}  cloud ${r.cloud.toFixed(1)}%  nodata ${r.nodata.toFixed(1)}%`);
const absMin = Math.min(...all.map(r => r.tide));
console.log(`\nlowest effective tide reachable at ANY 60HVD overpass, any cloud: ${absMin.toFixed(2)} m`);
console.log(`lowest with cloud<5%: ${Math.min(...all.filter(r => r.cloud < 5 && r.nodata < 5).map(r => r.tide)).toFixed(2)} m`);
console.log(`lowest with cloud<20%: ${Math.min(...all.filter(r => r.cloud < 20 && r.nodata < 5).map(r => r.tide)).toFixed(2)} m`);
fs.writeFileSync(path.join(dirs.out, 'lowtide-probe.json'), JSON.stringify({
  totalPasses: all.length, acquisitionTimesUtc: times,
  lowestAnyCloud: +absMin.toFixed(3),
  lowestCloud5: +Math.min(...all.filter(r => r.cloud < 5 && r.nodata < 5).map(r => r.tide)).toFixed(3),
  lowestCloud20: +Math.min(...all.filter(r => r.cloud < 20 && r.nodata < 5).map(r => r.tide)).toFixed(3),
  lowPasses: low.map(r => ({ date: r.dt.slice(0, 10), tide: +r.tide.toFixed(3), gauge: +r.tideGauge.toFixed(3), cloud: +r.cloud.toFixed(1), nodata: +r.nodata.toFixed(1) })),
}, null, 2));
