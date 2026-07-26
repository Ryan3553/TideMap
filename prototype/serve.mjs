import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
http.createServer((req,res)=>{
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'tidemap-v2.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p,(e,b)=>{ if(e){res.writeHead(404);res.end('nf');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'}); res.end(b); });
}).listen(5179, ()=>console.log('serving prototype on http://localhost:5179'));
