import fs from 'fs';
const tide = fs.readFileSync('../tide/tauranga-tide.js','utf8').replace(/^export /gm,'');
const uri = (f,m) => `data:${m};base64,` + fs.readFileSync(f).toString('base64');

// The basemaps and the field go into the DOCUMENT as <img>, not into the module source.
// A multi-megabyte data URI inside <script type="module"> silently never executes in some
// engines — the script element is there, 6.8 M chars long, and nothing ever runs.
const BASEMAPS = [
  ['LINZ aerial (2025)',     'data/base-aerial.jpg', 'image/jpeg'],
  ['Sentinel-2 true colour', 'data/base-hi.jpg',     'image/jpeg'],
];
const tags = BASEMAPS.map(([name,f,m],i)=>
  `<img id="img_base${i}" data-name="${name}" alt="" decoding="async" src="${uri(f,m)}">`)
  .concat(`<img id="img_field" alt="" decoding="async" src="${uri('data/field-v2.png','image/png')}">`)
  .join('\n');

const html = fs.readFileSync('template-v2.html','utf8')
  .replace('__TIDE_MODULE__', tide)
  .replace('__IMG_TAGS__', tags);
if (html.includes('__IMG_TAGS__') || html.includes('__TIDE_MODULE__')) throw new Error('a placeholder was not replaced');
if (/LINZ_KEY|key=[0-9a-f]{20,}/.test(html)) throw new Error('an API key reached the published page');
// lastIndexOf, not a regex: the comment above the assets div quotes the tag literally.
const script = html.slice(html.lastIndexOf('<script type="module">'));
if (script.length > 400000) throw new Error(`module source is ${script.length} chars — payload leaked back into the script`);
fs.writeFileSync('tidemap-v2.html', html);
console.log(`built ${(html.length/1e6).toFixed(2)} MB total, module source ${(script.length/1024).toFixed(0)} kB`);
