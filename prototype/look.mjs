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
  shallow:'#8fd6ca', mid:'#2c8ca2', deep:'#0d4066', nightDeep:'#3fc8de',
  landDark:'#0b1512', landLight:'#2c4029', dampCol:'#2a2a24', city:'#ffb545', edgeCol:'#e3fbff',
  abyss:'#08131f', pearlCol:'#74858f',
  nightGlow:0.95, nightFall:4.2, cityGain:0.28, edgeGain:0.10,
  depthCurve:1.15, clarity:0.70, dampGain:1.0,
  realism:0.85, groundGain:1.02, groundSat:1.18, landChroma:0.60, landWhite:0.55, edgeWidth:0.035,
  relief:0.4, flatsWarm:0.90,
  exposure:1.0, gamma:0.92, vignette:0.36,
  shoreGlow:0.50, surfGain:0.16, flatsGlow:0.50, shimmer:0.25, glowM:0.5, flowGain:0.85, sparks:0.35,
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
const relObj = await sharp('data/relief.png').removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
const RP = relObj.info.width, relief = relObj.data;

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
const inten = 0.36+0.64*clamp((sunAlt+4)/24,0,1);
const uDay = day*inten, uNightMix = 1-day, uMoon = +(A.moon ?? 0.7);
const sunTint = [1+0.40*warm, 1-0.04*warm, 1-0.42*warm];
// relief raking light, matching frame(): az= overrides the slider-mode fixed NE azimuth
const sunAz = +(A.az ?? 65);
const rakeWin = clamp((sunAlt+4)/8,0,1)*(1-clamp((sunAlt-12)/18,0,1));
const reliefAmt = S.relief*rakeWin;
// Morning/evening haze and golden-hour windows — mirror frame() exactly.
const hazeAmt = clamp((10-sunAlt)/14,0,1)*clamp((sunAlt+5)/6,0,1);
const goldAmt = clamp((14-sunAlt)/12,0,1)*clamp((sunAlt+3)/5,0,1);
const sunDirX = Math.sin(sunAz*Math.PI/180), sunDirY = Math.cos(sunAz*Math.PI/180);
const uTide = clamp(tide,LO,HI), uTidePast = +(A.past ?? uTide);
// Tide RATE, 0 at the turns and 1 at mid-tide — mirrors frame(). Drives flow speed/strength.
const tideRate = Math.sin(Math.PI*clamp((uTide-LO)/(HI-LO),0,1));
// uFlowPhase is integrated in JS in the page; reproduce its value at animation time t.
const flowPhaseG = t*tideRate*dir*(1/36);

// Constant water-ramp endpoints — mirrors the shader's wShore/wDeepO/channel colour.
const W_SHORE = C.shallow.map((c,k)=>c*[1.02,1.10,1.06][k]+[0.0,0.02,0.01][k]);
const W_DEEPO = C.deep.map((c,k)=>c*[0.40,0.52,0.72][k]);
const CHAN_COL = mix3(C.mid,C.deep,0.60).map((c,k)=>c*[0.72,0.96,1.30][k]);

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
  const ix=Math.floor(tx), iy=Math.floor(ty);   // floor, matching the shader's base texel exactly
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
  // gl_FragCoord.y is bottom-origin in GL — flip the row so the hash argument matches.
  const hDither=(ditherIGN(px+0.5+t*0.7, H-py-0.5)-0.5)*0.0006;
  Hh += hDither;
  const lum=0.299*b[0]+0.587*b[1]+0.114*b[2];

  // Hoisted to match the shader: the daylight ground grade needs the water/exposed split,
  // the shimmer noise, the intertidal band and the relief sample before water colour exists.
  const [u1,v1]=uvOf(px+1,py), [u2,v2]=uvOf(px,py+1);
  const aa=Math.max(Math.abs(heightAt(u1,v1)-Hh)+Math.abs(heightAt(u2,v2)-Hh),0.0015)
          +0.10*(1-smoothstep(0.38,0.55,uTide));   // soft waterline near the fitted floor
  const submerged=smoothstep(-aa,aa,uTide-Hh);
  const nux=u*340.0, nuy=v*340.0/1.0866;
  const shim=noise(nux+t*0.045,nuy)*0.6+noise(nux*2.0,nuy*2.0)*0.4;
  const flatBand=(1-submerged)*smoothstep(2.6,2.2,Hh)*smoothstep(-0.1,0.15,Hh+0.75);
  const rg=samp(relief,RP,u,v,3);
  const ocean=rg[2];                 // baked open-coast mask: 1 on the Pacific, 0 in harbour

  // ---- flowing channels ----------------------------------------------------------
  // Two-copy scroll, mirroring the shader exactly: sample the same streamline at two offsets
  // half a cycle apart and crossfade on the sawtooth. uFlowPhase is signed and integrated in
  // JS from the tide rate; here it is reproduced as t*tideRate*dir/36.
  const flowSrc = samp(flow, FLP, u, v, 3);
  const flowAngle = flowSrc[2]*Math.PI*2;
  const flowDir = [Math.cos(flowAngle), Math.sin(flowAngle)];
  const FLOW_DIST=0.012;
  const f1=frac(flowPhaseG), f2=frac(flowPhaseG+0.5);
  const a1=samp(flow, FLP, u-flowDir[0]*f1*FLOW_DIST, v-flowDir[1]*f1*FLOW_DIST, 3)[0];
  const a2=samp(flow, FLP, u-flowDir[0]*f2*FLOW_DIST, v-flowDir[1]*f2*FLOW_DIST, 3)[0];
  const flowVal=mix(a1,a2,Math.abs(f1*2-1));
  const flowEffect=mix(-0.30,0.75,flowVal)*S.flowGain*(0.20+0.80*tideRate);
  // Tide sparks — mirrors the shader: sparse glints advected along flowDir by the signed
  // flow phase, two-copy crossfade, confined to moving water by flowVal.
  const spx=u*1400.0, spy=v*1400.0/1.0866;
  const sp1=frac(flowPhaseG*1.7), sp2=frac(flowPhaseG*1.7+0.5);
  const spark=mix(Math.pow(noise(spx-flowDir[0]*sp1*10.0,spy-flowDir[1]*sp1*10.0),18),
                  Math.pow(noise(spx-flowDir[0]*sp2*10.0,spy-flowDir[1]*sp2*10.0),18),
                  Math.abs(sp1*2-1))*flowVal*S.sparks;

  const tl = mix(smoothstep(0.02,S.landWhite,lum),clamp(lum,0,1),0.22);
  const palette = mix3(C.landDark,C.landLight,tl);
  const rel = b.map(c=>clamp((c-lum)/Math.max(lum,0.04),-1.2,1.2));
  const stylised = palette.map((p,k)=>p*(1+S.landChroma*rel[k]));
  const real = b.map(c=>mix(lum,c,S.groundSat)*S.groundGain);
  let ground = stylised.map((s,k)=>mix(s,real[k],S.realism));
  // raking-light land relief — exact mirror of the shader term
  if (reliefAmt > 0.001) {
    const gx=(rg[0]*2-1)*1.5, gy=(rg[1]*2-1)*1.5;
    const rake=(-gx*sunDirX-gy*sunDirY)/Math.sqrt(1+gx*gx+gy*gy);
    ground=ground.map(g=>g*(1+reliefAmt*rake));
  }

  // Exposed intertidal by day: sand/silt/shell chroma remap on the aerial's own luminance —
  // mirrors the shader's sand grade exactly.
  const sandT=smoothstep(0.06,0.72,lum);
  let sand=[mix(0.40,0.80,sandT),mix(0.37,0.76,sandT),mix(0.33,0.68,sandT)];
  const goldT=0.45*smoothstep(0.15,0.50,lum)*(1-smoothstep(0.50,0.80,lum));
  sand=[mix(sand[0],0.68,goldT),mix(sand[1],0.60,goldT),mix(sand[2],0.44,goldT)];
  const grain=1+0.05*(noise(nux*2.3,nuy*2.3)-0.5);
  sand=sand.map((s,k)=>s*(1+0.28*rel[k])*grain);
  const sandMixA=S.flatsWarm*flatBand*(1-uNightMix)*S.realism;
  ground=ground.map((g,k)=>mix(g,sand[k],sandMixA));
  // Wet-edge reflection on the RISING tide — mirrors the shader.
  const wetEdge=Math.exp(-(((Hh-uTide)/0.045)**2))*(1-submerged)*Math.max(dir,0);
  ground=ground.map((g,k)=>g+[0.055,0.062,0.066][k]*wetEdge*(1-uNightMix));
  // Golden-hour sheen on the wet flats — mirrors the shader.
  ground=ground.map((g,k)=>g+sunTint[k]*[0.18,0.15,0.10][k]*goldAmt*flatBand);

  // Damp band: smoothstep, not step() — matches the shader's fix exactly.
  const DAMP_EDGE_M=0.01;
  const ebb=smoothstep(uTide,uTide+0.004,uTidePast);
  const bandLo=smoothstep(uTide-DAMP_EDGE_M,uTide+DAMP_EDGE_M,Hh);
  const bandHi=1-smoothstep(uTidePast-DAMP_EDGE_M,uTidePast+DAMP_EDGE_M,Hh);
  const band=ebb*bandLo*bandHi;
  const wet=clamp(band*(1-(Hh-uTide)/Math.max(uTidePast-uTide,1e-4))*S.dampGain,0,1);
  ground=ground.map((g,k)=>mix(g,g*0.52+C.dampCol[k]*0.55,wet));

  // ---- water — mirrors the shader's continuous ramp/channel/ocean treatment ------
  // Day-depth blend on H into smoothed real bathy (same class as the night-glow fix) —
  // mirrors the shader exactly, including the widened ramp overlaps.
  // ONE physical depth scale in metres — mirrors the shader exactly, including the exact
  // inversion of the G-channel depth encode and the tide stage over the MSL bed.
  const bathyN=bathySmooth(u,v);
  const dFit=uTide-Hh;
  let dReal;
  if(bathyN<0.5) dReal=15.0*Math.pow(Math.max(2*bathyN,0),1.66667);
  else { const s2=clamp((bathyN-0.5)*2,0,1);
         dReal=15.0+25.0*(0.5-Math.sin(Math.asin(1-2*s2)/3)); }
  dReal+=uTide-1.107;
  const deepMixT=1-smoothstep(0.10,0.40,Hh);
  const dm=Math.max(mix(dFit,dReal,deepMixT),0)*(1.15/S.depthCurve);
  const depth=1-Math.exp(-dm/5.0);
  let wcol=mix3(W_SHORE,C.shallow,smoothstep(0.0,1.0,dm));
  wcol=mix3(wcol,C.mid,smoothstep(0.7,3.5,dm));
  wcol=mix3(wcol,C.deep,smoothstep(3.0,10.0,dm));
  wcol=mix3(wcol,W_DEEPO,ocean*smoothstep(8.0,25.0,dm));
  const chan=(1-ocean)*deepMixT*smoothstep(0.16,0.36,bathyN)*(1-smoothstep(8.0,14.0,dm));
  wcol=mix3(wcol,CHAN_COL,chan*0.70);
  const mvx=(u-0.563)*1.0866, mvy=v-0.592;
  const mouthLift=1+0.14*Math.exp(-(mvx*mvx+mvy*mvy)/0.0012);
  wcol=wcol.map(c=>c*mouthLift);
  const clarity=S.clarity*mix(1,0.18,smoothstep(0.05,0.80,depth))*(1-0.85*ocean);
  wcol=wcol.map(c=>c*mix(1,0.52+0.68*lum,clarity));

  wcol=wcol.map(c=>c*(1+(S.shimmer/3)*(shim-0.5)));
  // Caustics in genuinely shallow water by day; a broad slow breath on the open ocean.
  const ca=noise(nux*1.7+t*0.055,nuy*1.7+t*0.031)*noise(nux*1.1-t*0.043,nuy*1.1);
  wcol=wcol.map(c=>c*(1+0.22*smoothstep(0.30,0.80,ca)*smoothstep(0.30,0.04,depth)*(1-uNightMix)));
  const ob=noise(u*26.0+t*0.012,v*26.0+t*0.007);
  wcol=wcol.map(c=>c*(1+0.04*ocean*(ob-0.5)));
  // Golden hour: warm sky mirror on the water, shimmer-swept — mirrors the shader's lerp.
  wcol=wcol.map((c,k)=>mix(c,sunTint[k]*[0.62,0.50,0.38][k],goldAmt*(0.22+0.30*shim)*(1-0.55*smoothstep(0.30,0.80,depth))));
  // Flowing channels, daylight share — mirrors the shader's 0.45.
  wcol=wcol.map(c=>c*(1+(flowEffect*0.45)*submerged));
  wcol=wcol.map(c=>c*(1+spark*0.6));

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
  let lines = 0.50*Math.pow(0.5+0.5*Math.cos(bSoft*110.0+t*0.30+jit*0.6),4)
            + 0.30*Math.pow(0.5+0.5*Math.cos(bSoft*175.0+t*0.20-jit*0.9),3)
            + 0.20*Math.pow(0.5+0.5*Math.cos(bSoft*68.0+t*0.44+jit*1.3),5);
  // Surf in the OPEN-COAST shoaling band (beach to ~9 m), gated by the baked ocean mask so
  // it can never paint the harbour channels — mirrors the shader.
  lines*=ocean*smoothstep(0.03,0.10,bathy)*(1-smoothstep(0.26,0.40,bathy));
  // fwidth(bathy) guards genuine screen-space aliasing (e.g. zoomed far out).
  const bw=Math.abs(bathyAt(u1,v1)-bathy)+Math.abs(bathyAt(u2,v2)-bathy);
  const linesAA=1-smoothstep(0.3,1.0,110.0*bw);
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
  // Swell is only visible where it feels the bottom — mirrors the shader's shoal gate.
  const shoal=smoothstep(0.004,0.016,bGl);
  lines*=linesAA*straight*shoal*(0.45+0.55*uNightMix)*submerged;

  const daylight=surface.map((s,k)=>s*sunTint[k]*uDay);
  // Wide-softened aerial luminance for the night terms — kills the LINZ capture-block tone
  // steps that pearl/nightWater otherwise reprint as blocky patches. Mirrors the shader.
  const LT=0.0023;
  const bSm=[0,1,2].map(k=>(samp(base,BP,u+LT,v+LT,3)[k]+samp(base,BP,u+LT,v-LT,3)[k]
                           +samp(base,BP,u-LT,v-LT,3)[k]+samp(base,BP,u-LT,v+LT,3)[k])*0.25);
  const lumSoft=mix(0.299*bSm[0]+0.587*bSm[1]+0.114*bSm[2],lum,0.35);
  const landNight=palette.map((p,k)=>p*(1+0.35*S.landChroma*rel[k]));
  // Night glow is a MONOTONIC decay of a night depth `nd`. `depth` itself cannot be used: on
  // always-wet sentinel water its tide-height term clamps to 1, painting every permanent channel
  // and the near-beach ocean abyss-black. The sentinel side uses bathy instead, blended by `sea`.
  // G is now real depth: channel/1km-offshore both read ~0.5 (their true ~16m), 5km offshore
  // ~0.96 — a plain exp(-bathy*nightFall) would have crushed the channel. Cubing keeps the
  // mid-depth water bright while still reaching the abyss offshore.
  // Night glow on the same metres scale as the day ramp — mirrors the shader exactly.
  const nd=0.18*(1-Math.exp(-dm/1.5))+0.82*smoothstep(10.0,38.0,dm);
  const dGlow=Math.exp(-nd*S.nightFall);
  let nightWater=mix3(C.abyss,C.nightDeep,dGlow).map(c=>c*(0.30+0.70*uMoon)*S.nightGlow*mix(1,0.78+0.55*lumSoft,0.35));
  nightWater=nightWater.map(c=>c*(1+S.shimmer*(shim-0.5)));
  // Flowing channels, night share: full strength, tied to the same depth decay as the glow.
  nightWater=nightWater.map(c=>c*(1+flowEffect*dGlow));
  nightWater=nightWater.map(c=>c*(1+spark*1.6));
  let night=landNight.map((l,k)=>mix(l*(0.08+0.28*uMoon),nightWater[k],submerged));

  // Pearlescent flats: exposed intertidal ground, lit by the aerial's own swirl detail rather
  // than flattened to grey — `rel` is the same relative-chroma vector the land already uses. A
  // REPLACEMENT blend, not a max-lift: `pearl` is proportional to `lum`, so dark swirls stay dark.
  // flatBand is hoisted near the top of the loop — the daylight sand grade shares it.
  const pearl=C.pearlCol.map((c,k)=>c*(0.30+0.70*lumSoft)*(1+0.5*rel[k]));
  // Wet-margin sheen on the land side of the waterline — kills the dark rim. Mirrors the shader.
  const wetMargin=Math.exp(-(((Hh-uTide)/0.13)**2))*(1-submerged);
  const pearlMix=clamp(flatBand*S.flatsGlow*(0.35+0.65*uMoon)+wetMargin*0.75,0,1);
  night=night.map((n,k)=>mix(n,pearl[k],pearlMix)+C.nightDeep[k]*wetMargin*0.10*(0.30+0.70*uMoon));

  const vx=(px+0.5)/W-0.5, vy=(py+0.5)/H-0.5;
  const vig=1-S.vignette*smoothstep(0.42,0.98,Math.hypot(vx,vy));
  // Daylight waterline is a neutral irregular sheen, night keeps the luminous preset colour;
  // surf foams white by day; morning haze veils the water — all mirror the shader.
  const edgeIrr=0.60+0.80*noise(nux*0.9,nuy*0.9+t*0.02);
  const wlGate=clamp(4*submerged*(1-submerged),0,1);
  for(let k=0;k<3;k++){
    let c=mix(daylight[k],night[k],uNightMix);
    const cityTerm=C.city[k]*(Math.pow(city,1.6)*S.cityGain*1.4)+[1.0,0.95,0.85][k]*Math.pow(city,3)*S.cityGain*0.8;
    c+=cityTerm*uNightMix;
    c+=mix(sunTint[k]*0.85,mix(C.edgeCol[k],C.nightDeep[k],0.45),uNightMix)
      *edge*edgeIrr*S.edgeGain*(0.30+0.55*hazeAmt+0.65*uNightMix)*mix(1,wlGate,uNightMix);
    c+=mix(C.edgeCol[k],C.nightDeep[k],0.6*uNightMix)*shore*S.shoreGlow*(0.04+1.0*uNightMix);
    c+=mix([0.90,0.94,0.93][k],C.edgeCol[k],uNightMix)*lines*S.surfGain;
    c=mix(c,[0.60,0.68,0.73][k]*Math.max(uDay,0.12),hazeAmt*0.16*submerged);
    c=1-Math.exp(-c*S.exposure);
    c*=vig;
    out[o+k]=Math.round(255*Math.pow(clamp(c,0,1),S.gamma));
  }
}
await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toFile(OUT);
console.log(`${OUT}  ${W}x${H}  tide ${uTide} light ${light} (sunAlt ${sunAlt.toFixed(1)}, day ${day.toFixed(2)})`);
