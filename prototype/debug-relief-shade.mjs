// Verification-only debug renderer (NOT part of the build pipeline, not referenced by
// look.mjs/build-v2.mjs/template-v2.html). Renders a simple azimuth-aware hillshade from
// a relief.png's R/G gradient channels (sun from NE, low elevation) and composites it at
// 60% opacity over data/base-fused.jpg, so ridgelines/valleys can be eyeballed for
// crispness. Used to compare the old z13 relief against the new z15 relief.
//
// Usage: node debug-relief-shade.mjs <relief.png> <out.png> [outSize=2048] [cropBBox]
//   cropBBox (optional): "west,south,east,north" in lon/lat, to render a tight zoom crop
//   instead of the whole project bbox. Omit for the full map.
import fs from 'fs';
import sharp from 'sharp';

const RELIEF = process.argv[2];
const OUT = process.argv[3];
const OUT_SIZE = Number(process.argv[4] ?? 2048);
const cropArg = process.argv[5];

const WEST = 175.93, SOUTH = -37.79, EAST = 176.37, NORTH = -37.41;
const GRAD_MAX = 1.5;

const [cw, cs, ce, cn] = cropArg
  ? cropArg.split(',').map(Number)
  : [WEST, SOUTH, EAST, NORTH];

const relObj = await sharp(RELIEF).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const RP = relObj.info.width, rel = relObj.data;
if (relObj.info.height !== RP) throw new Error(`relief not square: ${RP}x${relObj.info.height}`);

const baseObj = await sharp('data/base-fused.jpg').removeAlpha().raw().toBuffer({ resolveWithObject: true });
const BP = baseObj.info.width, base = baseObj.data;
if (baseObj.info.height !== BP) throw new Error(`base not square: ${BP}x${baseObj.info.height}`);

function sampleBilinear(buf, P, ch, u, v, k) {
  const x = Math.max(0, Math.min(P - 1, u * P - 0.5));
  const y = Math.max(0, Math.min(P - 1, v * P - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = Math.min(P - 1, x0 + 1), y1 = Math.min(P - 1, y0 + 1);
  const o = (yy, xx) => (yy * P + xx) * ch + k;
  return (buf[o(y0, x0)] * (1 - fx) + buf[o(y0, x1)] * fx) * (1 - fy) +
         (buf[o(y1, x0)] * (1 - fx) + buf[o(y1, x1)] * fx) * fy;
}

// sun from NE, low elevation angle (matches the renderer's "low sun" raking-light case)
const azDeg = 45, elDeg = 15;
const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
const Lx = Math.sin(az) * Math.cos(el);   // East component
const Ly = Math.cos(az) * Math.cos(el);   // North component
const Lz = Math.sin(el);                  // Up component

const out = Buffer.alloc(OUT_SIZE * OUT_SIZE * 3);
for (let j = 0; j < OUT_SIZE; j++) {
  const lat = cn - (j + 0.5) / OUT_SIZE * (cn - cs);
  const vRel = (NORTH - lat) / (NORTH - SOUTH);
  const vBase = vRel;
  for (let i = 0; i < OUT_SIZE; i++) {
    const lon = cw + (i + 0.5) / OUT_SIZE * (ce - cw);
    const uRel = (lon - WEST) / (EAST - WEST);
    const uBase = uRel;

    const rByte = sampleBilinear(rel, RP, 3, uRel, vRel, 0);
    const gByte = sampleBilinear(rel, RP, 3, uRel, vRel, 1);
    const gx = (rByte / 255 - 0.5) * 2 * GRAD_MAX;   // dz/dEast
    const gy = (gByte / 255 - 0.5) * 2 * GRAD_MAX;   // dz/dNorth

    // surface normal from the gradient (E, N, Up), then diffuse-lit against L
    const nx = -gx, ny = -gy, nz = 1;
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const diffuse = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / nlen);
    const shade = 0.35 + 0.65 * diffuse;             // ambient + diffuse, 0..1-ish
    const grayByte = Math.max(0, Math.min(255, Math.round(shade * 255)));

    const o = (j * OUT_SIZE + i) * 3;
    for (let k = 0; k < 3; k++) {
      const baseByte = sampleBilinear(base, BP, 3, uBase, vBase, k);
      out[o + k] = Math.round(baseByte * 0.4 + grayByte * 0.6);
    }
  }
}
await sharp(out, { raw: { width: OUT_SIZE, height: OUT_SIZE, channels: 3 } }).png().toFile(OUT);
console.log(`wrote ${OUT} (${OUT_SIZE}px, crop ${cw},${cs},${ce},${cn}) from ${RELIEF} (${RP}px)`);
