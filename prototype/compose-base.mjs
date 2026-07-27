import fs from 'fs'; import sharp from 'sharp';
const P = Number(process.argv[2] ?? 5120);
async function rgb(f,w=P,h=P){
  const b = await sharp(f).resize(w,h).removeAlpha().toColourspace('srgb').raw().toBuffer();
  if (b.length !== w*h*3) throw new Error(`${f}: ${b.length} != ${w*h*3}`);
  return b;
}
const linz = await rgb('data/base-linz.jpg');
const sent = await rgb('data/base-hi.jpg');
// Read the pipeline class raster directly rather than the derived field: the field build now
// wants THIS composite (for its city lights), so depending on it here would be circular.
const cls  = await sharp('data/classes.png').extractChannel(0).resize(P,P,{kernel:'nearest'}).raw().toBuffer();
const harb = await sharp('data/harbour-mask.png').extractChannel(0).resize(P,P,{kernel:'nearest'}).raw().toBuffer();

// Put the seam on the COASTLINE, not on the aerial's tile-edge staircase: use the aerial
// everywhere it has data AND the pixel is land / intertidal / inside the harbour; hand the
// open ocean to Sentinel. The boundary is then a natural line and reads as haze, not steps.
const want = Buffer.alloc(P*P);
let have=0, coastal=0;
for (let i=0;i<P*P;i++){
  const covered = (linz[i*3]+linz[i*3+1]+linz[i*3+2]) > 24;
  if (covered) have++;
  const notOpenOcean = cls[i] >= 64 || harb[i] >= 128;   // land, intertidal, nodata, or inside harbour
  want[i] = (covered && notOpenOcean) ? 255 : 0;
  if (want[i]) coastal++;
}
const soft = await sharp(want,{raw:{width:P,height:P,channels:1}}).blur(10*P/4096).extractChannel(0).raw().toBuffer();
const out = Buffer.alloc(P*P*3);
for (let i=0;i<P*P;i++){
  const a = soft[i]/255;
  for(let k=0;k<3;k++) out[i*3+k] = linz[i*3+k]*a + sent[i*3+k]*(1-a);
}
// ---- even out the capture blocks -------------------------------------------------------
// The LINZ mosaic is flown in blocks on different days, so land shows rectangular tone steps
// that read as a patchwork quilt from a distance. Divide each pixel by a heavily blurred
// reference and re-apply the mean: low-frequency tone differences go, local detail stays.
// The reference is blurred over LAND ONLY (blur(L*m)/blur(m)) — including the dark ocean in
// the neighbourhood would put a bright halo along every coastline.
{
  const STRENGTH=0.75, LO=0.72, HI=1.45, SIGMA=34*P/4096;
  const lumB=Buffer.alloc(P*P), mB=Buffer.alloc(P*P);
  let sum=0,n=0;
  for(let i=0;i<P*P;i++){
    const l=0.299*out[i*3]+0.587*out[i*3+1]+0.114*out[i*3+2];
    const isLand=cls[i]===255;
    lumB[i]=isLand?Math.round(l):0; mB[i]=isLand?255:0;
    if(isLand){sum+=l;n++;}
  }
  const mean=sum/Math.max(1,n);
  const blur=b=>sharp(b,{raw:{width:P,height:P,channels:1}}).blur(SIGMA).extractChannel(0).raw().toBuffer();
  const [lb,mb]=await Promise.all([blur(lumB),blur(mB)]);
  let touched=0;
  for(let i=0;i<P*P;i++){
    if(cls[i]!==255) continue;
    const ref=mb[i]>4?(lb[i]*255/mb[i]):mean;
    if(ref<6) continue;
    const g=Math.min(HI,Math.max(LO,Math.pow(mean/ref,STRENGTH)));
    for(let k=0;k<3;k++) out[i*3+k]=Math.min(255,Math.round(out[i*3+k]*g));
    touched++;
  }
  console.log(`tone-flattened ${(100*touched/(P*P)).toFixed(1)}% of the frame (land), mean land luminance ${mean.toFixed(1)}`);
}
// ---- even out the capture blocks over the tidal flats ----------------------------------------
// Same problem, same fix, extended to intertidal (classes.png === 128): the LINZ capture-block
// tone steps are just as present over the flats as over land, and at night the renderer
// multiplies flat luminance onto near-flat colour there, so an untreated step reads as a
// hard-edged pale blob (worst at spring low tide). This is a SEPARATE pass with its OWN
// neighbourhood statistics restricted to intertidal pixels only (blur(V*m)/blur(m) over the
// intertidal mask, exactly like the land pass restricts to land) — land and open-water pixels are
// excluded from both the numerator and denominator, so intertidal is never normalized against
// land or water statistics. That per-class restriction is what keeps a bright/dark halo from
// forming at either the land/flat or flat/water boundary; open-water pixels (cls===0) are never
// touched by this pass.
{
  const STRENGTH=0.75, LO=0.72, HI=1.45, SIGMA=34*P/4096;
  const lumB=Buffer.alloc(P*P), mB=Buffer.alloc(P*P);
  let sum=0,n=0;
  for(let i=0;i<P*P;i++){
    const l=0.299*out[i*3]+0.587*out[i*3+1]+0.114*out[i*3+2];
    const isInter=cls[i]===128;
    lumB[i]=isInter?Math.round(l):0; mB[i]=isInter?255:0;
    if(isInter){sum+=l;n++;}
  }
  const mean=sum/Math.max(1,n);
  const blur=b=>sharp(b,{raw:{width:P,height:P,channels:1}}).blur(SIGMA).extractChannel(0).raw().toBuffer();
  const [lb,mb]=await Promise.all([blur(lumB),blur(mB)]);
  let touched=0;
  for(let i=0;i<P*P;i++){
    if(cls[i]!==128) continue;
    const ref=mb[i]>4?(lb[i]*255/mb[i]):mean;
    if(ref<6) continue;
    const g=Math.min(HI,Math.max(LO,Math.pow(mean/ref,STRENGTH)));
    for(let k=0;k<3;k++) out[i*3+k]=Math.min(255,Math.round(out[i*3+k]*g));
    touched++;
  }
  console.log(`tone-flattened ${(100*touched/(P*P)).toFixed(1)}% of the frame (intertidal), mean intertidal luminance ${mean.toFixed(1)}`);
}

await sharp(out,{raw:{width:P,height:P,channels:3}}).jpeg({quality:82,mozjpeg:true}).toFile('data/base-aerial.jpg');
console.log(`aerial coverage ${(have/(P*P)*100).toFixed(1)}%, used on ${(coastal/(P*P)*100).toFixed(1)}% (land+harbour); rest Sentinel`);
console.log(`data/base-aerial.jpg ${(fs.statSync('data/base-aerial.jpg').size/1024).toFixed(0)} kB at ${P}px`);
