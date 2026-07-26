import fs from 'fs';

// ---- 1. Parse LINZ Tauranga tide tables (local clock time, NZST/NZDT) ----
function nzOffsetHours(y, m, d, hh, mm) {
  // NZDT (UTC+13) from last Sunday in September to first Sunday in April.
  const lastSunSep = (() => { const dt = new Date(Date.UTC(y, 8, 30)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() - 1); return dt.getUTCDate(); })();
  const firstSunApr = (() => { const dt = new Date(Date.UTC(y, 3, 1)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() + 1); return dt.getUTCDate(); })();
  if (m > 4 && m < 9) return 12;            // May-Aug: NZST
  if (m > 9 || m < 4) return 13;            // Oct-Mar: NZDT
  if (m === 4) return d < firstSunApr ? 13 : (d === firstSunApr ? (hh < 3 ? 13 : 12) : 12);
  if (m === 9) return d < lastSunSep ? 12 : (d === lastSunSep ? (hh < 2 ? 12 : 13) : 13);
  return 12;
}

const extrema = [];
for (const y of [2024, 2025, 2026]) {
  const txt = fs.readFileSync(`../sources/tides/tauranga_${y}.csv`, 'utf8');
  for (const line of txt.split(/\r?\n/).slice(3)) {
    const c = line.split(',');
    if (c.length < 6 || !/^\d+$/.test(c[0].trim())) continue;
    const day = +c[0], mon = +c[2], yr = +c[3];
    for (let i = 4; i + 1 < c.length; i += 2) {
      const t = c[i].trim(), h = c[i + 1].trim();
      if (!/^\d{2}:\d{2}$/.test(t) || h === '') continue;
      const [hh, mm] = t.split(':').map(Number);
      const off = nzOffsetHours(yr, mon, day, hh, mm);
      extrema.push({ t: Date.UTC(yr, mon - 1, day, hh - off, mm), h: +h });
    }
  }
}
extrema.sort((a, b) => a.t - b.t);
console.log(`tide extrema parsed: ${extrema.length}  (${new Date(extrema[0].t).toISOString()} .. ${new Date(extrema.at(-1).t).toISOString()})`);

// cosine interpolation between successive high/low
function tideAt(ms) {
  let lo = 0, hi = extrema.length - 1;
  if (ms < extrema[0].t || ms > extrema.at(-1).t) return null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (extrema[mid].t <= ms) lo = mid; else hi = mid; }
  const a = extrema[lo], b = extrema[hi];
  const f = (ms - a.t) / (b.t - a.t);
  return a.h + (b.h - a.h) * (1 - Math.cos(Math.PI * f)) / 2;
}

// ---- 2. Pull the full Sentinel-2 archive over Tauranga Harbour ----
const bbox = [175.95, -37.78, 176.30, -37.40];
async function search(maxCloud) {
  const out = [];
  let body = {
    collections: ['sentinel-2-l2a'], bbox,
    datetime: '2024-01-01T00:00:00Z/2026-07-20T00:00:00Z',
    query: { 'eo:cloud_cover': { lt: maxCloud }, 's2:nodata_pixel_percentage': { lt: 15 } }, limit: 100,
  };
  let url = 'https://earth-search.aws.element84.com/v1/search';
  for (let page = 0; page < 30; page++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    out.push(...j.features.map(f => ({ id: f.id, dt: f.properties.datetime, cc: f.properties['eo:cloud_cover'] })));
    const next = (j.links || []).find(l => l.rel === 'next');
    if (!next) break;
    body = next.body || body;
  }
  return out;
}

for (const maxCloud of [5, 20]) {
  let feats = await search(maxCloud);
  // one entry per acquisition datetime (tiles 60HUD/60HVD duplicate the same pass)
  const byPass = new Map(); feats = feats.filter(f=>f.id.includes('60HVD'));
  for (const f of feats) byPass.set(f.dt.slice(0, 13), f);
  const rows = [...byPass.values()].map(f => ({ ...f, tide: tideAt(Date.parse(f.dt)) })).filter(r => r.tide != null);
  rows.sort((a, b) => a.tide - b.tide);

  const bins = new Array(10).fill(0);
  for (const r of rows) bins[Math.min(9, Math.floor(r.tide / 0.25))]++;
  console.log(`\n===== cloud < ${maxCloud}%  |  ${rows.length} distinct passes (2024-01 .. 2026-07) =====`);
  bins.forEach((n, i) => { if (i * 0.25 <= 2.25) console.log(`  ${(i * 0.25).toFixed(2)}-${(i * 0.25 + 0.25).toFixed(2)} m : ${'#'.repeat(n).padEnd(3)} ${n}`); });
  console.log('  LOWEST 6 :', rows.slice(0, 6).map(r => `${r.dt.slice(0, 10)} ${r.tide.toFixed(2)}m cc${Math.round(r.cc)}%`).join(' | '));
  console.log('  HIGHEST 6:', rows.slice(-6).map(r => `${r.dt.slice(0, 10)} ${r.tide.toFixed(2)}m cc${Math.round(r.cc)}%`).join(' | '));
}
