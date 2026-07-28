// Package the piece as an installable iPad home-screen app (PWA).
//
// There is no second renderer here: ipad/index.html IS tidemap-v2.html. The page detects that
// it was launched from the home screen (navigator.standalone / display-mode: standalone) and
// switches itself to kiosk — no chrome, canvas filling the slab, real-time playback, screen
// wake lock. Run build-v2.mjs first.
//
// Why a PWA and not a native app: building for iOS needs Xcode, which needs a Mac. A native
// wrapper is a WKWebView around this same file and buys nothing for a prototype except the
// build chain. See docs/IPAD.md.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const OUT = 'ipad';
fs.mkdirSync(OUT, { recursive: true });

const page = fs.readFileSync('tidemap-v2.html');
fs.writeFileSync(path.join(OUT, 'index.html'), page);

// ---- icons, cut from the piece itself ------------------------------------------------------
// The Tauranga entrance and Mauao: the most recognisable 3 km of the harbour.
const SRC = 'data/base-aerial.jpg';
const meta = await sharp(SRC).metadata();
const P = meta.width;
const BBOX = { w: 175.93, s: -37.79, e: 176.37, n: -37.41 };
const xOf = lon => Math.round((lon - BBOX.w) / (BBOX.e - BBOX.w) * P);
const yOf = lat => Math.round((BBOX.n - lat) / (BBOX.n - BBOX.s) * P);
const left = xOf(176.135), top = yOf(-37.615), size = xOf(176.225) - left;

const icon = await sharp(SRC).extract({ left, top, width: size, height: size })
  .modulate({ saturation: 1.15 }).toBuffer();
for (const px of [180, 192, 512]) {
  await sharp(icon).resize(px, px).png({ compressionLevel: 9 }).toFile(path.join(OUT, `icon-${px}.png`));
}
// maskable needs the subject inside the safe circle, so pad it in
await sharp(icon).resize(410, 410).extend({ top: 51, bottom: 51, left: 51, right: 51, background: '#03080B' })
  .png({ compressionLevel: 9 }).toFile(path.join(OUT, 'icon-maskable-512.png'));

fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: 'Tauranga Harbour — tide light',
  short_name: 'Tide Light',
  description: 'The real tide, sun and moon over Tauranga Harbour.',
  start_url: './index.html?kiosk=1',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#03080B',
  theme_color: '#03080B',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

// ---- offline ------------------------------------------------------------------------------
// The whole piece is one self-contained file, so caching it is caching the app. Cache-first,
// because an always-on artwork must survive the wifi going away; the version string is the
// build's byte length, so a rebuild invalidates the cache.
const VERSION = `v${page.length}`;
fs.writeFileSync(path.join(OUT, 'sw.js'), `const C='tidelight-${VERSION}';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  // Keep only this build's app cache, but NEVER drop the tile cache — those are the
  // user's cached neighbourhood, and a rebuild must not cost them their offline view.
  for(const k of await caches.keys()) if(k!==C&&k!=='tidelight-tiles') await caches.delete(k);
  await self.clients.claim();
})());});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const isTile=e.request.url.includes('/hires-tiles/');
  e.respondWith((async()=>{
    const cacheName=isTile?'tidelight-tiles':C;
    const hit=await caches.match(e.request,{ignoreSearch:true});
    if(hit) return hit;
    try{ const r=await fetch(e.request);
      if(r.ok||r.status===0){ const c=await caches.open(cacheName); c.put(e.request,r.clone()); }
      return r; }
    catch(err){
      // Offline miss: only a NAVIGATION falls back to the app shell. A missed tile must
      // fail as a 404 — returning HTML would poison the page's image decoder.
      if(e.request.mode==='navigate') return caches.match('./index.html');
      return new Response('',{status:404});
    }
  })());
});
`);

// ---- detail tiles -------------------------------------------------------------------------
// Sync data/hires-tiles into the bundle (incremental: size-match skip). The service worker
// caches tiles lazily as they are viewed — framing a view once while the server is reachable
// makes that view permanently offline (cache 'tidelight-tiles' survives rebuilds).
const TILES_SRC = 'data/hires-tiles';
let tileCount = 0, tileBytes = 0;
const manifest = [];
if (fs.existsSync(TILES_SRC)) {
  for (const z of fs.readdirSync(TILES_SRC)) {
    const srcDir = path.join(TILES_SRC, z), dstDir = path.join(OUT, 'data', 'hires-tiles', z);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    fs.mkdirSync(dstDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      const s = path.join(srcDir, f), d = path.join(dstDir, f);
      const st = fs.statSync(s);
      if (st.size === 0) continue;               // empty = no-tile marker, not worth shipping
      if (!fs.existsSync(d) || fs.statSync(d).size !== st.size) fs.copyFileSync(s, d);
      tileCount++; tileBytes += st.size;
      manifest.push(`data/hires-tiles/${z}/${f}`);
    }
  }
  // The warm-up manifest: the running app pulls EVERY tile through the service worker into
  // the persistent tile cache on first run, so the piece is fully offline afterwards — the
  // owner's requirement: once downloaded, no web streaming, ever.
  fs.mkdirSync(path.join(OUT, 'data', 'hires-tiles'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data', 'hires-tiles', 'manifest.json'), JSON.stringify(manifest));
}

// Register it from the page copy only — the studio build stays a plain single file.
const withSW = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8').replace(
  '</script>\n',
  `</script>
<script>
// Service worker registration needs a secure context: https, or localhost. Over plain http on
// a LAN address it is simply skipped and the app still runs — it just needs the network.
if('serviceWorker' in navigator && window.isSecureContext){
  addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
</script>
`);
fs.writeFileSync(path.join(OUT, 'index.html'), withSW);

const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' kB';
console.log(`ipad/  index.html ${kb('index.html')}  sw ${VERSION}  icons 180/192/512/maskable`);
console.log(tileCount ? `tiles: ${tileCount} synced, ${(tileBytes / 1048576).toFixed(0)} MB (lazy-cached by the SW as viewed)` : 'tiles: none found (detail layer will self-disable)');
console.log('serve it: node serve.mjs   ->  http://<this machine>:5179/ipad/');
