// 8-connected component labelling over a boolean mask, iterative (no recursion).
import { SIZE, NPIX } from './config.mjs';

/** @returns {labels:Int32Array (0 = background, 1..n), sizes:number[]} */
export function labelComponents(mask) {
  const labels = new Int32Array(NPIX);
  const sizes = [0];
  const stack = new Int32Array(NPIX);
  let next = 1;
  for (let s = 0; s < NPIX; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = next++;
    let sp = 0, count = 0;
    stack[sp++] = s; labels[s] = id;
    while (sp > 0) {
      const i = stack[--sp]; count++;
      const x = i % SIZE, y = (i - x) / SIZE;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= SIZE) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx; if (nx < 0 || nx >= SIZE) continue;
          const j = ny * SIZE + nx;
          if (mask[j] && !labels[j]) { labels[j] = id; stack[sp++] = j; }
        }
      }
    }
    sizes[id] = count;
  }
  return { labels, sizes, count: next - 1 };
}

/** Dilate a boolean mask by `r` pixels (square structuring element), in place-safe. */
export function dilate(mask, r) {
  if (r <= 0) return Uint8Array.from(mask);
  let cur = Uint8Array.from(mask);
  for (let pass = 0; pass < r; pass++) {
    const out = Uint8Array.from(cur);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < SIZE - 1 && cur[i + 1]) ||
            (y > 0 && cur[i - SIZE]) || (y < SIZE - 1 && cur[i + SIZE])) out[i] = 1;
      }
    }
    cur = out;
  }
  return cur;
}

/** Erode a boolean mask by r pixels (4-neighbour), returns a new mask. */
export function erode(mask, r) {
  let cur = Uint8Array.from(mask);
  for (let pass = 0; pass < r; pass++) {
    const out = Uint8Array.from(cur);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if (!cur[i]) continue;
        if (x === 0 || x === SIZE - 1 || y === 0 || y === SIZE - 1) { out[i] = 0; continue; }
        if (!cur[i - 1] || !cur[i + 1] || !cur[i - SIZE] || !cur[i + SIZE]) out[i] = 0;
      }
    }
    cur = out;
  }
  return cur;
}
