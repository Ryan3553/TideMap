// LINZ Tauranga tide tables -> interpolated height at any UTC instant.
// Lifted verbatim in behaviour from research/tide-coverage-probe.mjs (working code).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RESEARCH = fileURLToPath(new URL('../../research/', import.meta.url));

function nzOffsetHours(y, m, d, hh) {
  // NZDT (UTC+13) from last Sunday in September to first Sunday in April.
  const lastSunSep = (() => { const dt = new Date(Date.UTC(y, 8, 30)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() - 1); return dt.getUTCDate(); })();
  const firstSunApr = (() => { const dt = new Date(Date.UTC(y, 3, 1)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() + 1); return dt.getUTCDate(); })();
  if (m > 4 && m < 9) return 12;
  if (m > 9 || m < 4) return 13;
  if (m === 4) return d < firstSunApr ? 13 : (d === firstSunApr ? (hh < 3 ? 13 : 12) : 12);
  if (m === 9) return d < lastSunSep ? 12 : (d === lastSunSep ? (hh < 2 ? 12 : 13) : 13);
  return 12;
}

export const extrema = [];
export const yearsLoaded = [];
for (const y of [2023, 2024, 2025, 2026, 2027]) {
  const f = path.join(RESEARCH, `tauranga_${y}.csv`);
  if (!fs.existsSync(f)) continue;
  yearsLoaded.push(y);
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

export function tideAt(ms) {
  if (!extrema.length || ms < extrema[0].t || ms > extrema.at(-1).t) return null;
  let lo = 0, hi = extrema.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (extrema[mid].t <= ms) lo = mid; else hi = mid; }
  const a = extrema[lo], b = extrema[hi], f = (ms - a.t) / (b.t - a.t);
  return a.h + (b.h - a.h) * (1 - Math.cos(Math.PI * f)) / 2;
}

export const tideCoverage = extrema.length
  ? { from: new Date(extrema[0].t).toISOString(), to: new Date(extrema.at(-1).t).toISOString(), n: extrema.length }
  : null;
