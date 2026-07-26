// Stage 2b — composite each scene's 2x2 NDWI tiles once and cache the result,
// so threshold experiments do not have to re-decode 140 PNGs every time.
// Layout per scene file: NPIX bytes of gray, then WORDS*4 bytes of validity bits.
import fs from 'fs';
import path from 'path';
import { NPIX, dirs } from './lib/config.mjs';
import { loadScene, newPlane, setBit, WORDS } from './lib/raster.mjs';

export const compositePath = (id) => path.join(dirs.cache, `ndwi_${id}.bin`);
export const COMPOSITE_BYTES = NPIX + WORDS * 4;

export function readComposite(id) {
  const b = fs.readFileSync(compositePath(id));
  if (b.length !== COMPOSITE_BYTES) throw new Error(`bad composite ${id}`);
  return { gray: new Uint8Array(b.buffer, b.byteOffset, NPIX), valid: new Uint32Array(b.buffer, b.byteOffset + NPIX, WORDS) };
}

const { pathToFileURL } = await import('url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
  scenes.sort((a, b) => a.tide - b.tide);
  const gray = new Uint8Array(NPIX), valid = new Uint8Array(NPIX), plane = newPlane();
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i], f = compositePath(s.id);
    if (fs.existsSync(f) && fs.statSync(f).size === COMPOSITE_BYTES) { process.stdout.write(`\r  ${i + 1}/${scenes.length} cached   `); continue; }
    await loadScene(s.id, gray, valid);
    plane.fill(0);
    for (let p = 0; p < NPIX; p++) if (valid[p]) setBit(plane, p);
    fs.writeFileSync(f, Buffer.concat([Buffer.from(gray.buffer, gray.byteOffset, NPIX), Buffer.from(plane.buffer)]));
    process.stdout.write(`\r  ${i + 1}/${scenes.length} built    `);
  }
  console.log(`\ncomposites ready (${((COMPOSITE_BYTES * scenes.length) / 1e6).toFixed(0)} MB)`);
}
