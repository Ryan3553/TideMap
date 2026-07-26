// Offline reproduction of the fragment shader, so the result can be LOOKED at.
// Same arithmetic as template-v2.html; kept in step by hand. Scratch tool, not shipped.
import fs from 'fs';
import sharp from 'sharp';

const A = Object.fromEntries(process.argv.slice(2).map(s => s.split('=')));
const W = +(A.w ?? 900), H = +(A.h ?? 675);
const zoom = +(A.zoom ?? 0.50), cx = +(A.cx ?? 0.366), cy = +(A.cy ?? 0.46);
const tide = +(A.tide ?? 1.05), light = +(A.light ?? 0.92);
const t = +(A.t ?? 0);
const dir = +(A.dir ?? 1);           // +1 flood / -1 ebb — mirrors uTideDir
const OUT = A.out ?? '_look.png';
const BASE_FILE = A.base ?? 'data/base-fused.jpg';   // the shipped default basemap

const S = {
  shallow:'#86ccc2', mid:'#2f8fa0', deep:'#124f70', nightDeep:'#3fc8de',
  landDark:'#0b1512', landLight:'#2c4029', dampCol:'#2a2a24', city:'#ffb545', edgeCol:'#e3fbff',
  abyss:'#08131f', pearlCol:'#74858f',
  nightGlow:0.95, nightFall:4.2, cityGain:0.28, edgeGain:0.10,
  depthCurve:1.15, clarity:0.70, dampGain:1.0,
  realism:0.85, groundGain:1.02, groundSat:1.18, landChroma:0.60, landWhite:0.55, edgeWidth:0.035,
  exposure:1.0, gamma:0.92, vignette:0.36,
  shoreGlow:0.50, surfGain:0.12, flatsGlow:0.50, shimmer:0.25, glowM:0.5, flowGain:0.45,
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
// Interleaved gradient noise (Jimenez 2014) — matches ditherIGN() in the shader exactly.
const ditherIGN=(fx,fy)=>frac(52.9829189*frac(fx*0.06711056+fy*0.00583715));

const baseObj = await sharp(BASE_FILE).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
const BP = baseObj.info.width, base = baseObj.data;
// field-v3.png is RGBA: R=height hi byte, G=bathy, B=city, A=height lo byte. Alpha carries real
// data here, NOT transparency — do not removeAlpha().
const fldObj = await sharp('data/field-v3.png').toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
const FP = fldObj.info.width, fld = fldObj.data;
if (fldObj.info.channels !== 4) throw new Error(`field-v3.png expected 4 channels, got ${fldObj.info.channels}`);
const flowObj = await sharp('data/flow.png').removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
const FLP = flowObj.info.width, flow = flowObj.data;

function samp(buf, P, u, v, channels) {   // bilinear, matching GL_LINEAR — base imagery and flow
  const x = clamp(u*P-0.5, 0, P-1), y = clamp(v*P-0.5, 0, P-1);
  const x0=Math.floor(x), y0=Math.floor(y), fx=x-x0, fy=y-y0;
  const x1=Math.min(P-1,x0+1), y1=Math.min(P-1,y0+1);
  const o=(yy,xx)=>(yy*P+xx)*channels, out=new Array(channels).fill(0);
  for(let k=0;k<channels;k++){
    out[k]=(buf[o(y0,x0)+k]*(1-fx)+buf[o(y0,x1)+k]*fx)*(1-fy)+(buf[o(y1,x0)+k]*(1-fx)+buf[o(y1,x1)+k]*fx)*fy;
    out[k]/=255;
  }
  return out;
}

// uField is NEAREST at the hardware level: the 16-bit height packed across R(hi)/A(lo) cannot be
// safely bilinear-filtered by the GPU (independent byte blending seams at every high-byte carry).
// So the bilinear happens HERE, by hand, on the decoded floats — mirrors fieldTexel()/
// sampleField() in the shader exactly.
function fieldTexel(ix, iy) {
  ix = Math.min(FP-1, Math.max(0, ix)); iy = Math.min(FP-1, Math.max(0, iy));
  const o = (iy*FP+ix)*4;
  const code16 = fld[o]*256 + fld[o+3];
  const Hh = H_LO + (code16/65535)*(H_HI-H_LO);
  return [Hh, fld[o+1]/255, fld[o+2]/255];
}
function sampleField(u, v) {              // manual bilinear across 4 exact texels
  const tx = u*FP-0.5, ty = v*FP-0.5;
  const ix = Math.floor(tx), iy = Math.floor(ty), fx = tx-ix, fy = ty-iy;
  const c00=fieldTexel(ix,iy), c10=fieldTexel(ix+1,iy);
  const c01=fieldTexel(ix,iy+1), c11=fieldTexel(ix+1,iy+1);
  const out=[0,0,0];
  for(let k=0;k<3;k++){
    const a=c00[k]+(c10[k]-c00[k])*fx, b=c01[k]+(c11[k]-c01[k])*fx;
    out[k]=a+(b-a)*fy;
  }
  return out;                             // [H, bathy, city]
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
const heightAt=(u,v)=>sampleField(u,v)[0];
const bathyAt=(u,v)=>sampleField(u,v)[1];
// field-v3's G channel carries a faint period-3-row resampling artifact from its NIWA source
// (found by rendering — a real defect in the delivered data). Invisible under a gentle linear
// read of bathy, but the night-glow curve cubes and exponentiates it, amplifying the artifact
// into a visible banded stripe over open water. A dense 3x3 box average of exact texels (no
// need for bilinear precision here) removes it cleanly — mirrors bathySmooth() in the shader.
function bathySmooth(u,v){
  const tx=u*FP-0.5, ty=v*FP-0.5;
  const ix=Math.round(tx), iy=Math.round(ty);
  let sum=0;
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) sum+=fieldTexel(ix+dx,iy+dy)[1];
  return sum/9;
}

const out = Buffer.alloc(W*H*3);
for(let py=0;py<H;py++) for(let px=0;px<W;px++){
  const [u,v]=uvOf(px,py), o=(py*W+px)*3;
  if(u<0||u>1||v<0||v>1){out[o]=out[o+1]=out[o+2]=0;continue;}
  const b=samp(base,BP,u,v,3);
  const fld3=sampleField(u,v);
  let Hh=fld3[0], bathy=fld3[1], city=fld3[2];
  // Dither, applied once right after decode — matches the shader's placement exactly.
  const hDither=(ditherIGN(px+0.5+t*0.7, py+0.5)-0.5)*0.0006;
  Hh += hDither;
  const lum=0.299*b[0]+0.587*b[1]+0.114*b[2];

  // ---- flowing channels ----------------------------------------------------------
  const flowSrc = samp(flow, FLP, u, v, 3);
  const flowAngle = flowSrc[2]*Math.PI*2;
  const flowDir = [Math.cos(flowAngle), Math.sin(flowAngle)];
  const flowU = u + flowDir[0]*0.0020*Math.sin(t*0.06);
  const flowV = v + flowDir[1]*0.0020*Math.sin(t*0.06);
  const flowSample = samp(flow, FLP, flowU, flowV, 3);
  const flowPhase = frac(t*(1/60)*(-dir));
  const flowTri = Math.abs(flowPhase*2-1);
  const flowVal = mix(flowSample[0], flowSample[1], flowTri);
  const flowEffect = mix(-0.15, 0.45, flowVal) * S.flowGain;

  const tl = mix(smoothstep(0.02,S.landWhite,lum),clamp(lum,0,1),0.22);
  const palette = mix3(C.landDark,C.landLight,tl);
  const rel = b.map(c=>clamp((c-lum)/Math.max(lum,0.04),-1.2,1.2));
  const stylised = palette.map((p,k)=>p*(1+S.landChroma*rel[k]));
  const real = b.map(c=>mix(lum,c,S.groundSat)*S.groundGain);
  let ground = stylised.map((s,k)=>mix(s,real[k],S.realism));

  // Damp band: smoothstep, not step() — matches the shader's fix exactly.
  const DAMP_EDGE_M=0.01;
  const ebb=smoothstep(uTide,uTide+0.004,uTidePast);
  const bandLo=smoothstep(uTide-DAMP_EDGE_M,uTide+DAMP_EDGE_M,Hh);
  const bandHi=1-smoothstep(uTidePast-DAMP_EDGE_M,uTidePast+DAMP_EDGE_M,Hh);
  const band=ebb*bandLo*bandHi;
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
  // Flowing channels, daylight share: at most a third of the night strength.
  wcol=wcol.map(c=>c*(1+(flowEffect/3)*submerged));

  const surface=ground.map((g,k)=>mix(g,wcol[k],submerged));
  const dh=(uTide-Hh)/Math.max(S.edgeWidth,0.004);
  const edge=Math.exp(-dh*dh);

  // Shoreline rim glow, bleeding into the water from every waterline. Lives in TIDE-HEIGHT space,
  // not bathy's chamfer distance: bathy's isolines facet into octagons around small islands, but
  // a band measured in metres of tide hugs every real waterline and cannot facet.
  let shore=Math.exp(-Math.pow((uTide-Hh)/Math.max(S.glowM,0.02),2))*submerged;
  shore*=1+0.3*S.shimmer*(shim-0.5);

  // Offshore swell: soft, multi-frequency water texture drifting slowly shoreward, jittered by
  // the same shimmer noise so it doesn't read as a repeating contour. G is now real depth
  // (field-v3): shipping channel/near-shore water sits ~0.5, true open ocean only ~0.9+, so the
  // window is re-derived clear of the channel and fading before the flattest open sea.
  const tx=1.5/FP;
  const bSoft=(bathyAt(u+tx,v+tx)+bathyAt(u+tx,v-tx)+bathyAt(u-tx,v+tx)+bathyAt(u-tx,v-tx))*0.25;
  const jit=(shim-0.5);
  let lines = 0.50*Math.pow(0.5+0.5*Math.cos(bSoft*38.0-t*0.150+jit*0.6),4)
            + 0.30*Math.pow(0.5+0.5*Math.cos(bSoft*61.0-t*0.100-jit*0.9),3)
            + 0.20*Math.pow(0.5+0.5*Math.cos(bSoft*23.0-t*0.220+jit*1.3),5);
  lines*=smoothstep(0.58,0.72,bathy)*(1-smoothstep(0.86,0.97,bathy));
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
  const bTang=bathyAt(u+tang[0]*0.012,v+tang[1]*0.012);
  const straight=1-smoothstep(0.015,0.05,Math.abs(bTang-bathy));
  lines*=linesAA*straight*(0.15+0.85*uNightMix)*submerged;

  const daylight=surface.map((s,k)=>s*sunTint[k]*uDay);
  const landNight=palette.map((p,k)=>p*(1+0.35*S.landChroma*rel[k]));
  // Night glow is a MONOTONIC decay of a night depth `nd`. `depth` itself cannot be used: on
  // always-wet sentinel water its tide-height term clamps to 1, painting every permanent channel
  // and the near-beach ocean abyss-black. The sentinel side uses bathy instead, blended by `sea`.
  // G is now real depth: channel/1km-offshore both read ~0.5 (their true ~16m), 5km offshore
  // ~0.96 — a plain exp(-bathy*nightFall) would have crushed the channel. Cubing keeps the
  // mid-depth water bright while still reaching the abyss offshore.
  const bathyN = bathySmooth(u,v);
  const ndBathy = bathyN*bathyN*bathyN;
  // Blend on H itself, not 'sea' — see the shader comment: the sentinel transition band passed
  // through a clamped bogus tide-depth and ringed every permanent creek/pool dark.
  const nd=mix(clamp((uTide-Hh)/S.depthCurve,0,1),ndBathy,1-smoothstep(0.10,0.40,Hh));
  const dGlow=Math.exp(-nd*S.nightFall);
  let nightWater=mix3(C.abyss,C.nightDeep,dGlow).map(c=>c*(0.30+0.70*uMoon)*S.nightGlow*mix(1,0.78+0.55*lum,0.35));
  nightWater=nightWater.map(c=>c*(1+S.shimmer*(shim-0.5)));
  // Flowing channels, night share: full strength, tied to the same depth decay as the glow.
  nightWater=nightWater.map(c=>c*(1+flowEffect*dGlow));
  let night=landNight.map((l,k)=>mix(l*(0.08+0.28*uMoon),nightWater[k],submerged));

  // Pearlescent flats: exposed intertidal ground, lit by the aerial's own swirl detail rather
  // than flattened to grey — `rel` is the same relative-chroma vector the land already uses. A
  // REPLACEMENT blend, not a max-lift: `pearl` is proportional to `lum`, so dark swirls stay dark.
  const flatBand=(1-submerged)*smoothstep(2.6,2.2,Hh)*smoothstep(-0.1,0.15,Hh+0.75);
  const pearl=C.pearlCol.map((c,k)=>c*(0.18+0.82*lum)*(1+0.5*rel[k]));
  // Wet-margin sheen on the land side of the waterline — kills the dark rim. Mirrors the shader.
  const wetMargin=Math.exp(-(((Hh-uTide)/Math.max(S.glowM,0.02))**2))*(1-submerged);
  const pearlMix=clamp(flatBand*S.flatsGlow*(0.35+0.65*uMoon)+wetMargin*0.75,0,1);
  night=night.map((n,k)=>mix(n,pearl[k],pearlMix)+C.nightDeep[k]*wetMargin*0.10*(0.30+0.70*uMoon));

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
