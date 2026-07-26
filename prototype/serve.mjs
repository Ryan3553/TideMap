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
}).on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use — another copy of this server is probably still running.`);
    console.error(`  netstat -ano | findstr :${PORT}     then     taskkill /F /PID <pid>`);
    process.exit(1);
  }
  throw e;
}).listen(PORT, '0.0.0.0', () => {
  // Name the adapter. Every machine here has several private IPs and only one of them is the
  // wifi the iPad is on; an unlabelled list of addresses is a guessing game.
  const nets = Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) => (addrs || []).map(a => ({ ...a, name })))
    .filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  const isWifi = n => /wi-?fi|wlan|wireless/i.test(n);
  nets.sort((a, b) => (isWifi(b.name) ? 1 : 0) - (isWifi(a.name) ? 1 : 0));
  console.log(`serving ${root}`);
  console.log(`  studio    http://localhost:${PORT}/tidemap-v2.html`);
  console.log(`  iPad app  http://localhost:${PORT}/ipad/`);
  console.log('');
  for (const a of nets) {
    const tag = isWifi(a.name) ? '  <- OPEN THIS ON THE IPAD (in Safari)' : '';
    console.log(`  ${a.name.padEnd(12)} http://${a.address}:${PORT}/ipad/${tag}`);
  }
  if (!nets.some(a => isWifi(a.name))) console.log('  (no wifi adapter found — use whichever address is on the same network as the iPad)');
  console.log('\n  Note the port: 5179. And use Safari — Chrome on iOS cannot Add to Home Screen.');
});
