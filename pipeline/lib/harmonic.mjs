// Harmonic tide model fitted by least squares to the LINZ Tauranga tide-table
// extrema. Purpose: label Sentinel-2 scenes from 2023, for which the local LINZ
// CSV is missing (see docs/pipeline-validation.md). The fit is validated by holdout in
// 1b-tide-check.mjs — do not use it without reading that number.
//
// h(t) = Z0 + sum_i [ A_i cos(w_i t) + B_i sin(w_i t) ]

// Angular speeds, degrees per mean solar hour (standard Doodson values).
export const CONSTITUENTS = [
  ['M2', 28.9841042], ['S2', 30.0000000], ['N2', 28.4397295], ['K2', 30.0821373],
  ['K1', 15.0410686], ['O1', 13.9430356], ['P1', 14.9589314], ['Q1', 13.3986609],
  ['2N2', 27.8953548], ['MU2', 27.9682084], ['NU2', 28.5125831], ['L2', 29.5284789],
  ['T2', 29.9589333], ['S1', 15.0000000], ['J1', 15.5854433], ['M1', 14.4966939],
  ['OO1', 16.1391017], ['MF', 1.0980331], ['MM', 0.5443747],
  ['SSA', 0.0821373], ['SA', 0.0410686], ['MSF', 1.0158958],
  ['M4', 57.9682084], ['MS4', 58.9841042], ['MN4', 57.4238337], ['M6', 86.9523127],
  ['2MS6', 87.9682084], ['S4', 60.0000000], ['MK3', 44.0251729], ['M3', 43.4761563],
];

const T0 = Date.UTC(2025, 0, 1); // arbitrary phase epoch

function basis(ms) {
  const hours = (ms - T0) / 3600000;
  const row = new Float64Array(1 + 2 * CONSTITUENTS.length);
  row[0] = 1;
  for (let i = 0; i < CONSTITUENTS.length; i++) {
    const a = (CONSTITUENTS[i][1] * Math.PI / 180) * hours;
    row[1 + 2 * i] = Math.cos(a);
    row[2 + 2 * i] = Math.sin(a);
  }
  return row;
}

// Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const piv = A[c][c];
    if (Math.abs(piv) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / piv;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) < 1e-12 ? 0 : s / A[r][r];
  }
  return x;
}

/** Fit to [{t, h}] samples. Returns a predict(ms) function. */
export function fitHarmonic(samples) {
  const n = 1 + 2 * CONSTITUENTS.length;
  const AtA = Array.from({ length: n }, () => new Float64Array(n));
  const Atb = new Float64Array(n);
  for (const s of samples) {
    const r = basis(s.t);
    for (let i = 0; i < n; i++) {
      Atb[i] += r[i] * s.h;
      for (let j = i; j < n; j++) AtA[i][j] += r[i] * r[j];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) AtA[i][j] = AtA[j][i];
  // tiny ridge term for numerical stability against near-degenerate pairs
  for (let i = 0; i < n; i++) AtA[i][i] += 1e-6;
  const x = solve(AtA.map(r => Float64Array.from(r)), Float64Array.from(Atb));
  return (ms) => {
    const r = basis(ms);
    let v = 0;
    for (let i = 0; i < n; i++) v += r[i] * x[i];
    return v;
  };
}
