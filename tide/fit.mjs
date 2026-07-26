// Harmonic tide-model fit for Tauranga Harbour — round 2.
//
// Reads LINZ tide tables (sources/tides/tauranga_YYYY.csv), extracts tabulated
// high/low turning points, converts their local NZST/NZDT clock times to
// absolute instants, and fits a harmonic model (31 candidate constituents,
// pruned to survivors) by linear least squares (normal equations solved
// with a hand-written Gaussian elimination — no dependencies), WITH
// analytic nodal (18.6-year) corrections applied per-timestep.
//
// Round-2 changes (coordinator directive):
//   - 5 years of data now available: 2023, 2024, 2025, 2026, 2027.
//   - VALIDATION: train on 2023+2024+2025+2027, hold out 2026 as an
//     INTERIOR year (a stronger test than extrapolating past the end of
//     the record — isolates model quality from drift).
//   - Nodal corrections (f, u per constituent, from the lunar node N)
//     applied analytically PER TIMESTEP (not fitted — the 18.6y cycle
//     isn't resolvable from a 5-year record).
//   - 17 additional constituents added; survivors (fitted amplitude
//     >= 5mm) kept, the rest dropped and reported.
//   - New metrics: mid-tide height RMSE (in addition to turning-point
//     RMSE), and timing error is now the headline number.
//   - SHIPPING fit: refit survivors on ALL FIVE years (2023-2027).
//
// Re-run: `node fit.mjs` from this directory.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESEARCH_DIR = path.join(__dirname, '..', 'sources', 'tides');   // LINZ tide tables (canonical copy)

const EPOCH_MS = Date.UTC(2023, 0, 1, 0, 0, 0);
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DEG2RAD = Math.PI / 180;

// ---- NZST/NZDT offset (copied from research/tide-coverage-probe.mjs) ----
function nzOffsetHours(y, m, d, hh) {
  const lastSunSep = (() => { const dt = new Date(Date.UTC(y, 8, 30)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() - 1); return dt.getUTCDate(); })();
  const firstSunApr = (() => { const dt = new Date(Date.UTC(y, 3, 1)); while (dt.getUTCDay() !== 0) dt.setUTCDate(dt.getUTCDate() + 1); return dt.getUTCDate(); })();
  if (m > 4 && m < 9) return 12;            // May-Aug: NZST
  if (m > 9 || m < 4) return 13;            // Oct-Mar: NZDT
  if (m === 4) return d < firstSunApr ? 13 : (d === firstSunApr ? (hh < 3 ? 13 : 12) : 12);
  if (m === 9) return d < lastSunSep ? 12 : (d === lastSunSep ? (hh < 2 ? 12 : 13) : 13);
  return 12;
}

function parseYear(year) {
  const txt = fs.readFileSync(path.join(RESEARCH_DIR, `tauranga_${year}.csv`), 'utf8');
  const points = [];
  for (const line of txt.split(/\r?\n/).slice(3)) {
    const c = line.split(',');
    if (c.length < 6 || !/^\d+$/.test(c[0].trim())) continue;
    const day = +c[0], mon = +c[2], yr = +c[3];
    for (let i = 4; i + 1 < c.length; i += 2) {
      const t = (c[i] || '').trim(), h = (c[i + 1] || '').trim();
      if (!/^\d{2}:\d{2}$/.test(t) || h === '') continue;
      const [hh, mm] = t.split(':').map(Number);
      const off = nzOffsetHours(yr, mon, day, hh);
      const ms = Date.UTC(yr, mon - 1, day, hh - off, mm);
      points.push({
        ms,
        tHours: (ms - EPOCH_MS) / 3600000,
        h: +h,
        dateLabel: `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')} ${t} NZ`,
      });
    }
  }
  points.sort((a, b) => a.ms - b.ms);
  return points;
}

// ==================================================================
// Candidate constituents (speed in deg/hour). 14 original + 17 new.
// ==================================================================
const CONSTITUENT_DEFS = [
  { name: 'M2', speed: 28.984104 },
  { name: 'S2', speed: 30.000000 },
  { name: 'N2', speed: 28.439730 },
  { name: 'K2', speed: 30.082137 },
  { name: 'K1', speed: 15.041069 },
  { name: 'O1', speed: 13.943035 },
  { name: 'P1', speed: 14.958931 },
  { name: 'Q1', speed: 13.398661 },
  { name: 'M4', speed: 57.968208 },
  { name: 'MS4', speed: 58.984104 },
  { name: 'MN4', speed: 57.423832 },
  { name: 'Mf', speed: 1.098033 },
  { name: 'Mm', speed: 0.544375 },
  { name: 'SSA', speed: 0.082137 },
  // --- round-2 additions ---
  { name: '2N2', speed: 27.895355 },
  { name: 'MU2', speed: 27.968208 },
  { name: 'NU2', speed: 28.512583 },
  { name: 'L2', speed: 29.528479 },
  { name: 'T2', speed: 29.958933 },
  { name: 'LDA2', speed: 29.455625 },
  { name: 'J1', speed: 15.585443 },
  { name: 'M1', speed: 14.496694 },
  { name: 'OO1', speed: 16.139101 },
  { name: 'RHO1', speed: 13.471515 },
  { name: 'SIGMA1', speed: 12.927140 },
  { name: 'M6', speed: 86.952312 },
  { name: '2MS6', speed: 87.968208 },
  { name: 'MK3', speed: 44.025173 },
  { name: 'S4', speed: 60.000000 },
  { name: 'MSF', speed: 1.015896 },
  { name: 'SA', speed: 0.041069 },
];

// ==================================================================
// Nodal (18.6-year) corrections.
//
// N = longitude of the Moon's ascending node (Meeus, "Astronomical
// Algorithms", mean longitude of ascending node), linear term only
// (quadratic/cubic terms are ~1e-4 deg over a few years — negligible):
//   N(deg) = 125.04452 - 1934.136261 * T,  T = Julian centuries since J2000.0
//
// Nodal factor f (amplitude) and angle u (phase, degrees) per constituent,
// standard reduced (N-only, dropping lunar-perigee p dependence) formulae
// from classical harmonic-analysis tables (Schureman/Doodson-style):
//   - M2, K1, O1, K2 get their own published series in N, 2N, 3N.
//   - Species satellites (constituents generated by the same lunar terms)
//     reuse their parent's f,u: N2/2N2/MU2/NU2/L2/LDA2 -> M2's; Q1/RHO1/
//     SIGMA1/M1 -> O1's. This is a documented simplification (the exact
//     L2/M1 corrections also depend on lunar perigee p; using the parent
//     species value is standard practice when p-dependence isn't modelled).
//   - Purely solar terms (S2, P1, T2, S4, SA, SSA) get no nodal correction
//     (f=1, u=0) — they don't depend on the lunar node.
//   - Shallow-water/compound terms (M4, MN4, MS4, M6, 2MS6, MK3, MSF) are
//     literal sums/differences of parent speeds (as given above), so their
//     nodal correction is the corresponding product of f's and signed sum
//     of u's — this is exactly how real tide-prediction software derives
//     compound-tide nodal corrections, not an approximation of convenience.
// ==================================================================
function nodalAngleRad(tHours) {
  const ms = EPOCH_MS + tHours * 3600000;
  const days = (ms - J2000_MS) / 86400000;
  const T = days / 36525;
  const omegaDeg = 125.04452 - 1934.136261 * T;
  return omegaDeg * DEG2RAD;
}

function nodalFactors(N) {
  const cosN = Math.cos(N), sinN = Math.sin(N);
  const cos2N = Math.cos(2 * N), sin2N = Math.sin(2 * N);
  const cos3N = Math.cos(3 * N), sin3N = Math.sin(3 * N);

  const fM2 = 1 - 0.037 * cosN;
  const uM2 = (-2.14 * sinN) * DEG2RAD;

  const fK1 = 1.0060 + 0.1150 * cosN - 0.0088 * cos2N + 0.0006 * cos3N;
  const uK1 = (-8.86 * sinN + 0.68 * sin2N - 0.07 * sin3N) * DEG2RAD;

  const fO1 = 1.0089 + 0.1871 * cosN - 0.0147 * cos2N + 0.0014 * cos3N;
  const uO1 = (10.80 * sinN - 1.34 * sin2N + 0.19 * sin3N) * DEG2RAD;

  const fK2 = 1.0246 + 0.2863 * cosN + 0.0083 * cos2N - 0.0015 * cos3N;
  const uK2 = (-17.74 * sinN + 0.68 * sin2N - 0.04 * sin3N) * DEG2RAD;

  const fJ1 = 1.0129 + 0.1676 * cosN - 0.0170 * cos2N + 0.0016 * cos3N;
  const uJ1 = (-12.94 * sinN + 1.34 * sin2N - 0.19 * sin3N) * DEG2RAD;

  const fOO1 = 1.1027 + 0.6504 * cosN + 0.0317 * cos2N;
  const uOO1 = (-36.68 * sinN + 2.72 * sin2N) * DEG2RAD;

  const fMm = 1 - 0.130 * cosN + 0.0013 * cos2N;
  const uMm = 0;

  const fMf = 1.0429 + 0.4135 * cosN - 0.004 * cos2N;
  const uMf = (-23.74 * sinN + 2.68 * sin2N - 0.38 * sin3N) * DEG2RAD;

  return { fM2, uM2, fK1, uK1, fO1, uO1, fK2, uK2, fJ1, uJ1, fOO1, uOO1, fMm, uMm, fMf, uMf };
}

// name -> (nf) => {f, u(radians)}
const NODAL_MAP = {
  M2: nf => ({ f: nf.fM2, u: nf.uM2 }),
  S2: () => ({ f: 1, u: 0 }),
  N2: nf => ({ f: nf.fM2, u: nf.uM2 }),
  K2: nf => ({ f: nf.fK2, u: nf.uK2 }),
  K1: nf => ({ f: nf.fK1, u: nf.uK1 }),
  O1: nf => ({ f: nf.fO1, u: nf.uO1 }),
  P1: () => ({ f: 1, u: 0 }),
  Q1: nf => ({ f: nf.fO1, u: nf.uO1 }),
  M4: nf => ({ f: nf.fM2 * nf.fM2, u: 2 * nf.uM2 }),
  MS4: nf => ({ f: nf.fM2, u: nf.uM2 }),
  MN4: nf => ({ f: nf.fM2 * nf.fM2, u: 2 * nf.uM2 }),
  Mf: nf => ({ f: nf.fMf, u: nf.uMf }),
  Mm: nf => ({ f: nf.fMm, u: nf.uMm }),
  SSA: () => ({ f: 1, u: 0 }),
  '2N2': nf => ({ f: nf.fM2, u: nf.uM2 }),
  MU2: nf => ({ f: nf.fM2, u: nf.uM2 }),
  NU2: nf => ({ f: nf.fM2, u: nf.uM2 }),
  L2: nf => ({ f: nf.fM2, u: nf.uM2 }),
  T2: () => ({ f: 1, u: 0 }),
  LDA2: nf => ({ f: nf.fM2, u: nf.uM2 }),
  J1: nf => ({ f: nf.fJ1, u: nf.uJ1 }),
  M1: nf => ({ f: nf.fO1, u: nf.uO1 }),
  OO1: nf => ({ f: nf.fOO1, u: nf.uOO1 }),
  RHO1: nf => ({ f: nf.fO1, u: nf.uO1 }),
  SIGMA1: nf => ({ f: nf.fO1, u: nf.uO1 }),
  M6: nf => ({ f: nf.fM2 * nf.fM2 * nf.fM2, u: 3 * nf.uM2 }),
  '2MS6': nf => ({ f: nf.fM2 * nf.fM2, u: 2 * nf.uM2 }),
  MK3: nf => ({ f: nf.fM2 * nf.fK1, u: nf.uM2 + nf.uK1 }),
  S4: () => ({ f: 1, u: 0 }),
  MSF: nf => ({ f: nf.fM2, u: -nf.uM2 }),
  SA: () => ({ f: 1, u: 0 }),
};

// ==================================================================
// Linear least squares machinery
// ==================================================================
function makeFitter(defs) {
  const omega = defs.map(c => c.speed * DEG2RAD); // rad/hour
  const nc = defs.length;
  const nparam = 1 + 2 * nc;

  function basisVector(tHours) {
    const N = nodalAngleRad(tHours);
    const nf = nodalFactors(N);
    const b = new Array(nparam);
    b[0] = 1;
    for (let i = 0; i < nc; i++) {
      const { f, u } = NODAL_MAP[defs[i].name](nf);
      const arg = omega[i] * tHours - u;
      b[1 + 2 * i] = f * Math.cos(arg);
      b[2 + 2 * i] = f * Math.sin(arg);
    }
    return b;
  }

  function heightAt(model, tHours) {
    const N = nodalAngleRad(tHours);
    const nf = nodalFactors(N);
    let h = model.Z0;
    for (const c of model.constituents) {
      const { f, u } = NODAL_MAP[c.name](nf);
      h += f * c.amplitude * Math.cos(c.omega * tHours - c.phase - u);
    }
    return h;
  }

  // Derivative w.r.t. t, treating the (slowly-varying, 18.6y-scale) nodal
  // envelope f(t), u(t) as frozen at t — an excellent approximation since
  // d(f)/dt, d(u)/dt are ~1e-5/hour vs omega ~ up to 1.6 rad/hour.
  function derivativeAt(model, tHours) {
    const N = nodalAngleRad(tHours);
    const nf = nodalFactors(N);
    let d = 0;
    for (const c of model.constituents) {
      const { f, u } = NODAL_MAP[c.name](nf);
      d += -f * c.amplitude * c.omega * Math.sin(c.omega * tHours - c.phase - u);
    }
    return d;
  }

  function fit(points) {
    const ATA = Array.from({ length: nparam }, () => new Array(nparam).fill(0));
    const ATy = new Array(nparam).fill(0);
    for (const p of points) {
      const b = basisVector(p.tHours);
      for (let i = 0; i < nparam; i++) {
        ATy[i] += b[i] * p.h;
        for (let j = i; j < nparam; j++) ATA[i][j] += b[i] * b[j];
      }
    }
    for (let i = 0; i < nparam; i++) for (let j = 0; j < i; j++) ATA[i][j] = ATA[j][i];
    const c = solveLinearSystem(ATA, ATy);

    const Z0 = c[0];
    const constituents = defs.map((def, i) => {
      const a = c[1 + 2 * i], b = c[2 + 2 * i];
      const amplitude = Math.hypot(a, b);
      const phase = Math.atan2(b, a);
      return { name: def.name, speed: def.speed, omega: omega[i], amplitude, phase };
    });
    return { Z0, constituents };
  }

  return { fit, heightAt, derivativeAt, nparam };
}

function solveLinearSystem(A, y) {
  const n = A.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-14) throw new Error(`Singular matrix at column ${col}`);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pv;
      if (factor === 0) continue;
      for (let cc = col; cc <= n; cc++) M[r][cc] -= factor * M[col][cc];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function rmse(errs) { return Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length); }

// Find the model's own turning point nearest to t0 (hours), searching
// within +/- windowH hours, refined by bisection on the derivative's sign
// change (analytic derivative -> converges to sub-second precision fast).
function nearestModelTurningPoint(fitter, model, t0, windowH = 3, coarseStepMin = 2) {
  const stepH = coarseStepMin / 60;
  let best = null;
  let prevT = t0 - windowH, prevD = fitter.derivativeAt(model, prevT);
  for (let t = t0 - windowH + stepH; t <= t0 + windowH + 1e-9; t += stepH) {
    const d = fitter.derivativeAt(model, t);
    if ((prevD <= 0 && d > 0) || (prevD >= 0 && d < 0)) {
      let lo = prevT, hi = t, dLo = prevD;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        const dMid = fitter.derivativeAt(model, mid);
        if ((dLo <= 0 && dMid > 0) || (dLo >= 0 && dMid < 0)) hi = mid; else { lo = mid; dLo = dMid; }
      }
      const tExt = (lo + hi) / 2;
      const dist = Math.abs(tExt - t0);
      if (!best || dist < best.dist) best = { tHours: tExt, dist, h: fitter.heightAt(model, tExt) };
    }
    prevT = t; prevD = d;
  }
  return best;
}

// ---- Baseline: cosine interpolation between tabulated turning points ----
function cosineInterp(a, b, t) {
  const f = (t - a.tHours) / (b.tHours - a.tHours);
  return a.h + (b.h - a.h) * (1 - Math.cos(Math.PI * f)) / 2;
}
function baselineLeaveOneOut(points) {
  const errs = [];
  for (let i = 1; i < points.length - 1; i++) {
    const pred = cosineInterp(points[i - 1], points[i + 1], points[i].tHours);
    errs.push(pred - points[i].h);
  }
  return errs;
}

// "Mid-tide" proxy: the point in time halfway between each pair of
// ADJACENT tabulated turning points (the steepest part of the curve) is
// where a continuously-moving display spends most of its time, but LINZ's
// tables never record height there. No continuous ground truth exists in
// this dataset (no tide-gauge time series, only turning points), so we use
// the standard first-order proxy for near-sinusoidal semidiurnal tides:
// height at the temporal midpoint between high and low ~= average of the
// two adjacent tabulated heights (this is also exactly what plain cosine
// interpolation predicts at f=0.5, since (1-cos(pi*0.5))/2 = 0.5). This is
// a proxy, not a measurement — documented plainly in docs/tide-validation.md.
function midTideProxy(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const gapH = b.tHours - a.tHours;
    if (gapH <= 0 || gapH > 9) continue; // skip missing/garbled rows
    out.push({ tHours: (a.tHours + b.tHours) / 2, h: (a.h + b.h) / 2, aLabel: a.dateLabel });
  }
  return out;
}

// ==================================================================
// Load all years
// ==================================================================
const y2023 = parseYear(2023), y2024 = parseYear(2024), y2025 = parseYear(2025),
  y2026 = parseYear(2026), y2027 = parseYear(2027);
console.log(`Loaded: 2023=${y2023.length} 2024=${y2024.length} 2025=${y2025.length} 2026=${y2026.length} 2027=${y2027.length} turning points\n`);

const train = [...y2023, ...y2024, ...y2025, ...y2027]; // hold out 2026 (interior year)
const test = y2026;
console.log(`Training points (2023+2024+2025+2027): ${train.length}`);
console.log(`Held-out test points (2026, interior year): ${test.length}\n`);

// ==================================================================
// Step 1: fit all 31 candidates, identify survivors (amplitude >= 5mm)
// ==================================================================
const fullFitter = makeFitter(CONSTITUENT_DEFS);
const fullModel = fullFitter.fit(train);

console.log(`=== All ${CONSTITUENT_DEFS.length} candidate constituents (train: 2023+2024+2025+2027) ===`);
const bySize = [...fullModel.constituents].sort((a, b) => b.amplitude - a.amplitude);
for (const c of bySize) console.log(`  ${c.name.padEnd(7)} amplitude=${c.amplitude.toFixed(4)} m`);

const SURVIVAL_THRESHOLD = 0.005; // 5 mm
const survivors = fullModel.constituents.filter(c => c.amplitude >= SURVIVAL_THRESHOLD).map(c => c.name);
const dropped = fullModel.constituents.filter(c => c.amplitude < SURVIVAL_THRESHOLD);
console.log(`\nSurvivors (amplitude >= 5mm): ${survivors.length} / ${CONSTITUENT_DEFS.length}`);
console.log(`  kept: ${survivors.join(', ')}`);
console.log(`Dropped (< 5mm): ${dropped.map(c => `${c.name}(${(c.amplitude * 1000).toFixed(1)}mm)`).join(', ')}\n`);

// ==================================================================
// Step 2: refit using only survivors (cleaner, avoids near-collinear
// noise from tiny terms) — this is the model used for validation numbers.
// ==================================================================
const survivorDefs = CONSTITUENT_DEFS.filter(d => survivors.includes(d.name));
const fitter = makeFitter(survivorDefs);
const trainedModel = fitter.fit(train);

console.log(`=== Survivor-only fit (${survivorDefs.length} constituents, train: 2023+2024+2025+2027) ===`);
for (const c of [...trainedModel.constituents].sort((a, b) => b.amplitude - a.amplitude)) {
  console.log(`  ${c.name.padEnd(7)} amplitude=${c.amplitude.toFixed(4)} m   phase=${(c.phase * 180 / Math.PI).toFixed(2)} deg`);
}
console.log(`  Z0 = ${trainedModel.Z0.toFixed(4)} m\n`);

// ---- Height accuracy at held-out turning points ----
const heightErrs = test.map(p => fitter.heightAt(trainedModel, p.tHours) - p.h);
const heightRMSE = rmse(heightErrs);
const heightMax = Math.max(...heightErrs.map(Math.abs));

// ---- Mid-tide accuracy (proxy ground truth, see midTideProxy docs) ----
const midPts = midTideProxy(test);
const midErrs = midPts.map(p => fitter.heightAt(trainedModel, p.tHours) - p.h);
const midRMSE = rmse(midErrs);
const midMax = Math.max(...midErrs.map(Math.abs));

// ---- Timing accuracy: model's own nearest turning point vs tabulated ----
const timingErrsMin = [];
const perPoint = [];
for (const p of test) {
  const m = nearestModelTurningPoint(fitter, trainedModel, p.tHours);
  const dtMin = m ? (m.tHours - p.tHours) * 60 : null;
  if (dtMin != null) timingErrsMin.push(dtMin);
  perPoint.push({ ...p, predH: fitter.heightAt(trainedModel, p.tHours), hErr: fitter.heightAt(trainedModel, p.tHours) - p.h, timingErrMin: dtMin });
}
const timingAbs = timingErrsMin.map(Math.abs);
const timingMeanAbs = timingAbs.reduce((s, e) => s + e, 0) / timingAbs.length;
const timingMax = Math.max(...timingAbs);

console.log('=== HEADLINE: held-out 2026 validation (interior year, never in training) ===');
console.log(`Timing mean |err|: ${timingMeanAbs.toFixed(2)} min   <-- headline`);
console.log(`Timing max |err|:  ${timingMax.toFixed(2)} min`);
console.log(`Height RMSE (turning points): ${heightRMSE.toFixed(4)} m`);
console.log(`Height max err (turning points): ${heightMax.toFixed(4)} m`);
console.log(`Height RMSE (mid-tide proxy): ${midRMSE.toFixed(4)} m`);
console.log(`Height max err (mid-tide proxy): ${midMax.toFixed(4)} m\n`);

const worst = [...perPoint].sort((a, b) => Math.abs(b.hErr) - Math.abs(a.hErr)).slice(0, 10);
console.log('=== Worst 10 height misses (2026 held-out) ===');
for (const w of worst) {
  console.log(`  ${w.dateLabel}  actual=${w.h.toFixed(2)}m  predicted=${w.predH.toFixed(3)}m  err=${w.hErr >= 0 ? '+' : ''}${w.hErr.toFixed(3)}m  timing=${w.timingErrMin == null ? 'n/a' : (w.timingErrMin >= 0 ? '+' : '') + w.timingErrMin.toFixed(1) + 'min'}`);
}
console.log();

const worstTiming = [...perPoint].filter(p => p.timingErrMin != null).sort((a, b) => Math.abs(b.timingErrMin) - Math.abs(a.timingErrMin)).slice(0, 10);
console.log('=== Worst 10 TIMING misses (2026 held-out) ===');
for (const w of worstTiming) {
  console.log(`  ${w.dateLabel}  timing_err=${w.timingErrMin >= 0 ? '+' : ''}${w.timingErrMin.toFixed(1)}min  height_err=${w.hErr >= 0 ? '+' : ''}${w.hErr.toFixed(3)}m`);
}
console.log();

const baselineErrs = baselineLeaveOneOut(test);
const baselineRMSE = rmse(baselineErrs);
const baselineMax = Math.max(...baselineErrs.map(Math.abs));
console.log('=== Baseline: cosine interpolation (leave-one-out, 2026 turning points) ===');
console.log(`Baseline RMSE:    ${baselineRMSE.toFixed(4)} m`);
console.log(`Baseline max err: ${baselineMax.toFixed(4)} m`);
console.log(`Harmonic model ${heightRMSE < baselineRMSE ? 'BEATS' : 'DOES NOT BEAT'} the baseline on turning-point RMSE ` +
  `(${heightRMSE.toFixed(4)} vs ${baselineRMSE.toFixed(4)} m).\n`);

const m2 = trainedModel.constituents.find(c => c.name === 'M2');
const maxAmp = Math.max(...trainedModel.constituents.map(c => c.amplitude));
console.log('=== Physics sanity check ===');
console.log(`M2 amplitude: ${m2.amplitude.toFixed(4)} m (expect ~0.7 m)`);
console.log(`M2 is largest constituent: ${m2.amplitude === maxAmp ? 'YES' : 'NO'}\n`);

// ==================================================================
// Comparison run: same survivor set, WITHOUT nodal corrections, to
// directly quantify whether nodal correction helped (coordinator asked).
// ==================================================================
function makeFitterNoNodal(defs) {
  const omega = defs.map(c => c.speed * DEG2RAD);
  const nc = defs.length;
  const nparam = 1 + 2 * nc;
  function basisVector(tHours) {
    const b = new Array(nparam); b[0] = 1;
    for (let i = 0; i < nc; i++) {
      const arg = omega[i] * tHours;
      b[1 + 2 * i] = Math.cos(arg);
      b[2 + 2 * i] = Math.sin(arg);
    }
    return b;
  }
  function heightAt(model, tHours) {
    let h = model.Z0;
    for (const c of model.constituents) h += c.amplitude * Math.cos(c.omega * tHours - c.phase);
    return h;
  }
  function derivativeAt(model, tHours) {
    let d = 0;
    for (const c of model.constituents) d += -c.amplitude * c.omega * Math.sin(c.omega * tHours - c.phase);
    return d;
  }
  function fit(points) {
    const ATA = Array.from({ length: nparam }, () => new Array(nparam).fill(0));
    const ATy = new Array(nparam).fill(0);
    for (const p of points) {
      const b = basisVector(p.tHours);
      for (let i = 0; i < nparam; i++) {
        ATy[i] += b[i] * p.h;
        for (let j = i; j < nparam; j++) ATA[i][j] += b[i] * b[j];
      }
    }
    for (let i = 0; i < nparam; i++) for (let j = 0; j < i; j++) ATA[i][j] = ATA[j][i];
    const c = solveLinearSystem(ATA, ATy);
    const Z0 = c[0];
    const constituents = defs.map((def, i) => {
      const a = c[1 + 2 * i], b = c[2 + 2 * i];
      return { name: def.name, speed: def.speed, omega: omega[i], amplitude: Math.hypot(a, b), phase: Math.atan2(b, a) };
    });
    return { Z0, constituents };
  }
  return { fit, heightAt, derivativeAt };
}
const noNodalFitter = makeFitterNoNodal(survivorDefs);
const noNodalModel = noNodalFitter.fit(train);
const noNodalHeightErrs = test.map(p => noNodalFitter.heightAt(noNodalModel, p.tHours) - p.h);
const noNodalHeightRMSE = rmse(noNodalHeightErrs);
const noNodalTimingErrs = [];
for (const p of test) {
  const m = nearestModelTurningPoint(noNodalFitter, noNodalModel, p.tHours);
  if (m) noNodalTimingErrs.push(Math.abs((m.tHours - p.tHours) * 60));
}
const noNodalTimingMean = noNodalTimingErrs.reduce((s, e) => s + e, 0) / noNodalTimingErrs.length;
const noNodalTimingMax = Math.max(...noNodalTimingErrs);
console.log('=== Nodal-correction A/B (same survivor set, same train/test split) ===');
console.log(`WITHOUT nodal correction: height RMSE=${noNodalHeightRMSE.toFixed(4)} m, timing mean=${noNodalTimingMean.toFixed(2)} min, timing max=${noNodalTimingMax.toFixed(2)} min`);
console.log(`WITH nodal correction:    height RMSE=${heightRMSE.toFixed(4)} m, timing mean=${timingMeanAbs.toFixed(2)} min, timing max=${timingMax.toFixed(2)} min\n`);

// ==================================================================
// Step 3: SHIP — refit survivors on ALL FIVE available years
// ==================================================================
const allData = [...y2023, ...y2024, ...y2025, ...y2026, ...y2027];
const shipModel = fitter.fit(allData);
console.log(`=== Shipping fit (all 5 years 2023-2027, ${allData.length} points, ${survivorDefs.length} constituents) ===`);
for (const c of [...shipModel.constituents].sort((a, b) => b.amplitude - a.amplitude)) {
  console.log(`  ${c.name.padEnd(7)} amplitude=${c.amplitude.toFixed(4)} m   phase=${(c.phase * 180 / Math.PI).toFixed(2)} deg`);
}
console.log(`  Z0 = ${shipModel.Z0.toFixed(4)} m`);

// ==================================================================
// Write shipping module
// ==================================================================
const moduleSrc = `// Tauranga Harbour tide-prediction module — harmonic constituent model.
// AUTO-GENERATED by tide/fit.mjs — do not hand-edit the constants below.
//
// Source data: LINZ (Land Information New Zealand) official tide tables for
// Tauranga (port 073), tauranga_2023..2027.csv. Heights are metres above
// CHART DATUM (not mean sea level). A shipping app MUST carry LINZ
// attribution — see docs/tide-validation.md.
//
// Model: h(t) = Z0 + sum_i f_i(t) * A_i * cos(omega_i * t - phi_i - u_i(t))
// t = hours since EPOCH_MS (2023-01-01T00:00:00Z), omega_i in rad/hour.
// f_i(t), u_i(t) are analytic nodal (18.6-year lunar node) corrections —
// NOT fitted (unresolvable from a 5-year record) — evaluated per timestep
// from the lunar node longitude N(t). See fit.mjs for the derivation and
// which constituents share a parent species' correction (documented
// simplification for satellites of M2/O1 without lunar-perigee dependence).
//
// Round-2 validation (fit on 2023+2024+2025+2027, held out 2026 as an
// INTERIOR year — a stronger test than extrapolating past the record):
//   HEADLINE timing error: mean ${timingMeanAbs.toFixed(2)} min, max ${timingMax.toFixed(2)} min
//   height RMSE at turning points: ${heightRMSE.toFixed(4)} m (max ${heightMax.toFixed(4)} m)
//   height RMSE at mid-tide (proxy): ${midRMSE.toFixed(4)} m (max ${midMax.toFixed(4)} m)
// Full numbers, worst-case tables and methodology caveats: docs/tide-validation.md.
//
// ${survivorDefs.length} of ${CONSTITUENT_DEFS.length} candidate constituents survived the
// >=5mm amplitude threshold and are shipped below (see docs/tide-validation.md for
// the dropped list).
//
// These shipping coefficients are refit on ALL FIVE available years
// (2023-2027) for slightly better accuracy than the held-out validation run.

export const EPOCH_MS = ${EPOCH_MS};
const J2000_MS = ${J2000_MS};
const DEG2RAD = Math.PI / 180;
export const Z0 = ${shipModel.Z0};

export const CONSTITUENTS = [
${shipModel.constituents.map(c => `  { name: ${JSON.stringify(c.name)}, omega: ${c.omega}, amplitude: ${c.amplitude}, phase: ${c.phase} },`).join('\n')}
];

// ---- Nodal correction (see fit.mjs header comment for full derivation) ----
function nodalAngleRad(tHours) {
  const ms = EPOCH_MS + tHours * 3600000;
  const days = (ms - J2000_MS) / 86400000;
  const T = days / 36525;
  const omegaDeg = 125.04452 - 1934.136261 * T;
  return omegaDeg * DEG2RAD;
}

function nodalFactors(N) {
  const cosN = Math.cos(N), sinN = Math.sin(N);
  const cos2N = Math.cos(2 * N), sin2N = Math.sin(2 * N);
  const cos3N = Math.cos(3 * N), sin3N = Math.sin(3 * N);
  const fM2 = 1 - 0.037 * cosN;
  const uM2 = (-2.14 * sinN) * DEG2RAD;
  const fK1 = 1.0060 + 0.1150 * cosN - 0.0088 * cos2N + 0.0006 * cos3N;
  const uK1 = (-8.86 * sinN + 0.68 * sin2N - 0.07 * sin3N) * DEG2RAD;
  const fO1 = 1.0089 + 0.1871 * cosN - 0.0147 * cos2N + 0.0014 * cos3N;
  const uO1 = (10.80 * sinN - 1.34 * sin2N + 0.19 * sin3N) * DEG2RAD;
  const fK2 = 1.0246 + 0.2863 * cosN + 0.0083 * cos2N - 0.0015 * cos3N;
  const uK2 = (-17.74 * sinN + 0.68 * sin2N - 0.04 * sin3N) * DEG2RAD;
  const fJ1 = 1.0129 + 0.1676 * cosN - 0.0170 * cos2N + 0.0016 * cos3N;
  const uJ1 = (-12.94 * sinN + 1.34 * sin2N - 0.19 * sin3N) * DEG2RAD;
  const fOO1 = 1.1027 + 0.6504 * cosN + 0.0317 * cos2N;
  const uOO1 = (-36.68 * sinN + 2.72 * sin2N) * DEG2RAD;
  const fMm = 1 - 0.130 * cosN + 0.0013 * cos2N;
  const uMm = 0;
  const fMf = 1.0429 + 0.4135 * cosN - 0.004 * cos2N;
  const uMf = (-23.74 * sinN + 2.68 * sin2N - 0.38 * sin3N) * DEG2RAD;
  return { fM2, uM2, fK1, uK1, fO1, uO1, fK2, uK2, fJ1, uJ1, fOO1, uOO1, fMm, uMm, fMf, uMf };
}

const NODAL_MAP = {
  M2: nf => [nf.fM2, nf.uM2], S2: () => [1, 0], N2: nf => [nf.fM2, nf.uM2],
  K2: nf => [nf.fK2, nf.uK2], K1: nf => [nf.fK1, nf.uK1], O1: nf => [nf.fO1, nf.uO1],
  P1: () => [1, 0], Q1: nf => [nf.fO1, nf.uO1],
  M4: nf => [nf.fM2 * nf.fM2, 2 * nf.uM2], MS4: nf => [nf.fM2, nf.uM2],
  MN4: nf => [nf.fM2 * nf.fM2, 2 * nf.uM2], Mf: nf => [nf.fMf, nf.uMf], Mm: nf => [nf.fMm, nf.uMm],
  SSA: () => [1, 0], '2N2': nf => [nf.fM2, nf.uM2], MU2: nf => [nf.fM2, nf.uM2],
  NU2: nf => [nf.fM2, nf.uM2], L2: nf => [nf.fM2, nf.uM2], T2: () => [1, 0],
  LDA2: nf => [nf.fM2, nf.uM2], J1: nf => [nf.fJ1, nf.uJ1], M1: nf => [nf.fO1, nf.uO1],
  OO1: nf => [nf.fOO1, nf.uOO1], RHO1: nf => [nf.fO1, nf.uO1], SIGMA1: nf => [nf.fO1, nf.uO1],
  M6: nf => [nf.fM2 * nf.fM2 * nf.fM2, 3 * nf.uM2], '2MS6': nf => [nf.fM2 * nf.fM2, 2 * nf.uM2],
  MK3: nf => [nf.fM2 * nf.fK1, nf.uM2 + nf.uK1], S4: () => [1, 0],
  MSF: nf => [nf.fM2, -nf.uM2], SA: () => [1, 0],
};

function hoursSinceEpoch(date) {
  return (date.getTime() - EPOCH_MS) / 3600000;
}

function heightAtHours(t) {
  const N = nodalAngleRad(t);
  const nf = nodalFactors(N);
  let h = Z0;
  for (const c of CONSTITUENTS) {
    const [f, u] = NODAL_MAP[c.name](nf);
    h += f * c.amplitude * Math.cos(c.omega * t - c.phase - u);
  }
  return h;
}

function derivativeAtHours(t) {
  const N = nodalAngleRad(t);
  const nf = nodalFactors(N);
  let d = 0;
  for (const c of CONSTITUENTS) {
    const [f, u] = NODAL_MAP[c.name](nf);
    d += -f * c.amplitude * c.omega * Math.sin(c.omega * t - c.phase - u);
  }
  return d;
}

/** Predicted tide height (metres above chart datum) at an instant. */
export function predict(date) {
  return heightAtHours(hoursSinceEpoch(date));
}

/** Predicted tide curve between two instants, sampled every stepMinutes. */
export function predictRange(startDate, endDate, stepMinutes) {
  const out = [];
  const stepMs = stepMinutes * 60000;
  for (let ms = startDate.getTime(); ms <= endDate.getTime(); ms += stepMs) {
    const t = (ms - EPOCH_MS) / 3600000;
    out.push({ t: new Date(ms), h: heightAtHours(t) });
  }
  return out;
}

function refineExtremum(loT, hiT, dLo) {
  let lo = loT, hi = hiT;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const dMid = derivativeAtHours(mid);
    if ((dLo <= 0 && dMid > 0) || (dLo >= 0 && dMid < 0)) hi = mid;
    else { lo = mid; dLo = dMid; }
  }
  return (lo + hi) / 2;
}

/**
 * Upcoming high/low turning points from a given instant onward.
 * Returns [{ time: Date, height: number, type: 'high'|'low' }, ...]
 */
export function nextTurningPoints(date, count = 4) {
  const t0 = hoursSinceEpoch(date);
  const stepH = 2 / 60; // 2-minute coarse scan
  const results = [];
  let prevT = t0, prevD = derivativeAtHours(t0);
  const maxScanH = 24 * 30; // safety bound: 30 days
  for (let t = t0 + stepH; t <= t0 + maxScanH && results.length < count; t += stepH) {
    const d = derivativeAtHours(t);
    if ((prevD > 0 && d <= 0) || (prevD < 0 && d >= 0)) {
      const tExt = refineExtremum(prevT, t, prevD);
      const h = heightAtHours(tExt);
      const type = prevD > 0 ? 'high' : 'low';
      results.push({ time: new Date(EPOCH_MS + tExt * 3600000), height: h, type });
    }
    prevT = t; prevD = d;
  }
  return results;
}
`;

fs.writeFileSync(path.join(__dirname, 'tauranga-tide.js'), moduleSrc);
console.log(`\nWrote ${path.join(__dirname, 'tauranga-tide.js')} (${moduleSrc.length} bytes)`);

// Export a few numbers for docs/tide-validation.md bookkeeping (printed as JSON so
// they can be grepped/diffed if fit.mjs is re-run later).
console.log('\n=== SUMMARY JSON ===');
console.log(JSON.stringify({
  survivorCount: survivorDefs.length,
  candidateCount: CONSTITUENT_DEFS.length,
  droppedNames: dropped.map(c => c.name),
  timingMeanAbsMin: timingMeanAbs,
  timingMaxAbsMin: timingMax,
  heightRMSE_turningPoints: heightRMSE,
  heightMax_turningPoints: heightMax,
  heightRMSE_midTide: midRMSE,
  heightMax_midTide: midMax,
  baselineRMSE,
  baselineMax,
  m2Amplitude: m2.amplitude,
  noNodal: { heightRMSE: noNodalHeightRMSE, timingMean: noNodalTimingMean, timingMax: noNodalTimingMax },
}, null, 2));
