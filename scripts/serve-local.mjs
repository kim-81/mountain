// Node.js 24 내장 HTTP·SQLite만 사용합니다. 외부 웹 프레임워크는 없습니다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { openDatabase } from '../server/database.mjs';
import { createAPI } from '../server/api.mjs';
import { serverConfig } from '../server/config.mjs';
import { requestHostAllowed } from '../server/request-host.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const config = serverConfig();
const storage = config.dataDirectory;
await fs.mkdir(storage, { recursive: true });
const database = openDatabase(path.join(storage, 'sangil.sqlite'));
const handleAPI = createAPI(database, config);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

const server = http.createServer(async (request, response) => {
  if (!requestHostAllowed(request, config)) { response.writeHead(403); response.end('Host not allowed'); return; }
  if (await handleAPI(request, response)) return;
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403); response.end(); return; }
    const body = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(config.port, config.host, () => {
  console.log(`산길따라: ${config.publicOrigin || `http://127.0.0.1:${config.port}`}`);
  console.log('계정·일정·후기는 지정된 데이터 폴더의 sangil.sqlite에 저장됩니다.');
  if (process.argv.includes('--open') && process.platform === 'win32') execFile('rundll32.exe', ['url.dll,FileProtocolHandler', config.publicOrigin || `http://127.0.0.1:${config.port}`], () => {});
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `${config.port} 포트가 사용 중입니다. 이전 실행을 종료해 주세요.` : error.message); database.close(); process.exitCode = 1; });
process.on('SIGINT', () => server.close(() => { database.close(); process.exit(0); }));
process.on('SIGTERM', () => server.close(() => { database.close(); process.exit(0); }));
