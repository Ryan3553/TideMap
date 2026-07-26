import fs from 'fs';
const tide = fs.readFileSync('../tide/tauranga-tide.js','utf8').replace(/^export /gm,'');
const uri = (f,m) => `data:${m};base64,` + fs.readFileSync(f).toString('base64');
const images = {
  'LINZ aerial 0.1 m (2025)': uri('data/base-aerial.jpg','image/jpeg'),
  'Sentinel-2 true colour':   uri('data/base-hi.jpg','image/jpeg'),
};
const html = fs.readFileSync('template-v2.html','utf8')
  .replace('__TIDE_MODULE__', tide)
  .replace('__IMAGES__', JSON.stringify(images))
  .replace('__FIELD__', uri('data/field-hi.png','image/png'));
fs.writeFileSync('tidemap-v2.html', html);
console.log('built', (html.length/1e6).toFixed(2), 'MB');
