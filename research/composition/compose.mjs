import fs from 'fs'; import sharp from 'sharp';
const picks=JSON.parse(fs.readFileSync('picks.json','utf8'));
const [W,S,E,N]=[175.80,-38.00,176.62,-37.30];   // wide: room to rotate into
const G=3, T=1300, SZ=G*T;
const dLon=(E-W)/G, dLat=(N-S)/G;
async function tile(href,gx,gy){
  const w=W+gx*dLon,e=w+dLon,n=N-gy*dLat,s=n-dLat;
  const u=`https://titiler.xyz/cog/bbox/${w},${s},${e},${n}/${T}x${T}.png?url=${href}`;
  for(let a=0;a<4;a++){const r=await fetch(u); if(r.ok){const b=Buffer.from(await r.arrayBuffer()); if(b.length>5000) return b;} await new Promise(z=>setTimeout(z,1200*(a+1)));}
  throw new Error('tile fail '+gx+','+gy);
}
for(const p of picks.filter(p=>[0.31,2.00].includes(p.tide))){
  const parts=[];
  for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++) parts.push({gx,gy,buf:await tile(p.href,gx,gy)});
  const full=await sharp({create:{width:SZ,height:SZ,channels:3,background:'#000'}})
    .composite(parts.map(b=>({input:b.buf,left:b.gx*T,top:b.gy*T}))).png().toBuffer();
  const rot=await sharp(full).rotate(-38,{background:'#000'}).toBuffer();
  const m=await sharp(rot).metadata();
  // 4:3 crop, centred, sized to stay inside the rotated square's inscribed circle
  const R=SZ/2, h=Math.floor(2*R/Math.hypot(4/3,1)*0.995), w=Math.round(h*4/3);
  const name=`compose_${p.tide.toFixed(2).replace('.','p')}m.jpg`;
  await sharp(rot).extract({left:Math.round((m.width-w)/2),top:Math.round((m.height-h)/2),width:w,height:h})
    .resize(2400).jpeg({quality:90}).toFile(name);
  console.log(name,'from',w+'x'+h,'of',m.width+'x'+m.height);
}
