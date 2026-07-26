// Diagnostic: difference consecutive frames of a tide sweep, quantify per-step changed-pixel
// counts and their spatial clustering (do changed pixels form large contiguous blobs that
// pop all at once, or a thin scattered waterline that advances gradually?).
import sharp from 'sharp';
import fs from 'fs';

const dir = process.argv[2] || 'out_sweep';
const files = fs.readdirSync(dir).filter(f => f.startsWith('flat_')).sort();
console.log(`frames: ${files.join(', ')}`);

const loaded = [];
for (const f of files) {
  const { data, info } = await sharp(`${dir}/${f}`).raw().toBuffer({ resolveWithObject: true });
  loaded.push({ f, data, w: info.width, h: info.height, ch: info.channels });
}

const results = [];
for (let i = 1; i < loaded.length; i++) {
  const a = loaded[i - 1], b = loaded[i];
  const { w, h, ch } = a;
  let changed = 0, sumAbs = 0;
  const changedMask = Buffer.alloc(w * h);
  for (let p = 0; p < w * h; p++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += Math.abs(a.data[p * ch + k] - b.data[p * ch + k]);
    if (d > 6) { changed++; changedMask[p] = 255; }
    sumAbs += d;
  }
  // connected-component sizing on changedMask (4-connectivity), to see if change is
  // concentrated in a few huge blobs (quantization "pop") vs a thin scattered line
  // (smooth waterline advance).
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let p = 0; p < w * h; p++) {
    if (!changedMask[p] || label[p] !== -1) continue;
    let size = 0;
    stack.push(p); label[p] = sizes.length;
    while (stack.length) {
      const q = stack.pop(); size++;
      const x = q % w, y = (q / w) | 0;
      const nbrs = [];
      if (x > 0) nbrs.push(q - 1);
      if (x < w - 1) nbrs.push(q + 1);
      if (y > 0) nbrs.push(q - w);
      if (y < h - 1) nbrs.push(q + w);
      for (const n of nbrs) if (changedMask[n] && label[n] === -1) { label[n] = sizes.length; stack.push(n); }
    }
    sizes.push(size);
  }
  sizes.sort((x, y) => y - x);
  const top5 = sizes.slice(0, 5);
  const largestFrac = sizes.length ? sizes[0] / changed : 0;
  results.push({ pair: `${a.f}->${b.f}`, changedPx: changed, meanAbsDiff: (sumAbs / (w * h)).toFixed(3), blobs: sizes.length, top5Sizes: top5, largestBlobFracOfChanged: largestFrac.toFixed(3) });
  // write mask for visual inspection
  await sharp(changedMask, { raw: { width: w, height: h, channels: 1 } }).png().toFile(`${dir}/diffmask_${a.f.replace('flat_','').replace('.png','')}_to_${b.f.replace('flat_','').replace('.png','')}.png`);
}

console.log(JSON.stringify(results, null, 2));
const counts = results.map(r => r.changedPx);
const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
console.log(`\nchangedPx per step: mean=${mean.toFixed(0)} stdev=${Math.sqrt(variance).toFixed(0)} min=${Math.min(...counts)} max=${Math.max(...counts)}  (stdev/mean=${(Math.sqrt(variance)/mean).toFixed(2)})`);
