// Independent re-audit of the SHIPPED mask against its documented self-check,
// reading the PNGs from disk exactly as a consumer would.
import fs from 'fs'; import path from 'path'; import sharp from 'sharp';
import { NPIX, dirs, CLS_INTERTIDAL, CLS_SUBTIDAL } from './lib/config.mjs';
const meta = JSON.parse(fs.readFileSync(path.join(dirs.out, 'harbour-mask.json'), 'utf8'));
const A = meta.selfCheck.pixelAreaKm2;
const rd = async (f) => { const r = await sharp(path.join(dirs.out, f)).raw().toBuffer({ resolveWithObject: true }); return { d: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.length), ch: r.info.channels }; };
const M = await rd('harbour-mask.png'), C = await rd('classes.png');
let maskPx = 0, inI = 0, outI = 0, inSub = 0;
for (let i = 0; i < NPIX; i++) {
  const m = M.d[i * M.ch] === 255, c = C.d[i * C.ch];
  if (m) maskPx++;
  if (c === CLS_INTERTIDAL) (m ? inI++ : outI++);
  else if (c === CLS_SUBTIDAL && m) inSub++;
}
const got = { maskAreaKm2: +(maskPx * A).toFixed(1), intertidalInsideKm2: +(inI * A).toFixed(1), intertidalOutsideKm2: +(outI * A).toFixed(1), subtidalInsideKm2: +(inSub * A).toFixed(1) };
let ok = true;
for (const k of Object.keys(got)) {
  const exp = meta.selfCheck[k], hit = Math.abs(exp - got[k]) < 0.15;
  if (!hit) ok = false;
  console.log(`${k.padEnd(24)} documented ${String(exp).padStart(7)}   measured ${String(got[k]).padStart(7)}   ${hit ? 'ok' : 'MISMATCH'}`);
}
console.log(`ratio inside:outside = ${(inI / outI).toFixed(1)} : 1`);
console.log(ok && inI > outI * 3 ? 'PASS — shipped mask matches its documented self-check and inside >> outside' : 'FAIL');
process.exit(ok && inI > outI * 3 ? 0 : 1);
