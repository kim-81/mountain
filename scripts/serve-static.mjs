// 외부 패키지가 필요 없는 로컬 미리보기 서버. 내 PC(127.0.0.1)에서만 접속됩니다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
const root=fileURLToPath(new URL('../web/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');const pathname=decodeURIComponent(url.pathname);const target=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(!target.startsWith(root)){res.writeHead(403);res.end();return;}const body=await fs.readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}}).listen(4173,'127.0.0.1',()=>{
  console.log('산길따라 미리보기: http://127.0.0.1:4173');
  if(process.argv.includes('--open')&&process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler','http://127.0.0.1:4173'],()=>{});
});
