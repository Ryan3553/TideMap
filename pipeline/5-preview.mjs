// Stage 5 — human-viewable renders.
//   preview-drying-height.png : colour ramp over the intertidal band
//   preview-classes.png       : the three classes, flat colours
//   preview-misfit.png        : where the step model fits badly
//   preview-water-*m.png      : water masks reconstructed from the raster
//   preview-observed-*m.png   : the observed NDWI mask of the nearest scene
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { SIZE, NPIX, dirs, decodeHeight, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL, CLS_NODATA } from './lib/config.mjs';
import { WORDS, getBit } from './lib/raster.mjs';


const OUT = +(process.env.PREVIEW_SIZE || 1300);
const meta = JSON.parse(fs.readFileSync(path.join(dirs.out, 'masks.json'), 'utf8'));
const scenes = meta.scenes;

const fit = fs.readFileSync(path.join(dirs.out, 'fit.bin'));
const heightCode = new Uint16Array(fit.buffer, fit.byteOffset, NPIX);
const classes = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 2, NPIX);
const residual = new Uint8Array(fit.buffer, fit.byteOffset + NPIX * 3, NPIX);

const save = (rgb, name) => sharp(Buffer.from(rgb.buffer), { raw: { width: SIZE, height: SIZE, channels: 3 } })
  .resize(OUT, OUT, { kernel: 'nearest' }).png().toFile(path.join(dirs.out, name));

// --- turbo-ish ramp -------------------------------------------------------
const RAMP = [[48, 18, 138], [33, 105, 214], [26, 187, 181], [124, 224, 92], [239, 209, 47], [246, 120, 32], [178, 22, 11]];
function ramp(t) {
  t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  return [0, 1, 2].map(c => Math.round(RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * f));
}

// --- drying height ramp ---------------------------------------------------
{
  const rgb = new Uint8Array(NPIX * 3);
  const lo = 0.3, hi = 2.15;
  for (let i = 0; i < NPIX; i++) {
    let c;
    if (classes[i] === CLS_INTERTIDAL) c = ramp((decodeHeight(heightCode[i]) - lo) / (hi - lo));
    else if (classes[i] === CLS_SUBTIDAL) c = [10, 20, 46];
    else if (classes[i] === CLS_SUPRATIDAL) c = [38, 36, 32];
    else c = [120, 0, 120];
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  await save(rgb, 'preview-drying-height.png');
}

// --- classes --------------------------------------------------------------
{
  const rgb = new Uint8Array(NPIX * 3);
  const col = { [CLS_SUBTIDAL]: [16, 52, 110], [CLS_INTERTIDAL]: [220, 176, 92], [CLS_SUPRATIDAL]: [42, 84, 46], [CLS_NODATA]: [200, 0, 200] };
  for (let i = 0; i < NPIX; i++) {
    const c = col[classes[i]] || [255, 0, 0];
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  await save(rgb, 'preview-classes.png');
}

// --- misfit ---------------------------------------------------------------
{
  const rgb = new Uint8Array(NPIX * 3);
  for (let i = 0; i < NPIX; i++) {
    const r = residual[i];
    const c = classes[i] === CLS_NODATA ? [120, 0, 120] : r === 0 ? [18, 18, 18] : ramp(Math.min(1, r / 30));
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  await save(rgb, 'preview-misfit.png');
}

// --- reconstructed vs observed water masks --------------------------------
const buf = fs.readFileSync(path.join(dirs.out, 'masks.bin'));
const planes = scenes.map((_, i) => new Uint32Array(buf.buffer, buf.byteOffset + i * WORDS * 4, WORDS));

for (const T of [0.4, 0.7, 1.0, 1.6, 2.0]) {
  const rgb = new Uint8Array(NPIX * 3);
  for (let i = 0; i < NPIX; i++) {
    const wet = classes[i] === CLS_SUBTIDAL || (classes[i] === CLS_INTERTIDAL && decodeHeight(heightCode[i]) <= T);
    const c = classes[i] === CLS_NODATA ? [120, 0, 120] : wet ? [24, 84, 168] : [222, 214, 196];
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  await save(rgb, `preview-water-${T.toFixed(1)}m.png`);

  // the observed mask of the nearest scene, for side-by-side comparison
  let best = 0;
  for (let j = 1; j < scenes.length; j++) if (Math.abs(scenes[j].tide - T) < Math.abs(scenes[best].tide - T)) best = j;
  const p = planes[best], rgb2 = new Uint8Array(NPIX * 3);
  for (let i = 0; i < NPIX; i++) {
    const wet = getBit(p, i);
    const c = classes[i] === CLS_NODATA ? [120, 0, 120] : wet ? [24, 84, 168] : [222, 214, 196];
    rgb2[i * 3] = c[0]; rgb2[i * 3 + 1] = c[1]; rgb2[i * 3 + 2] = c[2];
  }
  await save(rgb2, `preview-observed-${scenes[best].tide.toFixed(2)}m.png`);
  console.log(`T=${T.toFixed(1)} m  reconstructed + observed(${scenes[best].tide.toFixed(2)} m, ${scenes[best].datetime.slice(0, 10)})`);
}
console.log(`previews written at ${OUT}x${OUT}`);
