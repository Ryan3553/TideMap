// Offline reproduction of the fragment shader, so the result can be LOOKED at.
// Same arithmetic as template-v2.html; kept in step by hand. Scratch tool, not shipped.
import fs from 'fs';
import sharp from 'sharp';

const A = Object.fromEntries(process.argv.slice(2).map(s => s.split('=')));
const W = +(A.w ?? 900), H = +(A.h ?? 675);
const zoom = +(A.zoom ?? 0.50), cx = +(A.cx ?? 0.366), cy = +(A.cy ?? 0.46);
const tide = +(A.tide ?? 1.05), light = +(A.light ?? 0.92);
const t = +(A.t ?? 0);
const OUT = A.out ?? '_look.png';

const S = {
  shallow:'#86ccc2', mid:'#2f8fa0', deep:'#124f70', nightDeep:'#3fc8de',
  landDark:'#0b1512', landLight:'#2c4029', dampCol:'#2a2a24', city:'#ffb545', edgeCol:'#e3fbff',
  abyss:'#08131f', pearlCol:'#74858f',
  nightGlow:0.95, nightFall:4.2, cityGain:2.0, edgeGain:0.10,
  depthCurve:1.15, clarity:0.70, dampGain:1.0,
  realism:0.85, groundGain:1.02, groundSat:1.18, landChroma:0.60, landWhite:0.55, edgeWidth:0.035,
  exposure:1.0, gamma:0.92, vignette:0.36,
  shoreGlow:0.50, surfGain:0.12, flatsGlow:0.50, shimmer:0.25, glowM:0.5,
  ...JSON.parse(A.set ?? '{}'),
};
const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
const C = Object.fromEntries(['shallow','mid','deep','nightDeep','landDark','landLight','dampCol','city','edgeCol','abyss','pearlCol']
  .map(k => [k, hex(S[k])]));

const H_LO=-0.75, H_HI=3.25, LO=0.332, HI=2.127;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const mix=(a,b,t)=>a+(b-a)*t;
const mix3=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const frac=x=>x-Math.floor(x);
const hash=(x,y)=>frac(Math.sin(x*127.1+y*311.7)*43758.5453123);
function noise(x,y){
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const a=hash(ix,iy), b=hash(ix+1,iy), c=hash(ix,iy+1), d=hash(ix+1,iy+1);
  const ux=fx*fx*(3-2*fx), uy=fy*fy*(3-2*fy);
  return mix(a,b,ux)+(c-a)*uy*(1-ux)+(d-b)*ux*uy;
}

const baseObj = await sharp('data/base-aerial.jpg').removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
const BP = baseObj.info.width, base = baseObj.data;
const fldObj = await sharp('data/field-v2.png').removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
const FP = fldObj.info.width, fld = fldObj.data;

function samp(buf, P, u, v) {         // bilinear, matching GL_LINEAR
  const x = clamp(u*P-0.5, 0, P-1), y = clamp(v*P-0.5, 0, P-1);
  const x0=Math.floor(x), y0=Math.floor(y), fx=x-x0, fy=y-y0;
  const x1=Math.min(P-1,x0+1), y1=Math.min(P-1,y0+1);
  const o=(yy,xx)=>(yy*P+xx)*3, out=[0,0,0];
  for(let k=0;k<3;k++){
    out[k]=(buf[o(y0,x0)+k]*(1-fx)+buf[o(y0,x1)+k]*fx)*(1-fy)+(buf[o(y1,x0)+k]*(1-fx)+buf[o(y1,x1)+k]*fx)*fy;
    out[k]/=255;
  }
  return out;
}

// light model, matching frame()
const sunAlt = light*40-6;
const day = clamp((sunAlt+6)/11,0,1);
const warm = clamp((12-sunAlt)/18,0,1);
const inten = 0.30+0.70*clamp((sunAlt+4)/26,0,1);
const uDay = day*inten, uNightMix = 1-day, uMoon = +(A.moon ?? 0.7);
const sunTint = [1+0.30*warm, 1-0.05*warm, 1-0.34*warm];
const uTide = clamp(tide,LO,HI), uTidePast = +(A.past ?? uTide);

const aspect = W/H;
const halfW = zoom*aspect*1.0866/2, halfH = zoom/2;
const CX = clamp(cx, halfW, 1-halfW), CY = clamp(cy, halfH, 1-halfH);
const uvOf = (px,py)=>{
  const vx=(px+0.5)/W, vy=(py+0.5)/H;
  return [CX+(vx-0.5)*zoom*aspect*1.0866, CY+(vy-0.5)*zoom];
};
const heightAt=(u,v)=>H_LO+samp(fld,FP,u,v)[0]*(H_HI-H_LO);
const bathyAt=(u,v)=>samp(fld,FP,u,v)[1];

const out = Buffer.alloc(W*H*3);
for(let py=0;py<H;py++) for(let px=0;px<W;px++){
  const [u,v]=uvOf(px,py), o=(py*W+px)*3;
  if(u<0||u>1||v<0||v>1){out[o]=out[o+1]=out[o+2]=0;continue;}
  const b=samp(base,BP,u,v), f=samp(fld,FP,u,v);
  const Hh=H_LO+f[0]*(H_HI-H_LO), bathy=f[1], city=f[2];
  const lum=0.299*b[0]+0.587*b[1]+0.114*b[2];

  const tl=mix(smoothstep(0.02,S.landWhite,lum),clamp(lum,0,1),0.22);
  const palette=mix3(C.landDark,C.landLight,tl);
  const rel=b.map(c=>clamp((c-lum)/Math.max(lum,0.04),-1.2,1.2));
  const stylised=palette.map((p,k)=>p*(1+S.landChroma*rel[k]));
  const real=b.map(c=>mix(lum,c,S.groundSat)*S.groundGain);
  let ground=stylised.map((s,k)=>mix(s,real[k],S.realism));

  const ebb=uTidePast>uTide+0.0004?1:0;
  const band=ebb*(Hh>=uTide?1:0)*(Hh<=uTidePast?1:0);
  const wet=clamp(band*(1-(Hh-uTide)/Math.max(uTidePast-uTide,1e-4))*S.dampGain,0,1);
  ground=ground.map((g,k)=>mix(g,g*0.52+C.dampCol[k]*0.55,wet));

  // fwidth(H) ~ |dH/dx| + |dH/dy| in screen space
  const [u1,v1]=uvOf(px+1,py), [u2,v2]=uvOf(px,py+1);
  const aa=Math.max(Math.abs(heightAt(u1,v1)-Hh)+Math.abs(heightAt(u2,v2)-Hh),0.0015);
  const submerged=smoothstep(-aa,aa,uTide-Hh);
  const sea=1-smoothstep(0.03,0.35,Hh-H_LO);
  const depth=Math.max(clamp((uTide-Hh)/S.depthCurve,0,1),sea*bathy);
  let wcol=depth<0.5?mix3(C.shallow,C.mid,depth*2):mix3(C.mid,C.deep,(depth-0.5)*2);
  const clarity=S.clarity*mix(1,0.18,smoothstep(0.05,0.80,depth));
  wcol=wcol.map(c=>c*mix(1,0.55+0.85*lum,clarity));

  // Living water: a slow 2-octave shimmer, subtle texture rather than sparkle. Night gets the
  // full slider amplitude, day a third of it.
  const nux=u*340.0, nuy=v*340.0/1.0866;
  const shim=noise(nux+t*0.008,nuy)*0.6+noise(nux*2.0,nuy*2.0)*0.4;
  wcol=wcol.map(c=>c*(1+(S.shimmer/3)*(shim-0.5)));

  const surface=ground.map((g,k)=>mix(g,wcol[k],submerged));
  const dh=(uTide-Hh)/Math.max(S.edgeWidth,0.004);
  const edge=Math.exp(-dh*dh);

  // Shoreline rim glow, bleeding into the water from every waterline. Lives in TIDE-HEIGHT space,
  // not bathy's chamfer distance: bathy's isolines facet into octagons around small islands, but
  // a band measured in metres of tide hugs every real waterline and cannot facet.
  let shore=Math.exp(-Math.pow((uTide-Hh)/Math.max(S.glowM,0.02),2))*submerged;
  shore*=1+0.3*S.shimmer*(shim-0.5);

  // Offshore swell: faint contour bands parallel to the ocean beach, drifting slowly shoreward,
  // windowed to open water clear of the shore. The cosine phase reads a 4-tap softened bathy (raw
  // bathy steps texel-to-texel near the island, breaking the bands into dashes); the window and
  // every gate below still read the sharp field.
  const tx=1.5/4096.0;
  const bSoft=(bathyAt(u+tx,v+tx)+bathyAt(u+tx,v-tx)+bathyAt(u-tx,v+tx)+bathyAt(u-tx,v-tx))*0.25;
  let lines=Math.pow(0.5+0.5*Math.cos(bSoft*38.0-t*0.15),6);
  lines*=smoothstep(0.30,0.50,bathy)*(1-smoothstep(0.70,0.95,bathy));
  // fwidth(bathy) guards genuine screen-space aliasing (e.g. zoomed far out).
  const bw=Math.abs(bathyAt(u1,v1)-bathy)+Math.abs(bathyAt(u2,v2)-bathy);
  const linesAA=1-smoothstep(0.3,1.0,38.0*bw);
  // A small island closes bathy's iso-contours into a ring within a few hundred metres, and the
  // chamfer field facets that ring into an octagon — the "full-map contour lines" the owner
  // rejected, reborn at island scale. Probe the gradient direction a short, fixed, WORLD-space
  // distance away (not a screen derivative) and fade the bands out wherever that direction has
  // rotated, i.e. wherever the shore curves tightly instead of running straight.
  const bGx=bathyAt(u+0.004,v)-bathy, bGy=bathyAt(u,v+0.004)-bathy;
  const bGl=Math.hypot(bGx,bGy);
  const tang=bGl>1e-4?[-bGy/bGl,bGx/bGl]:[1,0];
  const bTang=bathyAt(u+tang[0]*0.07,v+tang[1]*0.07);
  const straight=1-smoothstep(0.02,0.12,Math.abs(bTang-bathy));
  lines*=linesAA*straight*(0.15+0.85*uNightMix)*submerged;

  const daylight=surface.map((s,k)=>s*sunTint[k]*uDay);
  const landNight=palette.map((p,k)=>p*(1+0.35*S.landChroma*rel[k]));
  // Night glow is a MONOTONIC decay of a night depth `nd`. `depth` itself cannot be used: on
  // always-wet sentinel water its tide-height term clamps to 1, painting every permanent channel
  // and the near-beach ocean abyss-black. The sentinel side uses bathy instead, blended by `sea`.
  const nd=mix(clamp((uTide-Hh)/S.depthCurve,0,1),bathy,sea);
  const dGlow=Math.exp(-nd*S.nightFall);
  let nightWater=mix3(C.abyss,C.nightDeep,dGlow).map(c=>c*(0.30+0.70*uMoon)*S.nightGlow*mix(1,0.78+0.55*lum,0.35));
  nightWater=nightWater.map(c=>c*(1+S.shimmer*(shim-0.5)));
  let night=landNight.map((l,k)=>mix(l*(0.08+0.28*uMoon),nightWater[k],submerged));

  // Pearlescent flats: exposed intertidal ground, lit by the aerial's own swirl detail rather
  // than flattened to grey — `rel` is the same relative-chroma vector the land already uses. A
  // REPLACEMENT blend, not a max-lift: `pearl` is proportional to `lum`, so dark swirls stay dark.
  const flatBand=(1-submerged)*smoothstep(2.6,2.2,Hh)*smoothstep(-0.1,0.15,Hh+0.75);
  const pearl=C.pearlCol.map((c,k)=>c*lum*(1+0.5*rel[k]));
  night=night.map((n,k)=>mix(n,pearl[k],flatBand*S.flatsGlow*(0.35+0.65*uMoon)));

  const vx=(px+0.5)/W-0.5, vy=(py+0.5)/H-0.5;
  const vig=1-S.vignette*smoothstep(0.42,0.98,Math.hypot(vx,vy));
  for(let k=0;k<3;k++){
    let c=mix(daylight[k],night[k],uNightMix);
    const cityTerm=C.city[k]*(Math.pow(city,1.6)*S.cityGain*1.4)+[1.0,0.95,0.85][k]*Math.pow(city,3)*S.cityGain*0.8;
    c+=cityTerm*uNightMix;
    c+=C.edgeCol[k]*edge*S.edgeGain*(0.45+0.75*uNightMix);
    c+=mix(C.edgeCol[k],C.nightDeep[k],0.6*uNightMix)*shore*S.shoreGlow*(0.35+0.75*uNightMix);
    c+=C.edgeCol[k]*lines*S.surfGain;
    c=1-Math.exp(-c*S.exposure);
    c*=vig;
    out[o+k]=Math.round(255*Math.pow(clamp(c,0,1),S.gamma));
  }
}
await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toFile(OUT);
console.log(`${OUT}  ${W}x${H}  tide ${uTide} light ${light} (sunAlt ${sunAlt.toFixed(1)}, day ${day.toFixed(2)})`);
