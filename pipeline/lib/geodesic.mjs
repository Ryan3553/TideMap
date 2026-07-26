// Along-channel distance from the open sea, measured THROUGH water.
//
// The tidal wave enters Tauranga Harbour and propagates up the channels, so the
// phase lag at a point scales with the distance the wave has travelled to reach
// it — not with straight-line distance, which would cut across Matakana Island.
// This computes a geodesic (masked) distance transform over the water mask.
//
// NOTE: the seed is the OPEN OCEAN, not a single point at the Mount. Tauranga
// Harbour has two entrances — Tauranga (Mount Maunganui) and Katikati
// (Bowentown Heads) — and both admit the tide. Seeding the whole ocean lets the
// distance field reach the northern basin through whichever entrance is
// actually closer, which is the physical situation. Seeding only the Mount
// would assign Bowentown a large lag that it does not have.
import { SIZE, BBOX } from './config.mjs';

const latMid = (BBOX.n + BBOX.s) / 2;
const KM_LAT = 110.574, KM_LON = 111.320 * Math.cos(latMid * Math.PI / 180);
export const PX_W_KM = ((BBOX.e - BBOX.w) * KM_LON) / SIZE;
export const PX_H_KM = ((BBOX.n - BBOX.s) * KM_LAT) / SIZE;

/**
 * @param {Uint8Array} water  1 where the wave can travel (subtidal | intertidal)
 * @param {Uint8Array} seed   1 where distance = 0 (open ocean)
 * @returns {Float32Array} km along water; Infinity where unreachable
 */
export function geodesicDistanceKm(water, seed) {
  const N = SIZE * SIZE;
  const d = new Float32Array(N);
  d.fill(Infinity);
  for (let i = 0; i < N; i++) if (seed[i] && water[i]) d[i] = 0;

  const a = PX_W_KM, b = PX_H_KM, c = Math.hypot(a, b);
  // 8-neighbour chamfer, alternating forward and backward raster sweeps until
  // nothing changes. A winding estuary needs several passes; it converges.
  let pass = 0, changed = true;
  while (changed && pass < 60) {
    changed = false;
    const fwd = pass % 2 === 0;
    const y0 = fwd ? 1 : SIZE - 2, y1 = fwd ? SIZE - 1 : 0, ys = fwd ? 1 : -1;
    const x0 = fwd ? 1 : SIZE - 2, x1 = fwd ? SIZE - 1 : 0, xs = fwd ? 1 : -1;
    for (let y = y0; fwd ? y < y1 : y > y1; y += ys) {
      for (let x = x0; fwd ? x < x1 : x > x1; x += xs) {
        const i = y * SIZE + x;
        if (!water[i]) continue;
        let m = d[i];
        const n1 = d[i - ys * SIZE], n2 = d[i - xs], n3 = d[i - ys * SIZE - xs], n4 = d[i - ys * SIZE + xs];
        if (n1 + b < m) m = n1 + b;
        if (n2 + a < m) m = n2 + a;
        if (n3 + c < m) m = n3 + c;
        if (n4 + c < m) m = n4 + c;
        if (m < d[i]) { d[i] = m; changed = true; }
      }
    }
    pass++;
  }
  return d;
}

/** Open-ocean seed: water pixels outside the harbour polygon. */
export function oceanSeed(water, harbourMask) {
  const s = new Uint8Array(water.length);
  for (let i = 0; i < water.length; i++) if (water[i] && !harbourMask[i]) s[i] = 1;
  return s;
}
