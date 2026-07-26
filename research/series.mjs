import fs from 'fs';
import { execSync } from 'child_process';

// ---- LINZ Tauranga tide tables -> interpolated height at any UTC instant ----
function nzOffsetHours(y, m, d, hh) {
  const lastSunSep = (() => { const dt = new Date(Date.UTC(y, 8, 30)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() - 1); return dt.getUTCDate(); })();
  const firstSunApr = (() => { const dt = new Date(Date.UTC(y, 3, 1)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() + 1); return dt.getUTCDate(); })();
  if (m > 4 && m < 9) return 12;
  if (m > 9 || m < 4) return 13;
  if (m === 4) return d < firstSunApr ? 13 : (d === firstSunApr ? (hh < 3 ? 13 : 12) : 12);
  if (m === 9) return d < lastSunSep ? 12 : (d === lastSunSep ? (hh < 2 ? 12 : 13) : 13);
  return 12;
}
const extrema = [];
for (const y of [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024, 2025, 2026]) {
  const f = `../sources/tides/tauranga_${y}.csv`;
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(3)) {
    const c = line.split(',');
    if (c.length < 6 || !/^\d+$/.test(c[0].trim())) continue;
    const day = +c[0], mon = +c[2], yr = +c[3];
    for (let i = 4; i + 1 < c.length; i += 2) {
      const t = c[i].trim(), h = c[i + 1].trim();
      if (!/^\d{2}:\d{2}$/.test(t) || h === '') continue;
      const [hh, mm] = t.split(':').map(Number);
      extrema.push({ t: Date.UTC(yr, mon - 1, day, hh - nzOffsetHours(yr, mon, day, hh), mm), h: +h });
    }
  }
}
extrema.sort((a, b) => a.t - b.t);
function tideAt(ms) {
  if (ms < extrema[0].t || ms > extrema.at(-1).t) return null;
  let lo = 0, hi = extrema.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (extrema[mid].t <= ms) lo = mid; else hi = mid; }
  const a = extrema[lo], b = extrema[hi], f = (ms - a.t) / (b.t - a.t);
  return a.h + (b.h - a.h) * (1 - Math.cos(Math.PI * f)) / 2;
}

// ---- candidate scenes: tile 60HVD, near-cloud-free, full coverage ----
const out = [];
let body = {
  collections: ['sentinel-2-l2a'], bbox: [176.05, -37.72, 176.25, -37.50],
  datetime: `${extrema[0] ? new Date(extrema[0].t).toISOString() : '2024-01-01T00:00:00Z'}/2026-07-20T00:00:00Z`,
  query: { 'eo:cloud_cover': { lt: 8 }, 's2:nodata_pixel_percentage': { lt: 5 } }, limit: 100,
};
for (let p = 0; p < 25; p++) {
  const r = await fetch('https://earth-search.aws.element84.com/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  out.push(...j.features.filter(f => f.id.includes('60HVD')).map(f => ({ id: f.id, dt: f.properties.datetime, cc: f.properties['eo:cloud_cover'], href: f.assets.visual.href })));
  const n = (j.links || []).find(l => l.rel === 'next'); if (!n) break; body = n.body || body;
}
const rows = out.map(f => ({ ...f, tide: tideAt(Date.parse(f.dt)) })).filter(r => r.tide != null);
console.log(`candidates: ${rows.length}  tide ${Math.min(...rows.map(r=>r.tide)).toFixed(2)}..${Math.max(...rows.map(r=>r.tide)).toFixed(2)} m`);

// ---- one best (lowest-cloud) scene per 0.2 m tide step ----
const picks = new Map();
for (const r of rows) {
  const k = Math.floor(r.tide / 0.2) * 0.2;
  const cur = picks.get(k.toFixed(1));
  if (!cur || r.cc < cur.cc) picks.set(k.toFixed(1), r);
}
const series = [...picks.entries()].sort((a, b) => +a[0] - +b[0]).map(([k, v]) => v);

fs.writeFileSync('picks.json', JSON.stringify(series.map(s=>({tide:+s.tide.toFixed(2),date:s.dt.slice(0,10),cloud:+s.cc.toFixed(1),scene:s.id,href:s.href})),null,2)); console.log('picks written:', series.length); process.exit(0);
const BBOX = '175.93,-37.78,176.36,-37.42';
const W = 2200, H = 2400;
const manifest = [];
for (const s of series) {
  const name = `tide_${s.tide.toFixed(2).replace('.', 'p')}m_${s.dt.slice(0, 10)}.png`;
  const url = `https://titiler.xyz/cog/bbox/${BBOX}/${W}x${H}.png?url=${s.href}`;
  execSync(`curl -s -o "out/${name}" "${url}"`);
  const sz = fs.statSync(`out/${name}`).size;
  console.log(`${s.tide.toFixed(2)} m  ${s.dt.slice(0, 10)}  cloud ${s.cc.toFixed(1)}%  ${(sz / 1e6).toFixed(2)} MB  ${name}`);
  manifest.push({ tide: +s.tide.toFixed(2), date: s.dt.slice(0, 10), cloud: +s.cc.toFixed(1), file: name, bytes: sz, scene: s.id });
}
fs.writeFileSync('out/manifest.json', JSON.stringify({ bbox: BBOX, width: W, height: H, images: manifest }, null, 2));
