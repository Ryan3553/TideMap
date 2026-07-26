// Independent check that the shipped rasters decode back to the documented
// encoding. Uses its own PNG decoder, not the writer's code path.
import sharp from 'sharp'; import fs from 'fs'; import path from 'path';
import { dirs, NPIX, SIZE, decodeHeight, SUBTIDAL, SUPRATIDAL, CLS_SUBTIDAL, CLS_INTERTIDAL, CLS_SUPRATIDAL, H_MAX } from './lib/config.mjs';
import { decodeGray16 } from './lib/png16.mjs';

const meta = JSON.parse(fs.readFileSync(path.join(dirs.out, 'drying-height.json'), 'utf8'));
const h = decodeGray16(fs.readFileSync(path.join(dirs.out, 'drying-height.png')));
const c = await sharp(path.join(dirs.out, 'classes.png')).raw().toBuffer({ resolveWithObject: true });
console.log(`drying-height.png: ${h.width}x${h.height}, bitDepth ${h.bitDepth}, colourType ${h.colourType} (0 = grayscale)`);
console.log(`classes.png      : ${c.info.width}x${c.info.height}, channels ${c.info.channels}, depth ${c.info.depth}`);
if (h.width !== SIZE || h.height !== SIZE) throw new Error('wrong size');

const C8 = new Uint8Array(c.data.buffer, c.data.byteOffset, c.data.length);
const cch = c.info.channels;
let sub = 0, sup = 0, inter = 0, other = 0, bad = 0, minH = Infinity, maxH = -Infinity;
for (let i = 0; i < NPIX; i++) {
  const cls = C8[i * cch], v = h.data[i];
  if (cls === CLS_SUBTIDAL) { sub++; if (v !== SUBTIDAL) bad++; }
  else if (cls === CLS_SUPRATIDAL) { sup++; if (v !== SUPRATIDAL) bad++; }
  else if (cls === CLS_INTERTIDAL) {
    inter++;
    if (v < 1 || v > 65534) bad++;
    else { const m = decodeHeight(v); if (m < minH) minH = m; if (m > maxH) maxH = m; }
  } else other++;
}
console.log(`decoded : subtidal ${sub}  intertidal ${inter}  supratidal ${sup}  unexpected-class ${other}`);
console.log(`sidecar : subtidal ${meta.counts.subtidal}  intertidal ${meta.counts.intertidal}  supratidal ${meta.counts.supratidal}`);
console.log(`sentinel violations: ${bad}`);
console.log(`intertidal heights decode to ${minH.toFixed(3)}..${maxH.toFixed(3)} m (scene tide range ${meta.tideRange[0]}..${meta.tideRange[1]}, encoding ceiling ${H_MAX})`);
const distinct = new Set(); for (let i = 0; i < NPIX; i++) if (C8[i * cch] === CLS_INTERTIDAL) distinct.add(h.data[i]);
console.log(`distinct intertidal codes: ${distinct.size} (spatial lag gives each lag bin its own tide vector, so more than scene-count)`);
const ok = sub === meta.counts.subtidal && inter === meta.counts.intertidal && sup === meta.counts.supratidal
  && bad === 0 && other === 0 && minH >= meta.tideRange[0] - 0.2 && maxH <= meta.tideRange[1] + 0.2;
console.log(ok ? 'PASS — rasters round-trip to the documented encoding' : 'FAIL');
process.exit(ok ? 0 : 1);
