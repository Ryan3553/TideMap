// CPU mirror of the stylised shader, to eyeball the palette without WebGL.
import sharp from 'sharp';
const W=1600,H=1200;
const base=await sharp('data/base-nu.jpg').raw().toBuffer();
const fld =await sharp('data/field-nu.png').raw().toBuffer();
const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function render(tide,tidePast,nightMix,moon,contours=1){
  const o=Buffer.alloc(W*H*3);
  for(let i=0;i<W*H;i++){
    const br=base[i*3]/255,bg=base[i*3+1]/255,bb=base[i*3+2]/255;
    const dryH=fld[i*3]/255*2.5, cls=fld[i*3+1], city=fld[i*3+2]/255;
    const lum=0.299*br+0.587*bg+0.114*bb;
    const isSub=cls<64, isInter=cls>=64&&cls<192, isLand=cls>=192;
    const submerged=isSub||(isInter&&tide>=dryH)?1:0;
    const land=mix([0.045,0.082,0.070],[0.175,0.255,0.180],cl((lum-0.03)/0.47,0,1));
    let flat0=mix([0.46,0.48,0.47],[0.97,0.965,0.935],cl((lum-0.03)/0.41,0,1));
    if(tidePast>tide+0.0004&&dryH>=tide&&dryH<=tidePast){
      const wet=1-(dryH-tide)/(tidePast-tide);
      flat0=mix(flat0,flat0.map((v,k)=>v*0.38+[0.045,0.150,0.185][k]),wet);
    }
    const depth=isSub?(1-cl((lum-0.03)/0.31,0,1)):cl((tide-dryH)/1.15,0,1);
    let water = depth<0.5?mix([0.42,0.96,0.98],[0.045,0.44,0.62],depth*2)
                         :mix([0.045,0.44,0.62],[0.006,0.045,0.135],(depth-0.5)*2);
    water=water.map(v=>v*(0.86+0.30*lum));
    // contour approximation: gradient from neighbours
    let lines=0, edge=0;
    if(isInter&&contours){
      const x=i%W,y=(i/W)|0;
      const gx=x<W-1?Math.abs(fld[(i+1)*3]-fld[i*3])/255*2.5:0;
      const gy=y<H-1?Math.abs(fld[(i+W)*3]-fld[i*3])/255*2.5:0;
      const g=Math.max(gx+gy,0.0008);
      const c=dryH/0.075, d=Math.abs(c-Math.floor(c)-0.5);
      lines=1-cl((0.5-d)/(g/0.075*1.1),0,1);
      edge=1-cl(Math.abs(dryH-tide)/(g*2.2),0,1);
    }
    if(submerged) water=water.map((v,k)=>v+[0.30,0.85,0.95][k]*lines*0.30);
    let surface = submerged? water : (isInter?flat0:land);
    const day=1-nightMix;
    const emis=submerged*(0.16+0.52*moon);
    const daylight=surface.map(v=>v*day);
    const night=surface.map((v,k)=>v*(0.05+0.30*moon)+water[k]*emis);
    let col=daylight.map((v,k)=>v+(night[k]-v)*nightMix);
    col=col.map((v,k)=>v+[1.00,0.74,0.40][k]*city*1.55*nightMix);
    col=col.map((v,k)=>v+[0.62,1.00,1.00][k]*edge*(0.34+0.30*nightMix));
    for(let k=0;k<3;k++) o[i*3+k]=Math.pow(cl(col[k],0,1),0.92)*255;
  }
  return o;
}
for(const [n,t,tp,nm,mo] of [['day-ebb',1.20,1.55,0.0,0],['night-full',1.00,1.00,1.0,0.95],['dusk',0.70,1.05,0.55,0.4]]){
  await sharp(render(t,tp,nm,mo),{raw:{width:W,height:H,channels:3}}).jpeg({quality:90}).toFile(`sty_${n}.jpg`);
  console.log('sty_'+n+'.jpg');
}
