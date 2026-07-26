// Cuts identical geographic windows from every basemap candidate for side-by-side judging.
// Standalone in research/ (not part of prototype/pipeline); loads sharp out of prototype's
// node_modules via createRequire since this file lives outside that package tree.
// Run: node make-crops.mjs   (from this directory)
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const OUTDIR = path.dirname(fileURLToPath(import.meta.url));
const PROTOTYPE = path.resolve(OUTDIR, '../../../prototype');
const require = createRequire(path.join(PROTOTYPE, 'noop.js'));
const sharp = require('sharp');
const DATA = path.join(PROTOTYPE, 'data');
const P_AERIAL = 5120; // base-aerial, base-fused, base-graded, base-fusegrade share this grid
const P_HI = 2800;     // base-hi is the same geographic extent at lower native resolution

// Crop windows in the 5120-grid (fraction of full image, so they translate to any resolution).
const crops = {
  city:     { left: 2650, top: 2850, width: 700, height: 700 }, // Tauranga CBD + Mount Maunganui, bottom-right quarter
  matakana: { left: 900,  top: 900,  width: 700, height: 700 }, // mid Matakana Island barrier
  forest:   { left: 100,  top: 4100, width: 700, height: 700 }, // forest corner, bottom-left
};

const sources = {
  aerial:     `${DATA}/base-aerial.jpg`,
  hi:         `${DATA}/base-hi.jpg`,
  fused:      `${DATA}/base-fused.jpg`,
  graded:     `${DATA}/base-graded.jpg`,
  fusegrade:  `${DATA}/base-fusegrade.jpg`,
};

function scaledBox(box, srcP) {
  const s = srcP / P_AERIAL;
  return {
    left: Math.round(box.left * s), top: Math.round(box.top * s),
    width: Math.round(box.width * s), height: Math.round(box.height * s),
  };
}

for (const [cropName, box] of Object.entries(crops)) {
  const tiles = [];
  for (const [srcName, imgPath] of Object.entries(sources)) {
    const meta = await sharp(imgPath).metadata();
    const b = scaledBox(box, meta.width);
    const out = path.join(OUTDIR, `${cropName}_${srcName}.png`);
    await sharp(imgPath).extract(b).resize(700, 700).toFile(out);
    tiles.push(out);
    console.log(out);
  }
  // contact sheet: 5-across strip, labelled by filename order (aerial, hi, fused, graded, fusegrade)
  const bufs = await Promise.all(tiles.map(f => sharp(f).toBuffer()));
  await sharp({ create: { width: 700 * tiles.length, height: 700, channels: 3, background: '#000' } })
    .composite(bufs.map((b, i) => ({ input: b, left: i * 700, top: 0 })))
    .toFile(path.join(OUTDIR, `${cropName}_strip.png`));
  console.log(`${cropName}_strip.png (order: ${Object.keys(sources).join(', ')})`);
}
