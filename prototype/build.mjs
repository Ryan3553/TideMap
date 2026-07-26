import fs from 'fs';
const tide = fs.readFileSync('../tide/tauranga-tide.js','utf8').replace(/^export /gm,'');
const html = fs.readFileSync('template.html','utf8')
  .replace('__TIDE_MODULE__', tide)
  .replace('__BASE__','data:image/jpeg;base64,'+fs.readFileSync('data/base.jpg').toString('base64'))
  .replace('__FIELD__','data:image/png;base64,'+fs.readFileSync('data/field.png').toString('base64'));
fs.writeFileSync('tidemap-prototype.html', html);
console.log('built', (html.length/1e6).toFixed(2), 'MB');
