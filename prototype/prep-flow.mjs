// J4 — the flowing, swirling channel texture.
//
// Water flows ALONG channels: perpendicular to the gradient of a combined height/bathy
// "terrain" surface. We build that surface, take its gradient at several smoothing scales
// (a pyramid — fine detail where the channel geometry is strong, falling back to a coarser
// look where the water is flat and featureless), rotate it 90 degrees to get the along-channel
// tangent, sign it consistently seaward using a coarse-scale reference, then run a Line
// Integral Convolution (LIC) of noise along that tangent field. Two phases (A, B) come out of
// ONE integrated streamline, sampled through two overlapping windows offset by a few px — so
// they are phase-coherent and the renderer can crossfade/scroll between them for motion.
//
// Round 2: every smoothing step in this file is a hand-rolled, seamless box-approximated
// Gaussian (see gaussBlur below), NOT sharp's .blur(). sharp's blur produced hard rectangular
// discontinuities at the sigmas this script needs (64-256 work-px) — visible as block edges in
// the pyramid gradient, the local-contrast stats, and therefore the LIC output. gaussBlur has no
// tiling of any kind (plain sliding-window box passes over the full array), so it cannot seam.
//
// Not run through look.mjs / template-v2.html — those are untouched by this job. This script
// only reads prototype/data/field-v2.png and writes prototype/data/flow.png + flow.json.
import fs from 'fs';
import sharp from 'sharp';

const OUT = Number(process.argv[2] ?? 4096);          // output texture size (matches field-v2.png)
const WORK = Number(process.argv[3] ?? 2048);          // internal compute grid (perf; upsampled to OUT)
const R = WORK / OUT;                                  // work-px per output-px

const H_LO = -0.75, H_HI = 3.25;                       // must match field-v2.json

// ---- constants (output-px units unless noted; scaled to WORK below) ----------------------
const SIGMAS_OUT = [8, 16, 32, 64, 128, 256];          // gradient pyramid, finest to coarsest
const SCORE_LO = 4, SCORE_HI = 14;                     // |g|*sigma confidence band for level blend
const L_OUT = 40;                                      // LIC half-length, px
const SHIFT_OUT = 10;                                  // phase-B downstream shift, px
const LOCAL_SIGMA_OUT = 72;                            // local-contrast neighbourhood, px (spec: ~48-96)
const CONTRAST_K = 1.7;                                // local-contrast stretch aggressiveness
const FAR_FLOOR = 0.02;                                // mask floor on open ocean (J5 owns swell out there)
const LAND_H = [2.0, 2.4];                             // mask fade-out band, metres (0 at 2.4)
const OCEAN_BATHY = [0.20, 0.45];                      // bathy proxy band: full strength below lo, fading to the floor by hi
const NOISE_SIGMA = 1.3;                               // work-px; widens LIC streaks past 1px so upsampling doesn't alias
const ISLET_MAX_DIM_OUT = 50;                          // output-px; land-like blobs smaller than this, surrounded by water, are erased pre-gradient
const ISLET_HN_THRESH = 0.85;                          // heightNorm above which a pixel counts as "land-like" for islet detection
// prep-field.mjs's chamfer distance saturates at DEEP_PX=220 SOURCE px (~3.4km) — meaning any
// erased islet suppressed the bathy proxy for every water pixel within ~3.4km of it (its nearest
// "shore" was this fake island, not the real coast, so the WHOLE ~3.4km depression is
// contaminated, not just the blob's own footprint). ISLET_INFLUENCE_OUT excludes that whole disc
// from the healing average (not just the erased pixels); ISLET_HEAL_SIGMA_OUT is how far past
// that disc's edge the fill average reaches to find clean water.
const ISLET_INFLUENCE_OUT = 420;
const ISLET_HEAL_SIGMA_OUT = 350;
const CURVE_SIGMA_OUT = 18;                            // output-px; smoothing scale the channel-likeliness curvature is measured at
const FEATURELESS_FLOOR = 0.20;                        // amplitude on flat, featureless water (spec: ~0.2)
// Vortex/critical-point suppression — see the winding-number detector in section 3c for why this
// replaced two earlier (pointwise curl, then path-accumulated rotation) attempts that did not
// work: LIC's ring artifact is a property of the FIELD near a critical point (nearby streamlines
// at the same radius are nearly identical), not of any one streamline's own curvature.

const SIGMAS = SIGMAS_OUT.map(s => Math.max(1, s * R));
const L = Math.round(L_OUT * R);
const SHIFT = Math.round(SHIFT_OUT * R);
const LOCAL_SIGMA = Math.max(4, LOCAL_SIGMA_OUT * R);
const CURVE_SIGMA = Math.max(1, CURVE_SIGMA_OUT * R);
const ISLET_MAX_DIM = Math.max(2, Math.round(ISLET_MAX_DIM_OUT * R));

console.log(`prep-flow: OUT=${OUT} WORK=${WORK} sigmas(work)=${SIGMAS.map(s=>s.toFixed(1))} L=${L} SHIFT=${SHIFT}`);

// ============================================================================================
// A seamless box-approximated Gaussian blur. Three passes of a sliding-window box blur
// (radii chosen per Kovesi/Kutskir's standard formula) converge to a near-perfect Gaussian and,
// critically, are computed as a single sliding accumulator over the WHOLE row/column — there is
// no tiling, no block boundary, nothing that can seam. Operates on Float32Array in place of
// sharp, which is what actually produced the round-1 block artifacts at large sigma.
// ============================================================================================
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
function boxBlurH(src, dst, w, h, r) {
  if (r <= 0) { dst.set(src); return; }
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const fv = src[row], lv = src[row + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1)];
    let ti = row, li = row, ri = row + r;
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri++, row + w - 1)] - fv; dst[ti++] = val * iarr; }
    for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
    for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
  }
}
function boxBlurV(src, dst, w, h, r) {
  if (r <= 0) { dst.set(src); return; }
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    const fv = src[x], lv = src[(h - 1) * w + x];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[Math.min(j, h - 1) * w + x];
    let ti = x, li = x, ri = x + r * w;
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, (h - 1) * w + x)] - fv; dst[ti] = val * iarr; ri += w; ti += w; }
    for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; dst[ti] = val * iarr; li += w; ri += w; ti += w; }
    for (let j = Math.max(h - r, r + 1); j < h; j++) { val += lv - src[li]; dst[ti] = val * iarr; li += w; ti += w; }
  }
}
function gaussBlur(src, w, h, sigma) {
  if (sigma <= 0.3) return src.slice();
  const boxes = boxesForGauss(sigma, 3);
  let img = src;
  const tmp = new Float32Array(w * h);
  for (const size of boxes) {
    const r = Math.max(0, Math.floor((size - 1) / 2));
    const out = new Float32Array(w * h);
    boxBlurH(img, tmp, w, h, r);
    boxBlurV(tmp, out, w, h, r);
    img = out;
  }
  return img;
}

// ---- load field-v2.png at WORK resolution --------------------------------------------------
// mitchell, not lanczos: lanczos rings at the land/water step (same reasoning as prep-field.mjs)
// and a ring in the height/bathy surface is a phantom channel wall. Resize is sharp's job still
// (small-kernel, not the large-sigma blur that seamed) — only smoothing moved to gaussBlur.
async function rawGray(sharpPipeline, w, h) {
  const b = await sharpPipeline.raw().toBuffer();
  if (b.length !== w * h) throw new Error(`expected ${w*h} gray bytes, got ${b.length}`);
  return b;
}
const fieldFull = sharp('data/field-v2.png').resize(WORK, WORK, { kernel: 'mitchell' });
const Rc = await rawGray(fieldFull.clone().extractChannel(0), WORK, WORK);   // height (0..255)
const Gc = await rawGray(fieldFull.clone().extractChannel(1), WORK, WORK);   // bathy proxy (0..255)

const NPX = WORK * WORK;
const Hm = new Float32Array(NPX);     // height in metres
const Bn = new Float32Array(NPX);     // bathy proxy 0..1
for (let i = 0; i < NPX; i++) {
  Hm[i] = H_LO + (Rc[i] / 255) * (H_HI - H_LO);
  Bn[i] = Gc[i] / 255;
}

// ---- 0. erase small land-like islets sitting in open water, BEFORE the terrain surface is
// built. These are misclassifications inherited from field-v2 (a boat glint reading as "land"
// mid-scene, most likely) — connected-component label anything land-like, and erase any
// component that (a) does not touch the frame edge and (b) is smaller than ISLET_MAX_DIM. Real
// land always fails at least one of those (either it reaches the crop boundary, or it is far
// bigger than a ~30 output-px blob), so this cannot eat real coastline or real small islands
// the size of, say, Panepane Point. ------------------------------------------------------------
{
  const elevated = new Uint8Array(NPX);
  for (let i = 0; i < NPX; i++) elevated[i] = ((Hm[i] - H_LO) / (H_HI - H_LO)) > ISLET_HN_THRESH ? 1 : 0;
  const visited = new Uint8Array(NPX);
  const stack = new Int32Array(NPX);
  const members = new Int32Array(NPX);
  const influenceMask = new Float32Array(NPX);  // erased footprint DILATED by the chamfer influence radius (excluded from the heal average, and the region the heal fill gets blended into)
  const blobList = [];
  let erasedPx = 0;
  for (let start = 0; start < NPX; start++) {
    if (!elevated[start] || visited[start]) continue;
    let sp = 0, mp = 0;
    stack[sp++] = start; visited[start] = 1;
    let minX = WORK, maxX = 0, minY = WORK, maxY = 0, touchesBorder = false;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % WORK, y = (idx / WORK) | 0;
      members[mp++] = idx;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === WORK - 1 || y === WORK - 1) touchesBorder = true;
      if (x > 0) { const j = idx - 1; if (elevated[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      if (x < WORK - 1) { const j = idx + 1; if (elevated[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      if (y > 0) { const j = idx - WORK; if (elevated[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      if (y < WORK - 1) { const j = idx + WORK; if (elevated[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
    }
    const dim = Math.max(maxX - minX + 1, maxY - minY + 1);
    if (!touchesBorder && dim <= ISLET_MAX_DIM) {
      for (let k = 0; k < mp; k++) Hm[members[k]] = H_LO;   // erase to water sentinel
      blobList.push({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r: dim / 2 });
      erasedPx += mp;
    }
  }
  // Erasing height alone is not enough: the bathy proxy (G channel) was chamfer-distanced FROM
  // this same blob upstream in prep-field.mjs (it counted as "land" there too), so EVERY water
  // pixel within the chamfer's ~3.4km reach of it is also depressed — not just the blob's own
  // footprint. Exclude that whole disc from the healing average (contaminated data cannot heal
  // itself), fill from a ring beyond it, and blend the fill back in over that same disc so the
  // WHOLE depression is flattened, not just the seed pixel.
  if (blobList.length > 0) {
    const influenceWork = Math.max(2, ISLET_INFLUENCE_OUT * R);
    const healSigma = Math.max(4, ISLET_HEAL_SIGMA_OUT * R);
    for (const b of blobList) {
      const rad = b.r + influenceWork;
      const x0 = Math.max(0, Math.floor(b.cx - rad)), x1 = Math.min(WORK - 1, Math.ceil(b.cx + rad));
      const y0 = Math.max(0, Math.floor(b.cy - rad)), y1 = Math.min(WORK - 1, Math.ceil(b.cy + rad));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - b.cx, dy = y - b.cy;
        if (dx * dx + dy * dy <= rad * rad) influenceMask[y * WORK + x] = 1;
      }
    }
    const validMask = new Float32Array(NPX);
    const bnValid = new Float32Array(NPX);
    // Land is excluded from the fill average too — a wide heal sigma would otherwise drag in
    // nearby land's automatically-zero bathy and pull the fill down, backwards for a blob
    // sitting in open water far from any real shore.
    for (let i = 0; i < NPX; i++) { const v = (influenceMask[i] > 0 || Hm[i] >= LAND_H[0]) ? 0 : 1; validMask[i] = v; bnValid[i] = v * Bn[i]; }
    const num = gaussBlur(bnValid, WORK, WORK, healSigma);
    const den = gaussBlur(validMask, WORK, WORK, healSigma);
    const softMask = gaussBlur(influenceMask, WORK, WORK, Math.max(2, influenceWork * 0.25));
    for (let i = 0; i < NPX; i++) {
      if (softMask[i] <= 1e-3) continue;
      const fill = den[i] > 1e-3 ? num[i] / den[i] : Bn[i];
      const w = Math.max(0, Math.min(1, softMask[i]));
      Bn[i] = Bn[i] * (1 - w) + fill * w;
    }
  }
  console.log(`islet erase: ${blobList.length} blob(s) erased, ${erasedPx} work-px (max dim <= ${ISLET_MAX_DIM} work-px, seed Hn>${ISLET_HN_THRESH}); bathy proxy inpainted over the ~${ISLET_INFLUENCE_OUT}px-radius chamfer shadow around each`);
}

// ---- 1. combined terrain surface: land raised, sea floor carved as valleys ----------------
// Hn = 0 in water (flat, no info there) rising to 1 on land; Bn = 0 on land/flats (flat, no
// info there) rising into deep water. Complementary supports, so summing is a real surface:
// land is high ground, channels are the deepest valleys, exactly the "height/bathy surface"
// the job spec asks the gradient of. Kept as float throughout (round 1 quantised this to 8 bits
// for sharp; no longer necessary now smoothing is our own).
const phi = new Float32Array(NPX);
for (let i = 0; i < NPX; i++) {
  const Hn = (Hm[i] - H_LO) / (H_HI - H_LO);
  phi[i] = Hn - Bn[i];                                        // -1..1
}

// ---- 2. gradient pyramid (seamless gaussBlur at each scale) -------------------------------
function gradients(buf) {
  const gx = new Float32Array(NPX), gy = new Float32Array(NPX);
  for (let y = 0; y < WORK; y++) {
    const y0 = y > 0 ? y - 1 : 0, y1 = y < WORK - 1 ? y + 1 : WORK - 1;
    const rowY0 = y0 * WORK, rowY1 = y1 * WORK, row = y * WORK;
    for (let x = 0; x < WORK; x++) {
      const x0 = x > 0 ? x - 1 : 0, x1 = x < WORK - 1 ? x + 1 : WORK - 1;
      gx[row + x] = (buf[row + x1] - buf[row + x0]) / 2;
      gy[row + x] = (buf[rowY1 + x] - buf[rowY0 + x]) / 2;
    }
  }
  return { gx, gy };
}

const levels = [];
for (const sigma of SIGMAS) {
  const b = gaussBlur(phi, WORK, WORK, sigma);
  levels.push({ sigma, ...gradients(b) });
  console.log(`  level sigma=${sigma.toFixed(1)} blurred+gradient done`);
}

// ---- 3. blend levels fine->coarse by confidence, sign via coarsest (regional "seaward") ---
// The blend weight is already a continuous smoothstep of a per-pixel score (no discrete level
// switch), so once the underlying blur is seamless this is too.
const tanX = new Float32Array(NPX), tanY = new Float32Array(NPX);
{
  const last = levels[levels.length - 1];
  for (let i = 0; i < NPX; i++) {
    let ax = 0, ay = 0, remaining = 1;
    for (let li = 0; li < levels.length; li++) {
      const lev = levels[li];
      const gx = lev.gx[i], gy = lev.gy[i];
      const score = Math.sqrt(gx * gx + gy * gy) * lev.sigma;
      const t = Math.max(0, Math.min(1, (score - SCORE_LO) / (SCORE_HI - SCORE_LO)));
      const w = t * t * (3 - 2 * t);           // smoothstep confidence
      if (li === levels.length - 1) { ax += remaining * gx; ay += remaining * gy; remaining = 0; break; }
      const take = remaining * w;
      ax += take * gx; ay += take * gy;
      remaining -= take;
    }
    // unsigned axis: rotate the combined across-channel gradient 90 degrees
    let tx = -ay, ty = ax;
    const tmag = Math.hypot(tx, ty);
    if (tmag > 1e-6) { tx /= tmag; ty /= tmag; } else { tx = 1; ty = 0; }

    // seaward reference: decreasing height / increasing bathy, at the coarsest (regional) scale
    let sx = -last.gx[i], sy = -last.gy[i];
    const smag = Math.hypot(sx, sy);
    if (smag > 1e-6) { sx /= smag; sy /= smag; }

    if (tx * sx + ty * sy < 0) { tx = -tx; ty = -ty; }
    tanX[i] = tx; tanY[i] = ty;
  }
}
console.log('tangent field built');

// ---- 3b. channel-likeliness (for amplitude weighting) and loop-curvature (for vortex damping)
// Curvature of the terrain surface: |laplacian(phi smoothed at a creek/channel scale)|. High at
// channel cores and drainage-creek cuts (real morphology), near zero on a featureless flat.
// Percentile-normalised (subsampled) rather than a fixed constant, since phi's absolute scale is
// arbitrary. -----------------------------------------------------------------------------------
const phiCurve = gaussBlur(phi, WORK, WORK, CURVE_SIGMA);
const curvature = new Float32Array(NPX);
for (let y = 0; y < WORK; y++) {
  const y0 = y > 0 ? y - 1 : 0, y1 = y < WORK - 1 ? y + 1 : WORK - 1, row = y * WORK;
  for (let x = 0; x < WORK; x++) {
    const x0 = x > 0 ? x - 1 : 0, x1 = x < WORK - 1 ? x + 1 : WORK - 1;
    const lap = phiCurve[row + x1] + phiCurve[row + x0] + phiCurve[y1 * WORK + x] + phiCurve[y0 * WORK + x] - 4 * phiCurve[row + x];
    curvature[row + x] = Math.abs(lap);
  }
}
// percentile via a subsample (every 6th px, over water only) — fast, no full sort needed
{
  const sample = [];
  for (let i = 0; i < NPX; i += 6) if (Hm[i] < LAND_H[0]) sample.push(curvature[i]);
  sample.sort((a, b) => a - b);
  var CURVE_P85 = sample[Math.floor(sample.length * 0.85)] || 1e-6;
}
const channelLikeliness = new Float32Array(NPX);
const csmooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < NPX; i++) channelLikeliness[i] = csmooth(0, CURVE_P85 * 1.15, curvature[i]);
console.log(`channel-likeliness: curvature P85(subsample, water)=${CURVE_P85.toExponential(3)}`);

console.log('channel-likeliness built');

// ---- 3c. critical-point (vortex) detection, by winding number ----------------------------
// Two things were tried and discarded before this: (1) pointwise curl — LIC integrates L_OUT px
// each way, so a pixel well outside a "tight" loop still rings, because the artifact is not
// really about tightness at all; (2) net rotation accumulated along each pixel's own streamline
// — measured near zero even ON a visible ring, because a short arc of a wide circle is nearly
// straight (chord/arc length ratio close to 1) even though it is still part of a circular flow.
// The actual mechanism: LIC bands into rings wherever the flow is close to circular over an area
// bigger than the integration length, because neighbouring streamlines at the same radius are
// nearly identical (they are all tracing close to the same circle) while streamlines at a
// different radius sample different noise — i.e. it is a property of the FIELD near a critical
// point, not of any one streamline. So: find critical points directly, the standard way (the
// discrete winding number of the tangent direction around a small loop — non-zero only within
// about one grid cell of a true singularity of the combined gradient field), then blank out a
// disc around each one sized to the LIC length, since that is how far a critical point's
// influence reaches in the rendered output regardless of how gently it turns.
const VORTEX_LOOP_WORK = Math.max(2, L * 0.6);
const VORTEX_SAMPLES = 8;
const vortexSeed = new Float32Array(NPX);
{
  const ang = new Float32Array(VORTEX_SAMPLES);
  const vd = [0, 0];
  for (let y = 0; y < WORK; y += 2) {
    for (let x = 0; x < WORK; x += 2) {
      for (let s = 0; s < VORTEX_SAMPLES; s++) {
        const theta = (s / VORTEX_SAMPLES) * 2 * Math.PI;
        sampleTangent(x + VORTEX_LOOP_WORK * Math.cos(theta), y + VORTEX_LOOP_WORK * Math.sin(theta), vd);
        ang[s] = Math.atan2(vd[1], vd[0]);
      }
      let wind = 0;
      for (let s = 0; s < VORTEX_SAMPLES; s++) {
        let d = ang[(s + 1) % VORTEX_SAMPLES] - ang[s];
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        wind += d;
      }
      if (Math.abs(wind) > Math.PI) {
        vortexSeed[y * WORK + x] = 1;
        if (x + 1 < WORK) vortexSeed[y * WORK + x + 1] = 1;
        if (y + 1 < WORK) vortexSeed[(y + 1) * WORK + x] = 1;
      }
    }
  }
}
// Blow each detected point up into a disc sized to how far LIC actually renders a critical
// point's influence (empirically several times L_OUT — this is what round 2's first two attempts
// underestimated), feathered so there is no hard edge.
const VORTEX_DISC_OUT = 5 * L_OUT;
const vortexDisc = gaussBlur(vortexSeed, WORK, WORK, VORTEX_DISC_OUT * R * 0.5);
const vortexMask = new Float32Array(NPX);
let vortexPx = 0;
for (let i = 0; i < NPX; i++) { vortexMask[i] = Math.min(1, vortexDisc[i] * 40); if (vortexSeed[i] > 0) vortexPx++; }
console.log(`vortex detection: ${vortexPx} seed px (winding test, loop radius ${VORTEX_LOOP_WORK.toFixed(1)} work-px), blown up to ~${VORTEX_DISC_OUT}px-radius discs`);

// ---- 4. noise + LIC with a shared streamline (phase A / phase B from one path) ------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260727);
const noiseRaw = new Float32Array(NPX);
for (let i = 0; i < NPX; i++) noiseRaw[i] = rnd();
// A touch of correlation length on the seed noise: pure 1-px white noise makes LIC streaks
// exactly 1 work-px wide, which then aliases (moire) when the texture is upsampled to OUT.
// This is the "slightly blue" noise from the spec, applied as a small pre-blur instead of an
// actual blue-noise generator — same effect (kills the single-pixel frequency), far cheaper.
const noise = gaussBlur(noiseRaw, WORK, WORK, NOISE_SIGMA);

function sampleBilinear(buf, x, y) {
  const cx = Math.max(0, Math.min(WORK - 1.001, x)), cy = Math.max(0, Math.min(WORK - 1.001, y));
  const x0 = cx | 0, y0 = cy | 0, fx = cx - x0, fy = cy - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  const o00 = y0 * WORK + x0, o10 = y0 * WORK + x1, o01 = y1 * WORK + x0, o11 = y1 * WORK + x1;
  return (buf[o00] * (1 - fx) + buf[o10] * fx) * (1 - fy) + (buf[o01] * (1 - fx) + buf[o11] * fx) * fy;
}
function sampleTangent(x, y, out) {
  const cx = Math.max(0, Math.min(WORK - 1.001, x)), cy = Math.max(0, Math.min(WORK - 1.001, y));
  const x0 = cx | 0, y0 = cy | 0, fx = cx - x0, fy = cy - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  const o00 = y0 * WORK + x0, o10 = y0 * WORK + x1, o01 = y1 * WORK + x0, o11 = y1 * WORK + x1;
  let tx = (tanX[o00] * (1 - fx) + tanX[o10] * fx) * (1 - fy) + (tanX[o01] * (1 - fx) + tanX[o11] * fx) * fy;
  let ty = (tanY[o00] * (1 - fx) + tanY[o10] * fx) * (1 - fy) + (tanY[o01] * (1 - fx) + tanY[o11] * fx) * fy;
  const m = Math.hypot(tx, ty);
  if (m > 1e-6) { tx /= m; ty /= m; }
  out[0] = tx; out[1] = ty;
}

const HALF = L + SHIFT;                 // steps each direction
const licA = new Float32Array(NPX), licB = new Float32Array(NPX);
const d1 = [0, 0], d2 = [0, 0];
const vals = new Float32Array(2 * HALF + 1);
const t0 = Date.now();
for (let y = 0; y < WORK; y++) {
  for (let x = 0; x < WORK; x++) {
    const i = y * WORK + x;
    vals[HALF] = noise[i];
    // forward (seaward, +tangent)
    let px = x, py = y;
    for (let k = 1; k <= HALF; k++) {
      sampleTangent(px, py, d1);
      const mx = px + d1[0] * 0.5, my = py + d1[1] * 0.5;
      sampleTangent(mx, my, d2);
      px += d2[0]; py += d2[1];
      vals[HALF + k] = sampleBilinear(noise, px, py);
    }
    // backward (landward, -tangent)
    px = x; py = y;
    for (let k = 1; k <= HALF; k++) {
      sampleTangent(px, py, d1);
      const mx = px - d1[0] * 0.5, my = py - d1[1] * 0.5;
      sampleTangent(mx, my, d2);
      px -= d2[0]; py -= d2[1];
      vals[HALF - k] = sampleBilinear(noise, px, py);
    }
    let sumA = 0, sumB = 0;
    for (let k = 0; k <= 2 * L; k++) { sumA += vals[SHIFT + k]; sumB += vals[2 * SHIFT + k]; }
    licA[i] = sumA / (2 * L + 1);
    licB[i] = sumB / (2 * L + 1);
  }
  if (y % 256 === 0) console.log(`  LIC row ${y}/${WORK} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
}
console.log(`LIC done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (process.env.DEBUG_DUMP) {
  const dump = async (arr, name) => {
    const buf = Buffer.alloc(NPX);
    for (let i = 0; i < NPX; i++) buf[i] = Math.round(Math.max(0, Math.min(1, arr[i])) * 255);
    await sharp(buf, { raw: { width: WORK, height: WORK, channels: 1 } }).toColourspace('b-w').png().toFile(`data/_debug_${name}.png`);
  };
  await dump(channelLikeliness, 'channelLikeliness');
  await dump(vortexSeed, 'vortexSeed');
  await dump(vortexMask, 'vortexMask');
  const licAraw = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) licAraw[i] = licA[i];
  await dump(licAraw, 'licA_raw');
  console.log('debug dumps written');
}

// ---- 5. local contrast normalisation — seamless gaussBlur, float throughout, no 8-bit
// quantisation anywhere in the stats. Filaments pop everywhere, not just where the raw LIC mean
// happened to sit mid-range. --------------------------------------------------------------
function localNormalise(arr) {
  const mean = gaussBlur(arr, WORK, WORK, LOCAL_SIGMA);
  const sq = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) sq[i] = arr[i] * arr[i];
  const meanSq = gaussBlur(sq, WORK, WORK, LOCAL_SIGMA);
  const out = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) {
    const m = mean[i], m2 = meanSq[i];
    const std = Math.sqrt(Math.max(0, m2 - m * m));
    const lo = m - CONTRAST_K * std, hi = m + CONTRAST_K * std;
    const v = (arr[i] - lo) / Math.max(hi - lo, 1e-3);
    out[i] = Math.max(0, Math.min(1, v));
  }
  return out;
}
const licAn = localNormalise(licA);
const licBn = localNormalise(licB);
console.log('local contrast normalisation done');

// A critical point's rings are a SHAPE (concentric contours), not just brightness — dimming a
// contrast-normalised ring uniformly still leaves a dim, perfectly visible ring, because the
// *relative* contrast between ring and gap survives the multiply. Inside a detected vortex's
// disc, blend the contrast-normalised value toward neutral (0.5, "no pattern here") instead of
// scaling it down — that erases the ring shape itself, leaving the pixel looking like the same
// quiet, featureless water as its surroundings, which is what it would have looked like had the
// critical point not been there.
for (let i = 0; i < NPX; i++) {
  const w = 1 - vortexMask[i];
  licAn[i] = licAn[i] * w + 0.5 * (1 - w);
  licBn[i] = licBn[i] * w + 0.5 * (1 - w);
}

// ---- 6. final amplitude: land/ocean gate * channel-likeliness contrast --------------------
// This is the layer that turns "whole flat lit at one brightness" into "bright braided filament
// in the channel, quiet in between": landFactor/oceanFactor gate WHERE water is allowed to show
// at all, channelLikeliness controls HOW BRIGHT within that (strong core, floor on plain flat).
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const weight = new Float32Array(NPX);
for (let i = 0; i < NPX; i++) {
  const h = Hm[i], b = Bn[i];
  const landFactor = 1 - smoothstep(LAND_H[0], LAND_H[1], h);
  const oceanFactor = 1 - smoothstep(OCEAN_BATHY[0], OCEAN_BATHY[1], b);
  const gate = landFactor * (FAR_FLOOR + (1 - FAR_FLOOR) * oceanFactor);
  const amplitude = FEATURELESS_FLOOR + (1 - FEATURELESS_FLOOR) * channelLikeliness[i];
  weight[i] = gate * amplitude;
}
for (let i = 0; i < NPX; i++) { licAn[i] *= weight[i]; licBn[i] *= weight[i]; }
console.log('amplitude weighting applied');

// ---- histogram check: over water, no more than ~35% of pixels should sit above half amplitude
{
  let water = 0, above = 0;
  for (let i = 0; i < NPX; i++) {
    if (Hm[i] >= LAND_H[0]) continue;
    water++;
    if (licAn[i] > 0.5) above++;
  }
  console.log(`histogram check: ${(100 * above / water).toFixed(1)}% of water px above half amplitude (target <= 35%)`);
}

// ---- 7. pack + upsample to OUT ----------------------------------------------------------
const aBuf = Buffer.alloc(NPX), bBuf = Buffer.alloc(NPX);
const txBuf = Buffer.alloc(NPX), tyBuf = Buffer.alloc(NPX);
for (let i = 0; i < NPX; i++) {
  aBuf[i] = Math.round(Math.max(0, Math.min(1, licAn[i])) * 255);
  bBuf[i] = Math.round(Math.max(0, Math.min(1, licBn[i])) * 255);
  txBuf[i] = Math.round((tanX[i] * 0.5 + 0.5) * 255);
  tyBuf[i] = Math.round((tanY[i] * 0.5 + 0.5) * 255);
}
async function up(buf) {
  return rawGray(sharp(buf, { raw: { width: WORK, height: WORK, channels: 1 } }).toColourspace('b-w').resize(OUT, OUT, { kernel: 'mitchell' }), OUT, OUT);
}
const aUp = await up(aBuf), bUp = await up(bBuf), txUp = await up(txBuf), tyUp = await up(tyBuf);

const NOUT = OUT * OUT;
const packed = Buffer.alloc(NOUT * 3);
for (let i = 0; i < NOUT; i++) {
  const tx = txUp[i] / 255 * 2 - 1, ty = tyUp[i] / 255 * 2 - 1;
  let ang = Math.atan2(ty, tx);
  if (ang < 0) ang += 2 * Math.PI;
  packed[i * 3] = aUp[i];
  packed[i * 3 + 1] = bUp[i];
  packed[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(ang / (2 * Math.PI) * 255)));
}
await sharp(packed, { raw: { width: OUT, height: OUT, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile('data/flow.png');

fs.writeFileSync('data/flow.json', JSON.stringify({
  description: 'LIC flow texture for the channel-swirl look. R = LIC phase A, G = LIC phase B (same streamline, sampled ' + SHIFT_OUT + 'px further seaward), B = flow angle (radians/2pi*255), tangent points SEAWARD (toward decreasing height / increasing bathy).',
  size: OUT, workSize: WORK,
  method: {
    terrainSurface: 'phi = heightNorm(0..1, water=0..land=1) - bathyProxy(0..1, land=0..deepSea=1); land raised, channels carved as valleys',
    islandErase: { maxDimOutputPx: ISLET_MAX_DIM_OUT, seedHeightNormThreshold: ISLET_HN_THRESH, note: 'connected-component land-like blobs not touching the crop border and smaller than maxDim are erased to water before the terrain surface is used, to kill misclassified-vessel islets' },
    smoothing: 'hand-rolled 3-pass box-approximated Gaussian (gaussBlur), not sharp .blur() — sharp seamed at the large sigmas this script needs',
    gradientPyramid: { sigmasOutputPx: SIGMAS_OUT, scoreFormula: '|grad(blur(phi,sigma))| * sigma', confidenceBand: [SCORE_LO, SCORE_HI], blend: 'fine-to-coarse alpha composite by confidence, coarsest level always used as fallback' },
    tangent: 'axis = perp(blendedGradient); sign flipped to align with -grad(coarsestLevel) (regional seaward reference)',
    lic: { halfLengthOutputPx: L_OUT, stepping: 'RK2 (midpoint), 1 work-px step', noise: 'white noise, seeded (mulberry32, seed 20260727), pre-blurred sigma=' + NOISE_SIGMA + ' work-px so streaks survive the upsample without moire' },
    twoPhase: 'ONE streamline of length 2*(L+SHIFT)+1 samples per pixel; phase A = window centred on the seed pixel, phase B = the SAME window shifted ' + SHIFT_OUT + 'px seaward along that streamline. Phase-coherent by construction.',
    contrastNormalisation: { localSigmaOutputPx: LOCAL_SIGMA_OUT, k: CONTRAST_K, note: 'stretch [localMean-k*std, localMean+k*std] to [0,1] per pixel, before amplitude weighting; float throughout (no 8-bit quantisation of the stats)' },
    amplitudeWeighting: { curveSigmaOutputPx: CURVE_SIGMA_OUT, featurelessFloor: FEATURELESS_FLOOR, note: 'weight = landGate * oceanGate(bathy) * mix(featurelessFloor, 1, channelLikeliness); channelLikeliness = percentile-normalised |laplacian(phi)|, strong at channel cores and drainage creeks, near zero on featureless flat' },
    vortexSuppression: { loopRadiusWorkPxAtBuildRes: VORTEX_LOOP_WORK, discRadiusOutputPx: VORTEX_DISC_OUT, note: 'discrete winding number of the tangent direction around an 8-point loop finds true critical points of the combined gradient field (the ONLY thing that reliably predicts an LIC ring — tried and discarded first: pointwise curl, then net rotation accumulated along each streamline, neither matched where rings actually appeared). Each detected point is blown up into a ~5*L_OUT-radius soft disc; inside it, both LIC phases are blended toward neutral grey (not just dimmed) so the ring SHAPE disappears, not just its brightness.' },
    oceanGate: { landFadeMetres: LAND_H, oceanBathyBand: OCEAN_BATHY, farOffshoreFloor: FAR_FLOOR, note: 'drying height cannot distinguish real channel from open sea (both sit at the water sentinel); the fade is driven by the bathy proxy alone, height only gates dry land off' },
  },
}, null, 2));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`data/flow.png ${kb('data/flow.png')} at ${OUT}px`);
