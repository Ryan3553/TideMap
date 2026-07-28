// Build the renderer's field-v3 texture (Wave 2a, J3 fix).
//
// field-v2 packed height as a single 8-bit R channel (256 codes / 15.7mm over a 4m range) --
// see research/overnight-2026-07-27/smoothness/README.md for the full diagnosis: that
// quantization is what made the tide pop in sudden zones. field-v3 keeps the SAME channel
// layout intent (R=height, G=bathy proxy, B=city lights, RETIRED -- see section 3 below) but:
//
//   R + A  16-bit drying height, split hi/lo byte (65,536 codes / 0.061mm step). Processed as
//          Float32 end-to-end -- median, resize, blur are all done on the float array with a
//          hand-rolled mitchell resample + gaussian blur, NEVER round-tripped through sharp's
//          8-bit raw buffers (that is exactly the bug being fixed). Quantized to 16 bits only
//          once, at the very last step.
//   G      bathymetric depth proxy, now a hybrid of real NIWA Bay of Plenty 25m DTM depth
//          (where it has confident underwater data) and the old chamfer-distance proxy from
//          field-v2.png's G channel (everywhere else -- land, and a feathered seam at the
//          water/land disagreement between the two sources).
//   B      RETIRED (2026-07-28) -- always 0. City lights moved to their own dedicated texture,
//          prototype/data/citylights-points.png (see build-citylights-points.mjs), which frees
//          this channel and ~2.7MB off the shipped page-field.png.
//
// The NIWA GeoTIFF is reprojected/resampled onto the field's equirectangular grid by
// resample-niwa-depth.py (rasterio + scipy; sharp/JS cannot read GeoTIFF reliably) -- run that
// first, it writes prototype/data/niwa-elevation-raw.f32 (P*P float32, metres, negative =
// underwater), which this script treats as a plain data input, same as drying-height.png.
import fs from 'fs';
import sharp from 'sharp';

const N = 2600;                              // native drying-height grid
const P = Number(process.argv[2] ?? 4096);   // output grid
const H_LO = -0.75, H_HI = 3.25;             // metres; unchanged from field-v2

const { decodeGray16 } = await import('../pipeline/lib/png16.mjs');

// ============================================================================================
// 1. Height surface, float32, exactly as prep-field.mjs builds it (prep-field.mjs:37-47) --
//    the ONLY change from there on is that this stays Float32 through median/resize/blur
//    instead of quantizing to 8 bits first.
// ============================================================================================
const dec = decodeGray16(fs.readFileSync('data/drying-height.png'));
const h16 = dec.samples ?? dec.data ?? dec;
if (h16.length !== N * N) throw new Error(`drying-height is ${h16.length} px, expected ${N * N}`);
const harbour = await sharp('data/harbour-mask.png').extractChannel(0).raw().toBuffer();
const META = JSON.parse(fs.readFileSync('data/drying-height.json', 'utf8'));
const { heightMax } = META.encoding;

const H = new Float32Array(N * N);
let nWater = 0, nLand = 0, nInter = 0, nFrozen = 0;
for (let i = 0; i < N * N; i++) {
  const v = h16[i];
  if (v === 0) { H[i] = H_LO; nWater++; }
  else if (v === 65535) { H[i] = H_HI; nLand++; }
  else if (harbour[i] < 128) { H[i] = H_LO; nFrozen++; }
  else { H[i] = (v - 1) / 65533 * heightMax; nInter++; }
}
console.log(`height surface: ${nWater} water, ${nInter} intertidal, ${nLand} land, ${nFrozen} frozen-as-sea`);

// ---- 3x3 median, on the float array directly (own implementation, no sharp round-trip) ------
function median3x3(src, n) {
  const out = new Float32Array(n * n);
  const win = new Float32Array(9);
  for (let y = 0; y < n; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(n - 1, y + 1);
    for (let x = 0; x < n; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(n - 1, x + 1);
      let k = 0;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) win[k++] = src[yy * n + xx];
      const sub = win.subarray(0, k);
      Array.prototype.sort.call(sub, (a, b) => a - b);
      out[y * n + x] = sub[k >> 1];
    }
  }
  return out;
}

// ---- Mitchell-Netravali (B=C=1/3) separable resample, float in/out, own implementation ------
function mitchellWeight(x) {
  const B = 1 / 3, C = 1 / 3;
  x = Math.abs(x);
  if (x < 1) {
    return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6;
  } else if (x < 2) {
    return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 30 * C) * x + (8 * B + 24 * C)) / 6;
  }
  return 0;
}
// Resample along one axis: src is inSize x lines (row-major, axis-agnostic via strides).
function resampleAxis(src, inSize, outSize, lines, srcStride, srcLineStride, dstStride, dstLineStride) {
  const out = new Float32Array(outSize * lines);
  const scale = outSize / inSize;
  for (let o = 0; o < outSize; o++) {
    const center = (o + 0.5) / scale - 0.5;
    const base = Math.floor(center);
    const taps = [];
    for (let k = -1; k <= 2; k++) {
      const si = Math.min(inSize - 1, Math.max(0, base + k));
      const w = mitchellWeight(center - (base + k));
      taps.push([si, w]);
    }
    let wsum = 0; for (const [, w] of taps) wsum += w;
    for (let l = 0; l < lines; l++) {
      let acc = 0;
      for (const [si, w] of taps) acc += src[l * srcLineStride + si * srcStride] * w;
      out[l * dstLineStride + o * dstStride] = acc / wsum;
    }
  }
  return out;
}
// Full 2D separable resize, square in/out.
function resizeFloat(src, inN, outN) {
  // pass 1: resample rows (x axis), inN x inN -> outN x inN  (line = row, stride along x = 1)
  const pass1 = resampleAxis(src, inN, outN, inN, /*srcStride*/1, /*srcLineStride*/inN, /*dstStride*/1, /*dstLineStride*/outN);
  // pass 2: resample columns (y axis), outN x inN -> outN x outN (line = col, stride along y = outN)
  const pass2 = resampleAxis(pass1, inN, outN, outN, /*srcStride*/outN, /*srcLineStride*/1, /*dstStride*/outN, /*dstLineStride*/1);
  return pass2;
}

// ---- Separable gaussian blur, float, own implementation --------------------------------------
function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = w; sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, radius };
}
function blurFloat(src, n, sigma) {
  if (!sigma) return src;
  const { k, radius } = gaussianKernel(sigma);
  const tmp = new Float32Array(n * n);
  // horizontal
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let t = -radius; t <= radius; t++) {
        const xx = Math.min(n - 1, Math.max(0, x + t));
        acc += src[row + xx] * k[t + radius];
      }
      tmp[row + x] = acc;
    }
  }
  const out = new Float32Array(n * n);
  // vertical
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      let acc = 0;
      for (let t = -radius; t <= radius; t++) {
        const yy = Math.min(n - 1, Math.max(0, y + t));
        acc += tmp[yy * n + x] * k[t + radius];
      }
      out[y * n + x] = acc;
    }
  }
  return out;
}

console.log('median3x3 on float height...');
const Hmed = median3x3(H, N);
console.log(`resample height ${N} -> ${P} (mitchell)...`);
const Hup0 = resizeFloat(Hmed, N, P);
console.log('blur height (sigma=1.1px)...');
const Hup = blurFloat(Hup0, P, 1.1);

// ---- Quantize to 16 bits, ONCE, right here -----------------------------------------------
const code16 = new Uint16Array(P * P);
for (let i = 0; i < P * P; i++) {
  const t = Math.max(0, Math.min(1, (Hup[i] - H_LO) / (H_HI - H_LO)));
  code16[i] = Math.round(t * 65535);
}

// ============================================================================================
// 2. Bathymetric depth proxy, G channel: hybrid of NIWA real depth + old field-v2 chamfer proxy
// ============================================================================================
// Composite real bathymetry (2 m coastal LiDAR > chart contours+soundings > NIWA 25 m),
// same contract as the old niwa-elevation-raw.f32: float32 metres vs MSL, negative under.
const ELEV_PATH = 'data/depth-composite-raw.f32';
if (!fs.existsSync(ELEV_PATH)) {
  throw new Error(`missing ${ELEV_PATH} -- run: python resample-niwa-depth.py ${P} && python build-depth-composite.py ${P}  (from prototype/)`);
}
const elevBuf = fs.readFileSync(ELEV_PATH);
const elev = new Float32Array(elevBuf.buffer, elevBuf.byteOffset, P * P);
if (elev.length !== P * P) throw new Error(`${ELEV_PATH} is ${elev.length} samples, expected ${P * P}`);

const gOld = await sharp('data/field-v2.png').extractChannel(1).raw().toBuffer(); // G = index 1 (R,G,B)
if (gOld.length !== P * P) throw new Error(`field-v2 G channel is ${gOld.length}px, expected ${P * P}`);

// Depth-to-proxy curve: two-segment ease, tuned against real sample points (see README) so the
// VALUE DISTRIBUTION roughly matches the old proxy -- shore/flats near 0, harbour channels and
// basins in the 0.25-0.6 band, open ocean approaching 1 by ~40m depth.
const D1 = 15.0, POW = 0.6;   // depth (m) where segment 1 -> segment 2 handoff happens
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function depthToG(depth) {
  if (depth <= 0) return 0;
  if (depth < D1) return 0.5 * Math.pow(Math.min(1, depth / D1), POW);
  return 0.5 + 0.5 * smoothstep(D1, 40, depth);
}

const NIWA_VALID_ELEV = -0.05; // more negative than this = confidently underwater
const validMask = Buffer.alloc(P * P); // 0/255, feathered below
const gNiwaByte = Buffer.alloc(P * P);
for (let i = 0; i < P * P; i++) {
  const e = elev[i];
  const valid = e < NIWA_VALID_ELEV;
  validMask[i] = valid ? 255 : 0;
  const depth = valid ? -e : 0;
  gNiwaByte[i] = Math.max(0, Math.min(255, Math.round(depthToG(depth) * 255)));
}
// Feather the seam: blur the valid mask over ~8px so the two sources blend smoothly instead of
// snapping wherever NIWA and the drying-height-derived shoreline disagree on where land is.
const alphaBuf = await sharp(validMask, { raw: { width: P, height: P, channels: 1 } })
  .blur(8).raw().toBuffer();

const gPacked = Buffer.alloc(P * P);
for (let i = 0; i < P * P; i++) {
  const a = alphaBuf[i] / 255;
  gPacked[i] = Math.max(0, Math.min(255, Math.round(a * gNiwaByte[i] + (1 - a) * gOld[i])));
}
console.log(`G channel: ${(validMask.reduce((s, v) => s + (v ? 1 : 0), 0) / (P * P) * 100).toFixed(1)}% confident NIWA-underwater before feathering`);

// ============================================================================================
// 3. City lights, B channel: RETIRED (2026-07-28) -- lights now live in their own dedicated
// texture, data/citylights-points.png (R=core, G=corona, B=coolness; see
// build-citylights-points.mjs), consumed directly by the shader/look.mjs as uLights. This B
// channel is just zeroed to free ~2.7MB off the shipped page-field.png. Old compositing code
// kept below (commented) as a record of the previous verbatim-mask contract, in case a future
// field layout wants a spare channel back.
// ============================================================================================
// const cityMeta = await sharp('data/citylights.png').metadata();
// if (cityMeta.width !== 4096 || cityMeta.height !== 4096 || cityMeta.channels !== 1) {
//   throw new Error(`citylights.png is ${cityMeta.width}x${cityMeta.height}x${cityMeta.channels}, expected 4096x4096x1`);
// }
// const cityRaw = await sharp('data/citylights.png').extractChannel(0).raw().toBuffer();
// const cityUp = (P === cityMeta.width) ? cityRaw
//   : await sharp(cityRaw, { raw: { width: cityMeta.width, height: cityMeta.height, channels: 1 } })
//       .resize(P, P, { kernel: 'mitchell' }).raw().toBuffer();
const cityUp = new Uint8Array(P * P); // all zero -- see retirement note above

// ============================================================================================
// 4. Assemble the final RGBA buffer BY HAND. No sharp op touches these bytes after this point
//    except the raw-in/png-out encode (which does not read or transform pixel values).
// ============================================================================================
const packed = Buffer.alloc(P * P * 4);
for (let i = 0; i < P * P; i++) {
  const c = code16[i];
  packed[i * 4] = (c >>> 8) & 0xff;      // R: hi byte
  packed[i * 4 + 1] = gPacked[i];        // G: depth proxy
  packed[i * 4 + 2] = cityUp[i];         // B: retired, always 0 (see section 3)
  packed[i * 4 + 3] = c & 0xff;          // A: lo byte
}
await sharp(packed, { raw: { width: P, height: P, channels: 4 } })
  .png({ compressionLevel: 9 }).toFile('data/field-v3.png');

// ============================================================================================
// 5. Verify the 16-bit round trip: decode the PNG we just wrote and compare against Hup
//    (the float field right before quantization).
// ============================================================================================
{
  const rt = await sharp('data/field-v3.png').raw().toBuffer();
  let maxAbsErr = 0, sumAbsErr = 0;
  for (let i = 0; i < P * P; i++) {
    const r = rt[i * 4], a = rt[i * 4 + 3];
    const c = (r << 8) | a;
    const h = H_LO + (c / 65535) * (H_HI - H_LO);
    const err = Math.abs(h - Hup[i]);
    if (err > maxAbsErr) maxAbsErr = err;
    sumAbsErr += err;
  }
  const tolerance = 4 / 65535 * 1.01;
  console.log(`16-bit round trip: max abs error ${(maxAbsErr * 1000).toFixed(4)} mm, mean ${(sumAbsErr / (P * P) * 1000).toFixed(5)} mm, tolerance ${(tolerance * 1000).toFixed(4)} mm`);
  if (maxAbsErr > tolerance) throw new Error(`round-trip error ${maxAbsErr} exceeds tolerance ${tolerance}`);
  console.log('round trip: PASS');
}

// ============================================================================================
// 6. Provenance
// ============================================================================================
fs.writeFileSync('data/field-v3.json', JSON.stringify({
  description: 'Renderer field v3. R+A = 16-bit continuous drying height (hi/lo byte split), G = hybrid NIWA-real/chamfer-proxy bathymetric depth, B = retired (always 0; city lights moved to data/citylights-points.png).',
  size: P, sourceSize: N,
  heightEncoding: {
    lo: H_LO, hi: H_HI,
    bits: 16,
    pack: 'code16 = R*256 + A  (R = high byte, A = low byte)',
    toMetres: 'h = lo_m + (code16/65535) * (hi_m - lo_m)',
    note: 'Hardware bilinear on split R/A bytes is WRONG at every high-byte carry -- the shader must sample NEAREST and do manual bilinear on the decoded float. See research/overnight-2026-07-27/smoothness/README.md section B.',
  },
  waterSentinel: H_LO, landSentinel: H_HI,
  smoothing: { resampleKernel: 'mitchell (own impl, B=C=1/3)', heightBlurSigmaPx: 1.1, pipeline: 'float32 throughout: median3x3 -> resize -> blur -> quantize once' },
  depthProxy: {
    method: 'hybrid: composite real bathymetry where confidently underwater (elevation < -0.05m), falls back to field-v2.png\'s chamfer-distance proxy elsewhere (land, and the seam between the two sources), feathered over ~8px',
    curve: 'two-segment ease vs depth(m): depth<15 -> 0.5*(depth/15)^0.6 ; depth>=15 -> 0.5 + 0.5*smoothstep(15,40,depth)',
    compositeSource: 'data/depth-composite-raw.f32 built by build-depth-composite.py: coastal LiDAR 2m DEM 2025 (nz-coastal, NZVD2016->MSL) > chart depth contours 50672 + soundings 50858 (WFS, CD->MSL via mean tide level 1.107m from sources/tides) > NIWA BoP 25m DTM (resample-niwa-depth.py). The LDS 122679 multibeam 2m slots in on top once the LDS key has the Exports scope.',
    datum: 'all sources reconciled to local MSL; see data/depth-composite.json',
    measured: 'mostly -- real 2m LiDAR over flats/shallows and much of the channels, chart-survey interpolation in the deep channels, NIWA elsewhere; proxy only on land/seams',
  },
  cityLights: { source: 'RETIRED -- this channel is always 0. City lights now live in prototype/data/citylights-points.png (see build-citylights-points.mjs); consumed directly as uLights, not via this field.' },
}, null, 2));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' kB';
console.log(`data/field-v3.png ${kb('data/field-v3.png')} at ${P}px`);
