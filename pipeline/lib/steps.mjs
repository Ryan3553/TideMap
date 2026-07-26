// Step-fit core, shared by the fit, the validation and the model-selection
// sweeps — with an exact O(n) all-scenes leave-one-out.
//
// For a pixel, scenes in ascending effective-tide order, v_j validity, w_j
// water. For a cut index k (predict land for j<k, water for j>=k):
//     errors(k) = 2*W(k) - V(k) + Vn - Wn,   W(k)=sum_{j<k} v_j w_j, V(k)=sum_{j<k} v_j
//
// Removing scene j from the fit changes that curve by exactly one constant on
// each side of j:
//     errors_j(k) = errors(k) - v_j*(1 - w_j)     for k <= j
//                 = errors(k) - v_j*w_j           for k >  j
// (derived by substituting W->W-v_j w_j, V->V-v_j for k>j and Vn,Wn likewise.)
//
// So every leave-one-out fit is a minimum over a prefix and a suffix of ONE
// curve. Precomputing prefix and suffix minima gives all n held-out fits in
// O(n) per pixel instead of O(n^2) — the difference between 20 minutes and 6
// seconds at n=204. `selfTest()` checks it against the naive implementation.
//
// Held-out PREDICTION needs no height conversion: with the cut at k, the model
// says scene j is wet iff j >= k. That sidesteps the bracket-midpoint ambiguity
// entirely.

/** Gather a pixel's (v,w) bits in scene order. Caller supplies packed planes. */
export function gatherPixel(planes, vplanes, order, i, v, w) {
  const wd = i >>> 5, b = i & 31;
  for (let p = 0; p < order.length; p++) {
    const j = order[p];
    v[p] = (vplanes[j][wd] >>> b) & 1;
    w[p] = v[p] & ((planes[j][wd] >>> b) & 1);
  }
}

/**
 * Full fit + all leave-one-out cuts for one pixel.
 * @returns {k, minErr, looK: Int32Array(n)} where looK[p] is the cut chosen when
 *          the scene at ordered position p is held out.
 */
export function fitPixel(v, w, n, buf) {
  const { err, preMin, preFirst, preLast, sufMin, sufFirst, sufLast, looK } = buf;
  let W = 0, V = 0, Wn = 0, Vn = 0;
  for (let j = 0; j < n; j++) { Vn += v[j]; Wn += w[j]; }
  for (let k = 0; k <= n; k++) {
    err[k] = 2 * W - V + Vn - Wn;
    if (k < n) { V += v[k]; W += w[k]; }
  }
  // prefix minima over k = 0..p  (track first and last argmin for centre-of-ties)
  let m = Infinity, f = 0, l = 0;
  for (let k = 0; k <= n; k++) {
    if (err[k] < m) { m = err[k]; f = k; l = k; } else if (err[k] === m) l = k;
    preMin[k] = m; preFirst[k] = f; preLast[k] = l;
  }
  const bestK = (preFirst[n] + preLast[n]) >> 1, minErr = preMin[n];
  // suffix minima over k = p..n
  m = Infinity; f = n; l = n;
  for (let k = n; k >= 0; k--) {
    if (err[k] < m) { m = err[k]; f = k; l = k; } else if (err[k] === m) f = k;
    sufMin[k] = m; sufFirst[k] = f; sufLast[k] = l;
  }
  // leave-one-out: position p removed -> left side (k<=p) shifted by A, right (k>p) by B
  for (let p = 0; p < n; p++) {
    const A = v[p] & (1 ^ w[p]), B = v[p] & w[p];
    const left = preMin[p] - A;
    const right = p + 1 <= n ? sufMin[p + 1] - B : Infinity;
    let kf, kl;
    if (left < right) { kf = preFirst[p]; kl = preLast[p]; }
    else if (right < left) { kf = sufFirst[p + 1]; kl = sufLast[p + 1]; }
    else { kf = preFirst[p]; kl = sufLast[p + 1]; }
    looK[p] = (kf + kl) >> 1;
  }
  return { k: bestK, minErr };
}

export function makeBuf(n) {
  return {
    err: new Int32Array(n + 1),
    preMin: new Int32Array(n + 1), preFirst: new Int32Array(n + 1), preLast: new Int32Array(n + 1),
    sufMin: new Int32Array(n + 2), sufFirst: new Int32Array(n + 2), sufLast: new Int32Array(n + 2),
    looK: new Int32Array(n),
  };
}

/** Naive reference implementation, used only by selfTest. */
export function fitPixelNaive(v, w, n, exclude) {
  let Wn = 0, Vn = 0;
  for (let j = 0; j < n; j++) { if (j === exclude) continue; Vn += v[j]; Wn += w[j]; }
  let W = 0, V = 0, best = Infinity, kf = 0, kl = 0;
  for (let k = 0; k <= n; k++) {
    const e = 2 * W - V + Vn - Wn;
    if (e < best) { best = e; kf = kl = k; } else if (e === best) kl = k;
    if (k < n && k !== exclude) { V += v[k]; W += w[k]; }
  }
  return { k: (kf + kl) >> 1, minErr: best };
}

/** Randomised equivalence check of the fast path against the naive one. */
export function selfTest(trials = 4000, n = 41, seed = 12345) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const v = new Int32Array(n), w = new Int32Array(n), buf = makeBuf(n);
  let bad = 0, badPred = 0, checked = 0;
  for (let t = 0; t < trials; t++) {
    const pWet = rnd();
    for (let j = 0; j < n; j++) {
      v[j] = rnd() < 0.97 ? 1 : 0;
      // roughly monotone-in-j water with noise, like real data
      w[j] = v[j] & (rnd() < (j / n) * 0.9 + 0.05 + (pWet - 0.5) * 0.2 ? 1 : 0);
    }
    const fast = fitPixel(v, w, n, buf);
    const ref = fitPixelNaive(v, w, n, -1);
    if (fast.k !== ref.k || fast.minErr !== ref.minErr) bad++;
    for (let p = 0; p < n; p++) {
      const r = fitPixelNaive(v, w, n, p);
      // compare the PREDICTION (wet iff p >= k), which is what validation uses
      const fp = p >= buf.looK[p] ? 1 : 0, rp = p >= r.k ? 1 : 0;
      if (fp !== rp) badPred++;
      checked++;
    }
  }
  return { trials, fullFitMismatches: bad, looPredictionMismatches: badPred, looComparisons: checked };
}
