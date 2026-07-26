import fs from 'fs'; import sharp from 'sharp';
const W=1400,H=1050;
const base=await sharp('data/base.jpg').raw().toBuffer();
const fld =await sharp('data/field.png').raw().toBuffer();
function render(tide,tidePast,damp=1){
  const o=Buffer.alloc(W*H*3);
  for(let i=0;i<W*H;i++){
    const br=base[i*3]/255,bg=base[i*3+1]/255,bb=base[i*3+2]/255;
    const dryH=fld[i*3]/255*2.5, cls=fld[i*3+1];
    const lum=0.299*br+0.587*bg+0.114*bb;
    const isSub=cls<64, isInter=cls>=64&&cls<192;
    const submerged=isSub||(isInter&&tide>=dryH);
    let r,g,b;
    if(submerged){
      const deep=[0.015,0.062,0.088], sh=[0.085,0.235,0.245];
      let c;
      if(isSub){const t=Math.max(0,Math.min(1,(lum-0.04)/0.28)); c=deep.map((d,k)=>d+(sh[k]-d)*t);}
      else {const d=Math.max(0,Math.min(1,(tide-dryH)/1.3)); c=sh.map((s,k)=>s+(deep[k]-s)*d);}
      const m=0.80+0.42*lum; [r,g,b]=c.map(v=>v*m);
    } else {
      let gr=[br*1.06,bg*1.06,bb*1.06];
      if(damp&&tidePast>tide+0.0005&&dryH>=tide&&dryH<=tidePast){
        const wet=1-(dryH-tide)/(tidePast-tide);
        gr=gr.map((v,k)=>v*(1-wet)+ (v*0.52+[0.085,0.235,0.245][k]*0.16)*wet);
      }
      [r,g,b]=gr;
    }
    o[i*3]=Math.min(255,r*255); o[i*3+1]=Math.min(255,g*255); o[i*3+2]=Math.min(255,b*255);
  }
  return o;
}
for(const [name,t,tp] of [['low',0.55,0.55],['mid-ebb',1.15,1.45],['mid-flood',1.15,0.85],['high',1.95,1.95]]){
  await sharp(render(t,tp),{raw:{width:W,height:H,channels:3}}).jpeg({quality:88}).toFile(`check_${name}.jpg`);
  console.log('check_'+name+'.jpg  tide',t,'past',tp);
}
