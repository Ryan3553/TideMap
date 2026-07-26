import fs from 'fs';
import sharp from 'sharp';
import { TILE, GRID, SIZE, NPIX } from './config.mjs';
import { tilePath } from '../2-fetch.mjs';

/**
 * Composite one scene's 2x2 NDWI tiles onto the master grid.
 * Fills `gray` (0..255, NDWI = v/127.5 - 1) and `valid` (1 = real pixel,
 * 0 = titiler alpha-0 nodata). Buffers are reused across scenes by the caller.
 */
export async function loadScene(sceneId, gray, valid) {
  gray.fill(0); valid.fill(0);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const file = tilePath(sceneId, gx, gy);
      if (!fs.existsSync(file)) throw new Error(`missing tile ${file}`);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      if (info.width !== TILE || info.height !== TILE) throw new Error(`bad tile size ${file}`);
      const ox = gx * TILE, oy = gy * TILE;
      for (let y = 0; y < TILE; y++) {
        let src = y * TILE * ch;
        let dst = (oy + y) * SIZE + ox;
        for (let x = 0; x < TILE; x++, src += ch, dst++) {
          gray[dst] = data[src];
          valid[dst] = data[src + ch - 1] === 0 ? 0 : 1;
        }
      }
    }
  }
}

export const ndwiOf = (v) => v / 127.5 - 1;
export const grayFor = (ndwi) => Math.round((ndwi + 1) * 127.5);

/** Otsu threshold (returns a gray level 0..255) over pixels where mask[i] is truthy. */
export function otsu(gray, mask) {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < gray.length; i++) if (mask[i]) { hist[gray[i]]++; total++; }
  if (!total) return 128;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = v; }
  }
  return best;
}

// --- bit-packed boolean planes -------------------------------------------
export const WORDS = Math.ceil(NPIX / 32);
export const newPlane = () => new Uint32Array(WORDS);
export const setBit = (p, i) => { p[i >>> 5] |= (1 << (i & 31)); };
export const getBit = (p, i) => (p[i >>> 5] >>> (i & 31)) & 1;
export function countBits(p) {
  let n = 0;
  for (let w = 0; w < p.length; w++) {
    let v = p[w];
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}
