import fs from 'fs'; import sharp from 'sharp';
const P = 4096;
async function rgb(f,w=P,h=P){
  const b = await sharp(f).resize(w,h).removeAlpha().toColourspace('srgb').raw().toBuffer();
  if (b.length !== w*h*3) throw new Error(`${f}: ${b.length} != ${w*h*3}`);
  return b;
}
const linz = await rgb('data/base-linz.jpg');
const sent = await rgb('data/base-hi.jpg');
// class plane (G) and harbour mask, upsampled to the composite grid
const fld  = await rgb('data/field-hi.png');
const harb = await sharp('data/harbour-mask.png').extractChannel(0).resize(P,P,{kernel:'nearest'}).raw().toBuffer();

// Put the seam on the COASTLINE, not on the aerial's tile-edge staircase: use the aerial
// everywhere it has data AND the pixel is land / intertidal / inside the harbour; hand the
// open ocean to Sentinel. The boundary is then a natural line and reads as haze, not steps.
const want = Buffer.alloc(P*P);
let have=0, coastal=0;
for (let i=0;i<P*P;i++){
  const covered = (linz[i*3]+linz[i*3+1]+linz[i*3+2]) > 24;
  if (covered) have++;
  const cls = fld[i*3+1];
  const notOpenOcean = cls >= 64 || harb[i] >= 128;   // land, intertidal, or inside harbour
  want[i] = (covered && notOpenOcean) ? 255 : 0;
  if (want[i]) coastal++;
}
const soft = await sharp(want,{raw:{width:P,height:P,channels:1}}).blur(10).extractChannel(0).raw().toBuffer();
const out = Buffer.alloc(P*P*3);
for (let i=0;i<P*P;i++){
  const a = soft[i]/255;
  for(let k=0;k<3;k++) out[i*3+k] = linz[i*3+k]*a + sent[i*3+k]*(1-a);
}
await sharp(out,{raw:{width:P,height:P,channels:3}}).jpeg({quality:76,mozjpeg:true}).toFile('data/base-aerial.jpg');
console.log(`aerial coverage ${(have/(P*P)*100).toFixed(1)}%, used on ${(coastal/(P*P)*100).toFixed(1)}% (land+harbour); rest Sentinel`);
console.log(`data/base-aerial.jpg ${(fs.statSync('data/base-aerial.jpg').size/1024).toFixed(0)} kB`);
