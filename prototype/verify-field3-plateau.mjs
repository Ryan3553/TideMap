// Same crop/methodology as research/overnight-2026-07-27/smoothness/field-plateau-stats.mjs,
// but reading the new field-v3.png 16-bit R/A height code instead of field-v2.png's 8-bit R.
// Run from prototype/: node verify-field3-plateau.mjs
import sharp from 'sharp';

const zoom = 0.10, cx = 0.235, cy = 0.40, aspect = 1200 / 900;
const halfW = zoom * aspect * 1.0866 / 2, halfH = zoom / 2;

const { data, info } = await sharp('data/field-v3.png').raw().toBuffer({ resolveWithObject: true });
const P = info.width, ch = info.channels;
const x0 = Math.floor((cx - halfW) * P), x1 = Math.ceil((cx + halfW) * P);
const y0 = Math.floor((cy - halfH) * P), y1 = Math.ceil((cy + halfH) * P);
const hist = new Map(), histInter = new Map();
let totalAll = 0, totalInter = 0;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const i = (y * P + x) * ch;
  const r = data[i], a = data[i + 3];
  const code = (r << 8) | a;
  hist.set(code, (hist.get(code) || 0) + 1); totalAll++;
  if (code !== 0 && code !== 65535) { histInter.set(code, (histInter.get(code) || 0) + 1); totalInter++; }
}
const entries = [...hist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`field-v3.png (16-bit R/A, P=${P}): crop ${x1-x0}x${y1-y0}=${totalAll}px, ${hist.size} distinct codes (incl. water/land sentinels), largest single code = ${entries[0][1]} px (${(entries[0][1]/totalAll*100).toFixed(1)}% of crop)`);
const entriesInter = [...histInter.entries()].sort((a, b) => b[1] - a[1]);
console.log(`field-v3.png intertidal-only (excl. water=0/land=65535 sentinels): ${totalInter} px, ${histInter.size} distinct codes, largest single code = ${entriesInter[0][1]} px (${(entriesInter[0][1]/totalInter*100).toFixed(1)}% of intertidal crop)`);
