// Throwaway preview compositor for J4 flow texture judging. Not part of the deliverable.
import sharp from 'sharp';

const ROOT = 'D:/Development/Claude Sandbox/TideMap/prototype';
const OUTDIR = 'D:/Development/Claude Sandbox/TideMap/research/overnight-2026-07-27/flow';

const flowMeta = await sharp(`${ROOT}/data/flow.png`).metadata();
const P = flowMeta.width;

async function rawRGB(path, w, h, resize) {
  let p = sharp(path);
  if (resize) p = p.resize(w, h, { kernel: 'mitchell' });
  const b = await p.removeAlpha().toColourspace('srgb').raw().toBuffer();
  if (b.length !== w * h * 3) throw new Error(`${path}: expected ${w*h*3}, got ${b.length}`);
  return b;
}

const base = await rawRGB(`${ROOT}/data/base-aerial.jpg`, P, P, true);
const flow = await rawRGB(`${ROOT}/data/flow.png`, P, P, false);

const TINT = [0.55, 1.0, 1.0];
const GAIN = Number(process.env.PREVIEW_GAIN ?? 1.35);
function composite(x0, y0, w, h, outPath, scale) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y;
    const si = (sy * P + sx);
    const a = flow[si * 3] / 255, bph = flow[si * 3 + 1] / 255;
    const inten = Math.max(a, bph) * GAIN;
    const oi = (y * w + x) * 3;
    for (let k = 0; k < 3; k++) {
      const baseC = base[si * 3 + k] / 255;
      const tintC = Math.min(1, inten * TINT[k]);
      const screen = 1 - (1 - baseC) * (1 - tintC);
      buf[oi + k] = Math.round(Math.max(0, Math.min(1, screen)) * 255);
    }
  }
  let img = sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  if (scale && scale !== 1) img = img.resize(Math.round(w * scale), Math.round(h * scale), { kernel: 'mitchell' });
  return img.png().toFile(outPath);
}

await composite(0, 0, P, P, `${OUTDIR}/a-whole-harbour.png`, 1);
console.log('whole harbour done');

const S = P / 4096;
function crop(cxOut, cyOut, sizeOut, name) {
  const cx = Math.round(cxOut * S), cy = Math.round(cyOut * S), size = Math.round(sizeOut * S);
  const x0 = Math.max(0, cx - size / 2), y0 = Math.max(0, cy - size / 2);
  return composite(x0, y0, Math.min(size, P - x0), Math.min(size, P - y0), `${OUTDIR}/${name}.png`, 1);
}
await crop(2399, 2429, 900, 'b-mount-maunganui-channel');
console.log('mount maunganui done');
await crop(702, 1346, 1000, 'c-northern-basin-flats');
console.log('northern basin done');
