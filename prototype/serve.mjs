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
const fail = (res, code, msg) => {
  // text/plain matters: a body with no content type gets DOWNLOADED by mobile browsers rather
  // than shown, so a plain 404 arrives as a mystery .txt file in the Files app.
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg + '\n');
};

http.createServer((req,res)=>{
  const [pathname, query] = req.url.split('?');
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/tidemap-v2.html';
  const p = path.join(root, rel);
  if (!p.startsWith(root)) return fail(res, 403, 'no');           // no climbing out
  fs.stat(p, (se, st) => {
    // A directory asked for WITHOUT a trailing slash has to be redirected, not just served:
    // index.html's relative URLs (./sw.js, ./manifest.webmanifest) resolve against the parent
    // otherwise, so the app would load and every asset next to it would 404.
    if (!se && st.isDirectory() && !rel.endsWith('/')) {
      res.writeHead(301, { Location: pathname + '/' + (query ? '?' + query : '') });
      return res.end();
    }
    const file = (!se && st.isDirectory()) ? path.join(p, 'index.html') : p;
    fs.readFile(file, (e,b) => {
      if (e) return fail(res, 404, `not found: ${rel}`);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',               // always serve the latest build while iterating
        'Service-Worker-Allowed': '/',
      });
      res.end(b);
    });
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
  console.log('  Open one of these on the iPad, in Safari. Any of them on the same network works —');
  console.log('  a docked laptop answers on its ethernet address and the iPad reaches it via the router.');
  for (const a of nets) {
    console.log(`    ${a.name.padEnd(12)} http://${a.address}:${PORT}/ipad/${isWifi(a.name) ? '  <- try this one first' : ''}`);
  }
  console.log(`\n  The port is ${PORT}, and the trailing slash is optional (it redirects).`);
  console.log('  Use Safari: Chrome on iOS cannot Add to Home Screen.');
});
