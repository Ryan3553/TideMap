// J1a — fusion + regrade candidates for the flat/washed-out basemap.
// Builds three JPEGs into data/, all on the SAME pixel grid as base-aerial.jpg (5120px, not the
// 4096 the brief assumed — base-aerial.jpg was already re-composited at 5120; matching it exactly
// avoids an extra resample generation-loss pass):
//   base-fused.jpg      — pansharpen-style: Sentinel colour + LINZ high-frequency luminance detail
//   base-graded.jpg     — LINZ aerial regraded: dehaze, S-curve contrast, vibrance, warm/green land
//   base-fusegrade.jpg  — fuse() then a gentler grade() on top
//
// Scratch/dev tool, not part of the pipeline. Reproducible: rerun to regenerate all three.
import fs from 'fs';
import sharp from 'sharp';

const P = 5120; // matches data/base-aerial.jpg exactly

// Colour donor: the Sentinel-2 source whose colour/hue is injected into the LINZ aerial's
// luminance detail. Override with `node fuse-base.mjs donor=data/base-hi.jpg`. Default is
// base-s2fresh.jpg — a fresher 3-scene median S2 composite with richer, better-graded colour
// than base-hi.jpg on the same 10 m grid (see research/overnight-2026-07-27/imagery-survey/
// README.md "Handoff"). Whatever the donor's native size, it gets resampled UP to P=5120 below
// (never shrunk — base-aerial.jpg stays the detail ceiling).
const DONOR = process.argv.find(a => a.startsWith('donor='))?.slice('donor='.length) || 'data/base-s2fresh.jpg';

async function rgb(path, kernel = 'lanczos3') {
  const b = await sharp(path).resize(P, P, { kernel }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  if (b.length !== P * P * 3) throw new Error(`${path}: ${b.length} != ${P * P * 3}`);
  return b;
}
async function gray(path, kernel = 'nearest') {
  const b = await sharp(path).resize(P, P, { kernel }).extractChannel(0).raw().toBuffer();
  if (b.length !== P * P) throw new Error(`${path}: ${b.length} != ${P * P}`);
  return b;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function lumOf(buf) {
  const N = buf.length / 3, out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = 0.299 * buf[i * 3] + 0.587 * buf[i * 3 + 1] + 0.114 * buf[i * 3 + 2];
  return out;
}

async function blurGray(lumF32, sigma) {
  const u8 = Buffer.alloc(lumF32.length);
  for (let i = 0; i < lumF32.length; i++) u8[i] = Math.round(clamp(lumF32[i], 0, 255));
  // sharp silently promotes a mono raw buffer to 3-channel sRGB once an operator like .blur() runs
  // (verified via resolveWithObject: channels comes back 3, not 1) — extractChannel(0) back to mono
  // guards against reading the result at the wrong stride (R,G,B all equal anyway, source was mono).
  const blurred = await sharp(u8, { raw: { width: P, height: P, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer();
  if (blurred.length !== lumF32.length) throw new Error(`blurGray: ${blurred.length} != ${lumF32.length}`);
  const out = new Float32Array(lumF32.length);
  for (let i = 0; i < lumF32.length; i++) out[i] = blurred[i];
  return out;
}

// ---- 1. Fusion: Sentinel colour + LINZ high-frequency luminance detail (pansharpen-style) ------
//
// Textbook pansharpen keeps the colour source's OWN low-frequency luminance and only injects the
// panchromatic source's high-frequency detail. Tried that first here and it produces a real bug:
// base-hi.jpg (Sentinel) runs substantially darker than base-aerial.jpg in places (e.g. the Matakana
// dune scrub measured 27.7 mean luminance vs 50.0 for the same window in the aerial) — an exposure
// difference, not a colour one. The night/day shader's land palette is a STEEP curve around
// `landWhite` (smoothstep 0.02..0.55), tuned against the aerial's own exposure, so inheriting
// Sentinel's darker baseline crosses into `landDark` territory and reads as a black smear once run
// through the actual render (confirmed by pushing all 5 candidates through look-alt.mjs). Fix: match
// Sentinel's LOCAL luminance envelope to the aerial's before injecting detail — a large-radius blur
// ratio, the same trick compose-base.mjs already uses to flatten LINZ capture-block tone steps — so
// the fused result inherits the aerial's regional exposure and only Sentinel's colour/hue survives.
async function fuse(aerial, sentinelUp, { sigma = 14, gain = 0.85, clampMag = 46, lfSigma = 80, lfClampLo = 0.55, lfClampHi = 1.9 } = {}) {
  const aLum = lumOf(aerial), sLum = lumOf(sentinelUp);
  const aLumBlur = await blurGray(aLum, sigma);
  const aLumLF = await blurGray(aLum, lfSigma);
  const sLumLF = await blurGray(sLum, lfSigma);
  const out = Buffer.alloc(P * P * 3);
  for (let i = 0; i < P * P; i++) {
    const expRatio = clamp(aLumLF[i] / Math.max(sLumLF[i], 4), lfClampLo, lfClampHi);
    const sLumMatched = sLum[i] * expRatio;
    const detail = clamp(aLum[i] - aLumBlur[i], -clampMag, clampMag);
    const newLum = sLumMatched + gain * detail;
    for (let k = 0; k < 3; k++) {
      // keep Sentinel chroma: shift each channel by the same luminance delta it already carries
      // (relative to Sentinel's ORIGINAL, unmatched luminance — expRatio only relights, hue is untouched)
      const chroma = sentinelUp[i * 3 + k] - sLum[i];
      out[i * 3 + k] = Math.round(clamp(newLum + chroma, 0, 255));
    }
  }
  return out;
}

// ---- percentile helper for dehaze black/white points --------------------------------------------
function percentile(buf, stride, channel, p) {
  const N = buf.length / stride;
  const vals = new Uint8Array(N);
  for (let i = 0; i < N; i++) vals[i] = buf[i * stride + channel];
  const sorted = Uint8Array.from(vals).sort();
  return sorted[clamp(Math.round(p * (N - 1)), 0, N - 1)];
}

// ---- 2. Regrade: dehaze, S-curve contrast, vibrance, warm/green land bias -----------------------
async function grade(buf, landMask, {
  dehazeStrength = 0.55,      // fraction of the measured black point actually removed (never 1.0 — never crush to true black)
  blackFloor = 6,             // never push below this even after dehaze
  whiteClipP = 0.995,         // percentile used as the white point for the stretch
  contrastGamma = 0.88,       // <1 = steeper S-curve, more contrast
  vibrance = 0.35,            // vibrance amount, protects already-saturated pixels
  landWarm = [5, 4, -6],      // small [R,G,B] additive bias applied to land only
} = {}) {
  const black = [0, 1, 2].map(k => percentile(buf, 3, k, 0.01));
  const white = [0, 1, 2].map(k => percentile(buf, 3, k, whiteClipP));
  const bp = black.map(b => Math.min(blackFloor, b * dehazeStrength));
  const out = Buffer.alloc(P * P * 3);
  for (let i = 0; i < P * P; i++) {
    const rgbIn = [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
    // dehaze: subtract a partial black point, then rescale to the white point (soft stretch, floor kept)
    const stretched = rgbIn.map((c, k) => clamp((c - bp[k]) / Math.max(1, white[k] - bp[k]) * 255, 0, 255));
    // S-curve contrast (pivot 0.5, power curve either side)
    const curved = stretched.map(c => {
      const x = c / 255;
      const y = x < 0.5 ? 0.5 * Math.pow(2 * x, contrastGamma) : 1 - 0.5 * Math.pow(2 * (1 - x), contrastGamma);
      return y * 255;
    });
    // vibrance: boost low-saturation pixels more than already-saturated ones
    const avg = (curved[0] + curved[1] + curved[2]) / 3;
    const maxc = Math.max(...curved);
    const sat = (maxc - avg) * 2 / 255;
    const boost = vibrance * (1 - clamp(sat, 0, 1));
    const vib = curved.map(c => clamp(avg + (c - avg) * (1 + boost), 0, 255));
    // slight warm-green bias on land only
    const m = landMask[i] / 255;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.round(clamp(vib[k] + landWarm[k] * m, 0, 255));
  }
  return out;
}

console.log('loading sources...');
console.log('colour donor:', DONOR);
const aerial = await rgb('data/base-aerial.jpg');
const sentinelUp = await rgb(DONOR, 'cubic'); // smooth upsample, avoids lanczos ringing (1.25x for base-s2fresh's 4096, 1.83x for base-hi's 2800)
const landMaskRaw = await gray('data/classes.png'); // 255 = land, else water/nodata
// soften the mask edge a touch so the land tint doesn't hard-step at the coastline
const landMask = await sharp(landMaskRaw, { raw: { width: P, height: P, channels: 1 } }).blur(3).extractChannel(0).raw().toBuffer();
if (landMask.length !== P * P) throw new Error(`landMask: ${landMask.length} != ${P * P}`);

console.log('fusing (Sentinel colour + LINZ detail)...');
const fused = await fuse(aerial, sentinelUp);
await sharp(fused, { raw: { width: P, height: P, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toFile('data/base-fused.jpg');
console.log('data/base-fused.jpg', (fs.statSync('data/base-fused.jpg').size / 1024).toFixed(0), 'kB');

console.log('regrading LINZ aerial...');
const graded = await grade(aerial, landMask);
await sharp(graded, { raw: { width: P, height: P, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toFile('data/base-graded.jpg');
console.log('data/base-graded.jpg', (fs.statSync('data/base-graded.jpg').size / 1024).toFixed(0), 'kB');

console.log('fuse then gentle grade...');
const fusegrade = await grade(fused, landMask, {
  dehazeStrength: 0.35, blackFloor: 6, whiteClipP: 0.997,
  contrastGamma: 0.94, vibrance: 0.18, landWarm: [3, 2, -3],
});
await sharp(fusegrade, { raw: { width: P, height: P, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toFile('data/base-fusegrade.jpg');
console.log('data/base-fusegrade.jpg', (fs.statSync('data/base-fusegrade.jpg').size / 1024).toFixed(0), 'kB');
