// Diagnostic: how much of a crop is one single quantized height code, at 8-bit (field-v2.png,
// what the shader actually reads today) vs the native 16-bit source (data/drying-height.png).
// Run from prototype/: node ../research/overnight-2026-07-27/smoothness/field-plateau-stats.mjs
import sharp from 'sharp';
import { decodeGray16 } from '../pipeline/lib/png16.mjs';
import fs from 'fs';

const zoom = 0.10, cx = 0.235, cy = 0.40, aspect = 1200 / 900;
const halfW = zoom * aspect * 1.0866 / 2, halfH = zoom / 2;

// ---- field-v2.png (8-bit R channel, what the shader samples today) ----
{
  const { data, info } = await sharp('data/field-v2.png').raw().toBuffer({ resolveWithObject: true });
  const P = info.width, ch = info.channels;
  const x0 = Math.floor((cx - halfW) * P), x1 = Math.ceil((cx + halfW) * P);
  const y0 = Math.floor((cy - halfH) * P), y1 = Math.ceil((cy + halfH) * P);
  const hist = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const r = data[(y * P + x) * ch]; hist.set(r, (hist.get(r) || 0) + 1);
  }
  const total = (x1 - x0) * (y1 - y0);
  const entries = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`field-v2.png (8-bit, P=${P}): crop ${x1-x0}x${y1-y0}=${total}px, ${hist.size} distinct codes, largest single code = ${entries[0][1]} px (${(entries[0][1]/total*100).toFixed(1)}% of crop)`);
}

// ---- data/drying-height.png (native 16-bit source) ----
{
  const dec = decodeGray16(fs.readFileSync('data/drying-height.png'));
  const N = dec.width, h16 = dec.data;
  const x0 = Math.floor((cx - halfW) * N), x1 = Math.ceil((cx + halfW) * N);
  const y0 = Math.floor((cy - halfH) * N), y1 = Math.ceil((cy + halfH) * N);
  const hist = new Map();
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const v = h16[y * N + x]; if (v === 0 || v === 65535) continue;
    hist.set(v, (hist.get(v) || 0) + 1); total++;
  }
  const entries = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`drying-height.png (16-bit, N=${N}): crop intertidal px=${total}, ${hist.size} distinct codes, largest single code = ${entries[0][1]} px (${(entries[0][1]/total*100).toFixed(1)}% of intertidal crop)`);
}
