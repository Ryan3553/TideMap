import fs from 'fs';
import sharp from 'sharp';

const picks = JSON.parse(fs.readFileSync('picks.json', 'utf8'));

// Whole harbour: Bowentown Heads -> Tauranga city -> Mount Maunganui
const [W_LON, S_LAT, E_LON, N_LAT] = [175.93, -37.79, 176.37, -37.41];
const GRID = 3;            // 3x3 tiles
const TILE = 1300;         // px per tile  -> 3900 x 3900 final (~native 10 m)
const SIZE = GRID * TILE;

const dLon = (E_LON - W_LON) / GRID, dLat = (N_LAT - S_LAT) / GRID;

async function fetchTile(href, gx, gy) {
  const w = W_LON + gx * dLon, e = w + dLon;
  const n = N_LAT - gy * dLat, s = n - dLat;
  const url = `https://titiler.xyz/cog/bbox/${w},${s},${e},${n}/${TILE}x${TILE}.png?url=${href}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 5000) return buf;
    }
    await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error(`tile ${gx},${gy} failed`);
}

fs.mkdirSync('out', { recursive: true });
const manifest = [];
for (const p of picks) {
  const name = `tauranga_${p.tide.toFixed(2).replace('.', 'p')}m_${p.date}.jpg`;
  const jobs = [];
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) jobs.push({ gx, gy });
  const bufs = [];
  for (const j of jobs) bufs.push({ ...j, buf: await fetchTile(p.href, j.gx, j.gy) });

  await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#000' } })
    .composite(bufs.map(b => ({ input: b.buf, left: b.gx * TILE, top: b.gy * TILE })))
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(`out/${name}`);

  const sz = fs.statSync(`out/${name}`).size;
  console.log(`${p.tide.toFixed(2)} m  ${p.date}  cloud ${p.cloud}%  ${SIZE}x${SIZE}  ${(sz / 1e6).toFixed(1)} MB  ${name}`);
  manifest.push({ ...p, file: name, px: SIZE, bytes: sz });
}
fs.writeFileSync('out/manifest.json', JSON.stringify({ bbox: [W_LON, S_LAT, E_LON, N_LAT], px: SIZE, images: manifest }, null, 2));
