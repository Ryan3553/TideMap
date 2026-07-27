// The artery flow texture — round 4, Ryan's spec, on real bathymetry.
//
// Ryan rejected the LIC braid ("overlapping brush strokes, like a badly painted picture")
// and marked up what he wants (research/overnight-2026-07-27/flow/Ryan-markup.png): LONG,
// SPARSE, artery-like streamlines along each channel's DEEPEST line — one continuous spine
// per channel, the mouth artery branching into the arms like the drainage tree it is,
// strong in the thalweg, fading at channel edges, near-zero on flats and open ocean.
//
// This rebuild reads REAL depth (data/depth-composite-raw.f32 — coastal LiDAR 2m > chart
// contours+soundings > NIWA 25m; see build-depth-composite.py) instead of the chamfer
// proxy, and replaces per-pixel LIC with explicit streamlines:
//
//   direction  channel AXIS from the structure tensor of the smoothed depth (the minor
//              eigenvector — well-defined ON the spine, where the raw gradient vanishes),
//              blended across three scales (creeks / secondary / main channel), signed
//              seaward against a coarse reference exactly like round 2-3.
//   amplitude  rel = depth / localMax(depth, ~40 output-px), pow-shaped, times a gentle
//              absolute-depth ramp (so dredged channel > secondary > creeks), times an
//              anisotropy gate (flats and featureless ocean have no valley axis -> 0),
//              times the round-2 land fade and chamfer-proxy ocean fade.
//   seeds      sparse (Poisson-disc dart throwing, radius shrinking with amplitude, so
//              spines seed densest), integrated LONG (L=150 output-px each way, RK2,
//              1 work-px steps, direction continuity along the path — the seaward sign
//              only picks the initial orientation and the stored angle).
//   phases     each streamline is splatted twice with a low-frequency along-arc pulse
//              pattern: phase A at arc s, phase B at arc s-SHIFT — the SAME contract as
//              the LIC rounds (B is the pattern slid seaward), so template-v2.html and
//              look.mjs need no change at all: R=A, G=B, B=seaward angle.
//
// Kept from round 2-3, per the queue: the vessel-islet erase on the height field, the
// winding-number critical-point detector (an axis field still orbits closed basins; seeds
// and amplitude are damped inside each disc), hand-rolled seamless gaussBlur only (sharp's
// blur seams at large sigma), Float32 end to end.
import fs from 'fs';
import sharp from 'sharp';

const OUT = Number(process.argv[2] ?? 4096);
const WORK = Number(process.argv[3] ?? 2048);
const R = WORK / OUT;
const H_LO = -0.75, H_HI = 3.25;                     // field height encoding, metres

// ---- constants (output-px units unless noted) ---------------------------------------------
const AXIS_SIGMAS_OUT = [5, 16, 40];                 // depth smoothing per axis scale
const AXIS_CONF = [0.35, 0.65];                      // anisotropy band for scale confidence
const SEAWARD_SIGMA_OUT = 256;                       // coarse seaward-reference smoothing
const LOCALMAX_R_OUT = 40;                           // rel = depth/localMax window (spec)
const REL_POW = 3.0;                                 // spine-vs-edge shaping
const DEPTH_RAMP = [0.6, 5.0];                       // metres: fade creeks in
const DEEP_BOOST = [5.0, 14.0];                      // metres: dredged channel on top
const DEEP_BOOST_MIX = 0.45;
const ANISO_GATE = [0.18, 0.45];                     // valley-axis confidence gate
const LAP_FINE_OUT = 10;                             // ridge test, creek scale
const LAP_BROAD_OUT = 26;                            // ridge test, whole-trench scale (a
                                                     // dredged channel's spine is FLAT — only
                                                     // the broad scale sees it as a ridge)
const LAP_WIDE_OUT = 56;                             // ridge test, widest-channel scale: the
                                                     // Western Channel is ~700m across and its
                                                     // flat middle only reads as a ridge here
const SHOAL_D = 6;                                   // metres: offshore shoal/reef definition
const SHOAL_SKIRT_OUT = 120;                         // px: suppression skirt around one (must
                                                     // reach past the orbit annulus)
const OCEAN_TRENCH_D = [6, 10];                      // metres: open-ocean arteries only in a
                                                     // deep broad trench (the approach channel)
const LAND_H = [2.0, 2.4];                           // metres, land fade (round-2 value)
const OCEAN_BATHY = [0.20, 0.45];                    // chamfer-proxy ocean fade (round-2)
const FAR_FLOOR = 0.0;                               // arteries do NOT persist far offshore
const L_OUT = 150;                                   // streamline half-length (spec 100-200)
const SHIFT_OUT = 14;                                // phase-B seaward slide
const PULSE_L1_OUT = 92, PULSE_L2_OUT = 53;          // along-arc pulse wavelengths
const PULSE_DEPTH = 0.42;                            // 1-this = steady core brightness
const END_FADE = 0.18;                               // fraction of each end faded out
const SEED_R_OUT = [38, 9];                          // Poisson radius at amp 0 -> 1
const SEED_TRIES = 900000;                           // dart throws
const SEED_AMP_MIN = 0.06;                           // no seeds below this amplitude
const SPLAT_SIGMA_WORK = 1.5;                        // post-splat blur (streak width — arteries
                                                     // are bold strokes, not hairlines)
const ACC_K = 2.4;                                   // soft-clamp: v = 1-exp(-k*acc)
const ISLET_MAX_DIM_OUT = 50;                        // vessel-islet erase (round-2 values)
const ISLET_HN_THRESH = 0.85;
const VORTEX_DISC_OUT = 170;                         // critical-point damp disc radius (must
                                                     // cover a reef's whole orbit annulus)

const L = Math.round(L_OUT * R), SHIFT = Math.round(SHIFT_OUT * R);
const NPX = WORK * WORK;
console.log(`prep-flow(arteries): OUT=${OUT} WORK=${WORK} L=${L} SHIFT=${SHIFT}`);

// ============================================================================================
// seamless box-approximated gaussian (verbatim from round 2 — no tiling, cannot seam)
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
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ============================================================================================
// inputs, Float32 from the source data (no 8-bit round trips)
// ============================================================================================
// depth: composite elevation f32 at 4096 -> block-average to WORK, positive-down metres
{
  var D = new Float32Array(NPX);
  const buf = fs.readFileSync('data/depth-composite-raw.f32');
  const elev = new Float32Array(buf.buffer, buf.byteOffset, 4096 * 4096);
  const S = 4096 / WORK;
  for (let y = 0; y < WORK; y++) for (let x = 0; x < WORK; x++) {
    let acc = 0;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++)
      acc += elev[(y * S + dy) * 4096 + (x * S + dx)];
    const e = acc / (S * S);
    D[y * WORK + x] = e < 0 ? -e : 0;
  }
}
// height: field-v3 16-bit R/A decode at 4096 -> block-average to WORK, metres
{
  var Hm = new Float32Array(NPX);
  const rt = await sharp('data/field-v3.png').raw().toBuffer();
  if (rt.length !== 4096 * 4096 * 4) throw new Error('field-v3.png is not 4096x4096 RGBA');
  const S = 4096 / WORK;
  for (let y = 0; y < WORK; y++) for (let x = 0; x < WORK; x++) {
    let acc = 0;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const i = ((y * S + dy) * 4096 + (x * S + dx)) * 4;
      acc += (rt[i] << 8) | rt[i + 3];
    }
    Hm[y * WORK + x] = H_LO + (acc / (S * S) / 65535) * (H_HI - H_LO);
  }
}
// chamfer proxy (ocean fade): field-v2 G at 4096 -> block-average to WORK, 0..1
{
  var Chamfer = new Float32Array(NPX);
  const g = await sharp('data/field-v2.png').extractChannel(1).raw().toBuffer();
  if (g.length !== 4096 * 4096) throw new Error('field-v2.png G channel is not 4096x4096');
  const S = 4096 / WORK;
  for (let y = 0; y < WORK; y++) for (let x = 0; x < WORK; x++) {
    let acc = 0;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++)
      acc += g[(y * S + dy) * 4096 + (x * S + dx)];
    Chamfer[y * WORK + x] = acc / (S * S) / 255;
  }
}
console.log('inputs loaded (depth composite, 16-bit height, chamfer proxy)');

// ---- vessel-islet erase on the height field (round-2 code, heal no longer needed: the
// depth is real now, so a misclassified boat only ever punched a fake land dot into the
// LAND GATE — erasing the blob from Hm is the whole fix) ------------------------------------
{
  const ISLET_MAX_DIM = Math.max(2, Math.round(ISLET_MAX_DIM_OUT * R));
  const elevated = new Uint8Array(NPX);
  for (let i = 0; i < NPX; i++) elevated[i] = ((Hm[i] - H_LO) / (H_HI - H_LO)) > ISLET_HN_THRESH ? 1 : 0;
  const visited = new Uint8Array(NPX);
  const stack = new Int32Array(NPX);
  const members = new Int32Array(NPX);
  let blobs = 0, erasedPx = 0;
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
      for (let k = 0; k < mp; k++) Hm[members[k]] = H_LO;
      blobs++; erasedPx += mp;
    }
  }
  console.log(`islet erase: ${blobs} blob(s), ${erasedPx} work-px`);
}

// ============================================================================================
// channel axis: structure tensor of smoothed depth, three scales, confidence-blended
// ============================================================================================
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

// axis per scale: minor eigenvector of T = blur(grad gradT); anisotropy = (l1-l2)/(l1+l2)
const scales = [];
for (const sOut of AXIS_SIGMAS_OUT) {
  const s = Math.max(1, sOut * R);
  const Ds = gaussBlur(D, WORK, WORK, s);
  const { gx, gy } = gradients(Ds);
  const xx = new Float32Array(NPX), yy = new Float32Array(NPX), xy = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) { xx[i] = gx[i] * gx[i]; yy[i] = gy[i] * gy[i]; xy[i] = gx[i] * gy[i]; }
  const rho = s * 2;
  const Txx = gaussBlur(xx, WORK, WORK, rho), Tyy = gaussBlur(yy, WORK, WORK, rho), Txy = gaussBlur(xy, WORK, WORK, rho);
  const ax = new Float32Array(NPX), ay = new Float32Array(NPX), an = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) {
    const a = Txx[i], b = Txy[i], c = Tyy[i];
    const tr = a + c, det = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
    const l1 = tr / 2 + det, l2 = tr / 2 - det;
    an[i] = l1 > 1e-12 ? (l1 - l2) / (l1 + l2) : 0;
    // minor eigenvector (along-channel): perpendicular to the major axis of T
    let ex, ey;
    if (Math.abs(b) > 1e-12) { ex = l1 - c; ey = b; } else if (a >= c) { ex = 1; ey = 0; } else { ex = 0; ey = 1; }
    // (ex,ey) is the MAJOR axis (across-channel); rotate 90 degrees
    let tx = -ey, ty = ex;
    const m = Math.hypot(tx, ty);
    if (m > 1e-12) { tx /= m; ty /= m; } else { tx = 1; ty = 0; }
    ax[i] = tx; ay[i] = ty;
  }
  scales.push({ ax, ay, an });
  console.log(`  axis scale sigma=${sOut}px: done`);
}

// coarse seaward reference: downhill on (heightNorm - depthNorm) at whole-harbour scale
let seawardX, seawardY;
{
  let dMax = 0;
  for (let i = 0; i < NPX; i++) if (D[i] > dMax) dMax = D[i];
  const phi = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) {
    const Hn = Math.max(0, Math.min(1, (Hm[i] - H_LO) / (H_HI - H_LO)));
    phi[i] = Hn - Math.min(1, D[i] / Math.min(30, dMax));
  }
  const coarse = gaussBlur(phi, WORK, WORK, SEAWARD_SIGMA_OUT * R);
  const { gx, gy } = gradients(coarse);
  seawardX = new Float32Array(NPX); seawardY = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) {
    let sx = -gx[i], sy = -gy[i];
    const m = Math.hypot(sx, sy);
    if (m > 1e-9) { sx /= m; sy /= m; }
    seawardX[i] = sx; seawardY[i] = sy;
  }
}

// blend scales fine-to-coarse by anisotropy confidence; sign axis seaward
const tanX = new Float32Array(NPX), tanY = new Float32Array(NPX), aniso = new Float32Array(NPX);
for (let i = 0; i < NPX; i++) {
  let ax = 0, ay = 0, remaining = 1, anAcc = 0;
  for (let s = 0; s < scales.length; s++) {
    const sc = scales[s];
    const w = s === scales.length - 1 ? remaining : remaining * smoothstep(AXIS_CONF[0], AXIS_CONF[1], sc.an[i]);
    // axis is a LINE field: align each scale's contribution with the running sum before adding
    let tx = sc.ax[i], ty = sc.ay[i];
    if (ax * tx + ay * ty < 0) { tx = -tx; ty = -ty; }
    ax += w * tx; ay += w * ty; anAcc += w * sc.an[i];
    remaining -= w;
    if (remaining <= 0) break;
  }
  const m = Math.hypot(ax, ay);
  if (m > 1e-9) { ax /= m; ay /= m; } else { ax = 1; ay = 0; }
  if (ax * seawardX[i] + ay * seawardY[i] < 0) { ax = -ax; ay = -ay; }
  tanX[i] = ax; tanY[i] = ay; aniso[i] = anAcc;
}
console.log('tangent field built (structure tensor, 3 scales, seaward-signed)');

// ============================================================================================
// amplitude: rel = D_s/localMax, pow-shaped, gated by aniso + land + ocean + depth ramp
// ============================================================================================
const Dch = gaussBlur(D, WORK, WORK, Math.max(1, AXIS_SIGMAS_OUT[1] * R * 0.5));
// localMax by separable max-filter (square window approximates the spec's disc)
function maxFilter(src, radius) {
  const tmp = new Float32Array(NPX), out = new Float32Array(NPX);
  for (let y = 0; y < WORK; y++) {
    const row = y * WORK;
    for (let x = 0; x < WORK; x++) {
      let m = 0;
      const x0 = Math.max(0, x - radius), x1 = Math.min(WORK - 1, x + radius);
      for (let xx = x0; xx <= x1; xx++) { const v = src[row + xx]; if (v > m) m = v; }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < WORK; x++) {
    for (let y = 0; y < WORK; y++) {
      let m = 0;
      const y0 = Math.max(0, y - radius), y1 = Math.min(WORK - 1, y + radius);
      for (let yy = y0; yy <= y1; yy++) { const v = tmp[yy * WORK + x]; if (v > m) m = v; }
      out[y * WORK + x] = m;
    }
  }
  return out;
}
const localMax = gaussBlur(maxFilter(Dch, Math.max(2, Math.round(LOCALMAX_R_OUT * R))), WORK, WORK, 3);
// ridge test, TWO scales: a channel spine is a ridge of depth (laplacian < 0), but a dredged
// channel's floor is flat — only a broad-scale laplacian (sigma >= half the trench width)
// sees the whole cross-section as one ridge. Creeks need the fine scale. A reef/shoal bump
// is a strong depth MINIMUM at the broad scale, so it fails hard — which is what stops the
// axis field's orbits around offshore islands from being painted (the ringed-island artifact
// Ryan already rejected in the swell round).
function ridgeGate(sigmaOut, band) {
  const Dl = gaussBlur(D, WORK, WORK, Math.max(1, sigmaOut * R));
  const lap = new Float32Array(NPX);
  for (let y = 0; y < WORK; y++) {
    const y0 = y > 0 ? y - 1 : 0, y1 = y < WORK - 1 ? y + 1 : WORK - 1, row = y * WORK;
    for (let x = 0; x < WORK; x++) {
      const x0 = x > 0 ? x - 1 : 0, x1 = x < WORK - 1 ? x + 1 : WORK - 1;
      lap[row + x] = -(Dl[row + x1] + Dl[row + x0] + Dl[y1 * WORK + x] + Dl[y0 * WORK + x] - 4 * Dl[row + x]);
    }
  }
  const sample = [];
  for (let i = 0; i < NPX; i += 6) if (Hm[i] < LAND_H[0] && lap[i] > 0) sample.push(lap[i]);
  sample.sort((a, b) => a - b);
  const P85 = sample[Math.floor(sample.length * 0.85)] || 1e-6;
  const g = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) g[i] = smoothstep(band[0], band[1], lap[i] / P85);
  console.log(`ridge gate sigma=${sigmaOut}px: P85 = ${P85.toExponential(3)}`);
  return g;
}
const gateFine = ridgeGate(LAP_FINE_OUT, [0.0, 0.55]);
const gateBroad = ridgeGate(LAP_BROAD_OUT, [0.0, 0.45]);
const gateWide = ridgeGate(LAP_WIDE_OUT, [0.0, 0.40]);
// offshore shoal/reef skirt: a shallow bump in open water is never a channel, and the axis
// field orbits it — suppress the bump AND its skirt outright (outside the harbour only)
var shoalSkirt;
{
  const shoal = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) shoal[i] = (Dch[i] < SHOAL_D && Hm[i] < LAND_H[1]) ? 1 : 0;
  shoalSkirt = gaussBlur(maxFilter(shoal, Math.max(2, Math.round(SHOAL_SKIRT_OUT * R))), WORK, WORK, 6);
}
// harbour membership: inside the harbour the ridge test alone decides; in open ocean only a
// DEEP broad trench qualifies (the dredged approach channel) — no surf-trough or reef-skirt
// arteries out there, per the markup (near-zero on open ocean). "Inside the harbour" is
// measured as proximity to intertidal FLATS: flats exist only in the harbour and every
// harbour channel is flanked by them. (data/harbour-mask.png was tried first and is the
// wrong signal — it is the intertidal FIT mask, and the entrance narrows and Town Reach,
// the most important arteries of all, sit outside it.)
var inHarbour, oceanReach;
{
  const flats = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) flats[i] = (Hm[i] > 0.0 && Hm[i] < 1.9) ? 1 : 0;
  // size-filter first: an offshore island's small beach ring must NOT count as harbour
  // flats — Karewa's ring made its whole neighbourhood "in harbour" and let its orbit ring
  // paint. Connected components spanning under ~750 m are dropped; every real flats system
  // is far larger. (Erosion was tried first and also destroyed the narrow flat fringes
  // flanking Town Reach, taking the most important arteries with it.)
  const MIN_SPAN = Math.max(8, Math.round(40 * (WORK / 2048)));
  const flatsBig = new Float32Array(NPX);
  {
    const visited = new Uint8Array(NPX);
    const stack = new Int32Array(NPX);
    const members = new Int32Array(NPX);
    for (let start = 0; start < NPX; start++) {
      if (!flats[start] || visited[start]) continue;
      let sp = 0, mp = 0;
      stack[sp++] = start; visited[start] = 1;
      let minX = WORK, maxX = 0, minY = WORK, maxY = 0;
      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % WORK, y = (idx / WORK) | 0;
        members[mp++] = idx;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0) { const j = idx - 1; if (flats[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
        if (x < WORK - 1) { const j = idx + 1; if (flats[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
        if (y > 0) { const j = idx - WORK; if (flats[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
        if (y < WORK - 1) { const j = idx + WORK; if (flats[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      }
      if (Math.max(maxX - minX + 1, maxY - minY + 1) >= MIN_SPAN)
        for (let k = 0; k < mp; k++) flatsBig[members[k]] = 1;
    }
  }
  const nearFlats = maxFilter(flatsBig, Math.max(4, Math.round(75 * (WORK / 2048))));  // ~1.4 km
  inHarbour = gaussBlur(nearFlats, WORK, WORK, 12);
  // graduated permission for OCEAN arteries: the dredged approach trench starts at the delta
  // (near flats) and may run a few km out; an isolated offshore island/reef never qualifies
  const reach = gaussBlur(nearFlats, WORK, WORK, 60);
  oceanReach = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) oceanReach[i] = smoothstep(0.02, 0.25, reach[i]);
}
const amp = new Float32Array(NPX);
for (let i = 0; i < NPX; i++) {
  const d = Dch[i];
  const rel = localMax[i] > 0.25 ? Math.max(0, Math.min(1, d / localMax[i])) : 0;
  const landFactor = 1 - smoothstep(LAND_H[0], LAND_H[1], Hm[i]);
  const oceanFactor = 1 - smoothstep(OCEAN_BATHY[0], OCEAN_BATHY[1], Chamfer[i]);
  const gate = landFactor * (FAR_FLOOR + (1 - FAR_FLOOR) * oceanFactor);
  const ramp = smoothstep(DEPTH_RAMP[0], DEPTH_RAMP[1], d);
  const boost = (1 - DEEP_BOOST_MIX) + DEEP_BOOST_MIX * smoothstep(DEEP_BOOST[0], DEEP_BOOST[1], d);
  const valley = smoothstep(ANISO_GATE[0], ANISO_GATE[1], aniso[i]);
  const ridgeIn = Math.max(gateFine[i], gateBroad[i], gateWide[i]);
  const ridgeOut = Math.max(gateBroad[i], gateWide[i])
                 * smoothstep(OCEAN_TRENCH_D[0], OCEAN_TRENCH_D[1], d)
                 * Math.max(smoothstep(7, 10, d), 1 - shoalSkirt[i])    // a deep trench cuts
                 * oceanReach[i];                                       // THROUGH the delta bar
  const ridge = ridgeIn * inHarbour[i] + ridgeOut * (1 - inHarbour[i]);
  amp[i] = Math.pow(rel, REL_POW) * ramp * boost * valley * gate * ridge;
}
console.log('amplitude field built');

// ============================================================================================
// critical points (winding number of the tangent field) -> damp discs
// ============================================================================================
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
// Line-field winding, computed mod pi so the seaward sign-flip seams cannot fake a critical
// point, and SIGNED: a CENTER (index +1/2, the axis orbits — reefs, closed basins) is what
// draws rings and gets damped; a SADDLE (index -1/2) is a channel JUNCTION — the mouth
// confluence in Ryan's markup is exactly one — and is left strictly alone.
const vortexSeed = new Float32Array(NPX);
{
  const LOOP = Math.max(2, L * 0.1);
  const SAMPLES = 8;
  const ORBIT_REACH = Math.max(4, Math.round(VORTEX_DISC_OUT * R * 0.7));
  // A critical point's own amp is often ~0 (a reef pit fails every gate) while its ORBITS —
  // what actually paints rings — sit a full radius away. So: test every pixel within orbit
  // reach of seedable amplitude, and keep only centers whose surrounding annulus can paint.
  // (Testing ALL wet pixels was tried and found 17k noise "centers" on featureless flats,
  // whose damp discs then blanketed real channels.)
  const seedable = new Float32Array(NPX);
  for (let i = 0; i < NPX; i++) seedable[i] = amp[i] > 0.04 ? 1 : 0;
  const near = maxFilter(seedable, ORBIT_REACH);
  const ang = new Float32Array(SAMPLES);
  const vd = [0, 0];
  let nC = 0, nS = 0, kept = 0;
  for (let y = 0; y < WORK; y += 2) {
    for (let x = 0; x < WORK; x += 2) {
      const i = y * WORK + x;
      if (Hm[i] >= LAND_H[1] || near[i] < 0.5) continue;
      for (let s = 0; s < SAMPLES; s++) {
        const theta = (s / SAMPLES) * 2 * Math.PI;
        sampleTangent(x + LOOP * Math.cos(theta), y + LOOP * Math.sin(theta), vd);
        let a = Math.atan2(vd[1], vd[0]);
        if (a < 0) a += Math.PI;                       // axis angle, mod pi: sign-flip seams
        if (a >= Math.PI) a -= Math.PI;                // cannot fake a critical point
        ang[s] = a;
      }
      let wind = 0;
      for (let s = 0; s < SAMPLES; s++) {
        let dd = ang[(s + 1) % SAMPLES] - ang[s];
        while (dd > Math.PI / 2) dd -= Math.PI;
        while (dd < -Math.PI / 2) dd += Math.PI;
        wind += dd;
      }
      if (wind > Math.PI / 2) {
        nC++;
        // Is the surrounding amp-carrying water actually ORBITING this point? A channel merely
        // passing nearby puts amp on the test rings too, but its axis runs along the channel,
        // not tangent to circles about the center — tangentiality is what separates a real
        // ring-painter (reef, closed basin) from a harmless noise center beside a channel.
        let n = 0, tangSum = 0;
        for (const rr of [15, 30, 45]) {
          for (let s = 0; s < 12; s++) {
            const th = s / 12 * 2 * Math.PI;
            const sx2 = x + rr * Math.cos(th), sy2 = y + rr * Math.sin(th);
            const ii = Math.max(0, Math.min(WORK - 1, Math.round(sy2))) * WORK
                     + Math.max(0, Math.min(WORK - 1, Math.round(sx2)));
            if (amp[ii] <= 0.04) continue;
            sampleTangent(sx2, sy2, vd);
            tangSum += Math.abs(vd[0] * -Math.sin(th) + vd[1] * Math.cos(th));
            n++;
          }
        }
        if (n >= 6 && tangSum / n > 0.75) { vortexSeed[i] = 1; kept++; }
      } else if (wind < -Math.PI / 2) nS++;
    }
  }
  console.log(`critical points: ${nC} centers (${kept} with paintable orbits, damped), ${nS} saddles (untouched)`);
}
const vortexDamp = gaussBlur(vortexSeed, WORK, WORK, VORTEX_DISC_OUT * R * 0.5);
for (let i = 0; i < NPX; i++) amp[i] *= Math.max(0, 1 - vortexDamp[i] * 30);

// ============================================================================================
// sparse seeds: amplitude-weighted Poisson-disc dart throwing
// ============================================================================================
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
const CELL = Math.max(2, Math.round(SEED_R_OUT[1] * R));
const GW = Math.ceil(WORK / CELL);
const gridHead = new Int32Array(GW * GW).fill(-1);
const seedX = [], seedY = [], seedNext = [];
function tooClose(x, y, r) {
  const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
  const reach = Math.ceil(r / CELL);
  for (let cy = Math.max(0, gy - reach); cy <= Math.min(GW - 1, gy + reach); cy++)
    for (let cx = Math.max(0, gx - reach); cx <= Math.min(GW - 1, gx + reach); cx++) {
      let p = gridHead[cy * GW + cx];
      while (p >= 0) {
        const dx = seedX[p] - x, dy = seedY[p] - y;
        if (dx * dx + dy * dy < r * r) return true;
        p = seedNext[p];
      }
    }
  return false;
}
for (let t = 0; t < SEED_TRIES; t++) {
  const x = rnd() * (WORK - 2) + 1, y = rnd() * (WORK - 2) + 1;
  const a = amp[(y | 0) * WORK + (x | 0)];
  if (a < SEED_AMP_MIN) continue;
  if (rnd() > Math.pow(a, 1.25)) continue;
  const r = (SEED_R_OUT[0] + (SEED_R_OUT[1] - SEED_R_OUT[0]) * Math.min(1, a * 1.6)) * R;
  if (tooClose(x, y, r)) continue;
  const id = seedX.length;
  seedX.push(x); seedY.push(y); seedNext.push(gridHead[((y / CELL) | 0) * GW + ((x / CELL) | 0)]);
  gridHead[((y / CELL) | 0) * GW + ((x / CELL) | 0)] = id;
}
console.log(`seeds: ${seedX.length}`);

// ============================================================================================
// integrate + splat both phases
// ============================================================================================
function sampleBilinear(buf, x, y) {
  const cx = Math.max(0, Math.min(WORK - 1.001, x)), cy = Math.max(0, Math.min(WORK - 1.001, y));
  const x0 = cx | 0, y0 = cy | 0, fx = cx - x0, fy = cy - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  return (buf[y0 * WORK + x0] * (1 - fx) + buf[y0 * WORK + x1] * fx) * (1 - fy)
       + (buf[y1 * WORK + x0] * (1 - fx) + buf[y1 * WORK + x1] * fx) * fy;
}
const accA = new Float32Array(NPX), accB = new Float32Array(NPX);
function splat(acc, x, y, v) {
  const x0 = x | 0, y0 = y | 0;
  if (x0 < 0 || y0 < 0 || x0 >= WORK - 1 || y0 >= WORK - 1) return;
  const fx = x - x0, fy = y - y0;
  acc[y0 * WORK + x0] += v * (1 - fx) * (1 - fy);
  acc[y0 * WORK + x0 + 1] += v * fx * (1 - fy);
  acc[(y0 + 1) * WORK + x0] += v * (1 - fx) * fy;
  acc[(y0 + 1) * WORK + x0 + 1] += v * fx * fy;
}
const TAU = Math.PI * 2;
const P1 = PULSE_L1_OUT * R, P2 = PULSE_L2_OUT * R;
function pulse(s, p1, p2) {
  const v = 0.5 + 0.30 * Math.sin(s * TAU / P1 + p1) + 0.20 * Math.sin(s * TAU / P2 + p2);
  return Math.max(0, Math.min(1, v));
}
const HALF = L + SHIFT;
const d1 = [0, 0], d2 = [0, 0];
const px = new Float32Array(2 * HALF + 1), py = new Float32Array(2 * HALF + 1);
const t0 = Date.now();
let drawn = 0;
for (let sI = 0; sI < seedX.length; sI++) {
  const sx = seedX[sI], sy = seedY[sI];
  // trace both directions with direction-continuity (axis field: never flip mid-path)
  px[HALF] = sx; py[HALF] = sy;
  let lo = HALF, hi = HALF;
  // forward (initially seaward)
  {
    let x = sx, y = sy;
    sampleTangent(x, y, d1);
    let pdx = d1[0], pdy = d1[1];
    for (let k = 1; k <= HALF; k++) {
      sampleTangent(x, y, d1);
      if (d1[0] * pdx + d1[1] * pdy < 0) { d1[0] = -d1[0]; d1[1] = -d1[1]; }
      sampleTangent(x + d1[0] * 0.5, y + d1[1] * 0.5, d2);
      if (d2[0] * d1[0] + d2[1] * d1[1] < 0) { d2[0] = -d2[0]; d2[1] = -d2[1]; }
      x += d2[0]; y += d2[1];
      if (x < 1 || y < 1 || x > WORK - 2 || y > WORK - 2) break;
      if (sampleBilinear(Hm, x, y) > 2.3) break;                     // ran onto land
      pdx = d2[0]; pdy = d2[1];
      hi = HALF + k; px[hi] = x; py[hi] = y;
    }
  }
  // backward (initially landward)
  {
    let x = sx, y = sy;
    sampleTangent(x, y, d1);
    let pdx = -d1[0], pdy = -d1[1];
    for (let k = 1; k <= HALF; k++) {
      sampleTangent(x, y, d1);
      let tx = -d1[0], ty = -d1[1];
      if (tx * pdx + ty * pdy < 0) { tx = -tx; ty = -ty; }
      sampleTangent(x + tx * 0.5, y + ty * 0.5, d2);
      let ux = d2[0], uy = d2[1];
      if (ux * tx + uy * ty < 0) { ux = -ux; uy = -uy; }
      x += ux; y += uy;
      if (x < 1 || y < 1 || x > WORK - 2 || y > WORK - 2) break;
      if (sampleBilinear(Hm, x, y) > 2.3) break;
      pdx = ux; pdy = uy;
      lo = HALF - k; px[lo] = x; py[lo] = y;
    }
  }
  const len = hi - lo;
  if (len < L * 0.25) continue;                                       // too short to be an artery
  const fadeN = Math.max(2, Math.round(len * END_FADE));
  const p1 = rnd() * TAU, p2 = rnd() * TAU;
  for (let k = lo; k <= hi; k++) {
    const x = px[k], y = py[k];
    const a = sampleBilinear(amp, x, y);
    if (a <= 0.004) continue;
    const endF = Math.min(1, (k - lo) / fadeN) * Math.min(1, (hi - k) / fadeN);
    const arc = k - HALF;                                             // signed, seaward-positive
    splat(accA, x, y, a * endF * pulse(arc, p1, p2));
    splat(accB, x, y, a * endF * pulse(arc - SHIFT, p1, p2));
  }
  drawn++;
}
console.log(`integrated+splatted ${drawn}/${seedX.length} streamlines in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// soften the 1px splat trails into strands, then soft-clamp the overlap
const smA = gaussBlur(accA, WORK, WORK, SPLAT_SIGMA_WORK);
const smB = gaussBlur(accB, WORK, WORK, SPLAT_SIGMA_WORK);
const licAn = new Float32Array(NPX), licBn = new Float32Array(NPX);
for (let i = 0; i < NPX; i++) {
  licAn[i] = 1 - Math.exp(-ACC_K * smA[i]);
  licBn[i] = 1 - Math.exp(-ACC_K * smB[i]);
}

// ---- acceptance metrics --------------------------------------------------------------------
{
  let water = 0, lit = 0, sum = 0;
  for (let i = 0; i < NPX; i++) {
    if (Hm[i] >= LAND_H[0]) continue;
    water++;
    if (licAn[i] > 0.30) lit++;
    sum += licAn[i];
  }
  console.log(`coverage: ${(100 * lit / water).toFixed(1)}% of water px above 0.30 (sparse target ~2-8%), mean ${ (sum / water).toFixed(3)}`);
}

if (process.env.DEBUG_DUMP) {
  const dump = async (arr, name, scale = 1) => {
    const buf = Buffer.alloc(NPX);
    for (let i = 0; i < NPX; i++) buf[i] = Math.round(Math.max(0, Math.min(1, arr[i] * scale)) * 255);
    await sharp(buf, { raw: { width: WORK, height: WORK, channels: 1 } }).toColourspace('b-w').png().toFile(`data/_debug_${name}.png`);
  };
  await dump(amp, 'amp');
  await dump(aniso, 'aniso');
  await dump(licAn, 'arteriesA');
  console.log('debug dumps written');
}

// ============================================================================================
// pack + upsample to OUT (same contract as every previous round: R=A, G=B, B=angle)
// ============================================================================================
async function rawGray(sharpPipeline, w, h) {
  const b = await sharpPipeline.raw().toBuffer();
  if (b.length !== w * h) throw new Error(`expected ${w * h} gray bytes, got ${b.length}`);
  return b;
}
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
  if (ang < 0) ang += TAU;
  packed[i * 3] = aUp[i];
  packed[i * 3 + 1] = bUp[i];
  packed[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(ang / TAU * 255)));
}
await sharp(packed, { raw: { width: OUT, height: OUT, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile('data/flow.png');

fs.writeFileSync('data/flow.json', JSON.stringify({
  description: 'Artery streamline flow texture (round 4, Ryan spec). R = phase A, G = phase B (the same along-arc pulse pattern slid ' + SHIFT_OUT + 'px seaward), B = flow angle (radians/2pi*255), tangent points SEAWARD. Long sparse streamlines along each channel\'s deepest line, from REAL depth (depth-composite-raw.f32), not per-pixel LIC.',
  size: OUT, workSize: WORK,
  method: {
    depthSource: 'data/depth-composite-raw.f32 (coastal LiDAR 2m > chart contours+soundings > NIWA 25m; build-depth-composite.py)',
    direction: 'channel axis = minor eigenvector of the structure tensor of gaussian-smoothed depth, scales ' + JSON.stringify(AXIS_SIGMAS_OUT) + ' output-px, blended fine-to-coarse by anisotropy confidence ' + JSON.stringify(AXIS_CONF) + ', signed seaward against a coarse (sigma ' + SEAWARD_SIGMA_OUT + 'px) height-minus-depth reference',
    amplitude: 'rel = depth/localMax(depth, r=' + LOCALMAX_R_OUT + 'px) ^ ' + REL_POW + ', times smoothstep' + JSON.stringify(DEPTH_RAMP) + 'm ramp, times ' + DEEP_BOOST_MIX + '*smoothstep' + JSON.stringify(DEEP_BOOST) + 'm dredged-channel boost, times anisotropy gate ' + JSON.stringify(ANISO_GATE) + ' (no valley axis -> no artery), times round-2 land fade ' + JSON.stringify(LAND_H) + 'm and chamfer-proxy ocean fade ' + JSON.stringify(OCEAN_BATHY),
    seeds: 'amplitude-weighted Poisson-disc darts, radius ' + SEED_R_OUT[0] + '->' + SEED_R_OUT[1] + ' output-px as amp rises, none below amp ' + SEED_AMP_MIN + ', seeded mulberry32(20260727)',
    integration: 'RK2 midpoint, 1 work-px steps, half-length L=' + L_OUT + ' output-px each way plus ' + SHIFT_OUT + ' for phase B, direction-continuity along the path (axis field), stops on land or frame edge, paths shorter than L/4 discarded',
    splat: 'bilinear scatter of amp * endFade(' + END_FADE + ') * pulse(arc), pulse = two incommensurate sines (' + PULSE_L1_OUT + '/' + PULSE_L2_OUT + 'px), then gaussian ' + SPLAT_SIGMA_WORK + ' work-px, then soft-clamp 1-exp(-' + ACC_K + '*acc)',
    twoPhase: 'phase B = pulse(arc - ' + SHIFT_OUT + 'px): the pattern slid seaward along the SAME geometry, so the renderer crossfade reads as downstream motion; contract unchanged from the LIC rounds',
    vortexSuppression: 'winding-number critical points of the axis field, damped in ~' + VORTEX_DISC_OUT + 'px discs (an axis field still orbits closed basins)',
    isletErase: 'round-2 vessel-islet erase kept on the height field (land gate); the chamfer-shadow heal is obsolete now the depth is real',
  },
}, null, 2));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`data/flow.png ${kb('data/flow.png')} at ${OUT}px`);
