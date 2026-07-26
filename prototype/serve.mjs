// Static server for the prototype. Binds every interface so an iPad on the same wifi can reach
// it — that is how the home-screen app gets tested without a Mac or a host.
import http from 'http'; import fs from 'fs'; import path from 'path'; import os from 'os';
import { fileURLToPath } from 'url';
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5179);
const types = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.png':'image/png', '.jpg':'image/jpeg', '.json':'application/json',
  '.webmanifest':'application/manifest+json',
};
http.createServer((req,res)=>{
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/tidemap-v2.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const p = path.join(root, rel);
  if (!p.startsWith(root)) { res.writeHead(403); res.end('no'); return; }   // no climbing out
  fs.readFile(p, (e,b) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(p)] || 'application/octet-stream',
      'Cache-Control': 'no-store',                 // always serve the latest build while iterating
      'Service-Worker-Allowed': '/',
    });
    res.end(b);
  });
}).listen(PORT, '0.0.0.0', () => {
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  console.log(`serving ${root}`);
  console.log(`  studio   http://localhost:${PORT}/tidemap-v2.html`);
  console.log(`  iPad app http://localhost:${PORT}/ipad/`);
  for (const a of addrs) console.log(`  on wifi  http://${a}:${PORT}/ipad/   <- open this on the iPad`);
});
