import { passwordHash, passwordMatches, newId, tokenHash } from './database.mjs';
import projectPackage from '../package.json' with {type:'json'};
import { catalogMountains } from '../web/js/catalog.js';
import {createNoticeService} from './notices.mjs';
import {createWeatherService} from './weather.mjs';
import {decodeReviewPhoto,reviewPhotoPath,reviewRevision,publicReview,resolveReviewPhotos} from './review-photos.mjs';

class APIError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const assert = (condition, message, status = 400) => { if (!condition) throw new APIError(status, message); };
const mountainValid = id => catalogMountains.some(m => m.id === id);
const textValid = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function calendarValid(date, time) {
  if (typeof date !== 'string' || typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

async function readJSON(request, maxBytes = 3 * 1024 * 1024) {
  assert(request.headers['content-type']?.startsWith('application/json'), 'JSON 요청이 필요합니다.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    assert(size <= maxBytes, '전송 용량이 너무 큽니다.', 413);
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new APIError(400, 'JSON 형식이 올바르지 않습니다.'); }
  assert(input && typeof input === 'object' && !Array.isArray(input), 'JSON 객체가 필요합니다.');
  return input;
}

export function createAPI(db, { publicOrigin = '', weatherService = createWeatherService(), noticeService = createNoticeService() } = {}) {
  const requestCounts = new Map();
  function limit(request) {
    const now = Date.now();
    for (const [key, value] of requestCounts) if (value.until <= now) requestCounts.delete(key);
    const address = request.socket.remoteAddress || 'local';
    const entry = requestCounts.get(address) || { count: 0, until: now + 60000 };
    entry.count++; requestCounts.set(address, entry);
    assert(entry.count <= 20, '잠시 후 다시 시도해 주세요.', 429);
  }
  const cookie = (token, age) => `sangil_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${publicOrigin ? '; Secure' : ''}`;
  // 이 표시는 앱 신원을 증명하지 않습니다. 네이티브 인증도 세션 토큰으로 검사합니다.
  const nativeRequest = request => request.headers['x-sangil-native'] === '1' && !request.headers.origin;
  function requestToken(request) {
    if (nativeRequest(request)) return request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    return request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('sangil_session='))?.slice(15);
  }
  const clearSessionHeaders = request => nativeRequest(request) ? { 'X-Sangil-Token': 'clear' } : { 'Set-Cookie': cookie('', 0) };
  function getUser(request) {
    const token = requestToken(request);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare(`SELECT users.id, users.nickname AS name FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?`).get(tokenHash(token), Date.now()) || null;
  }
  function getPlan(id) {
    const row = db.prepare('SELECT * FROM plans WHERE id=?').get(id);
    if (!row) return null;
    const responses = db.prepare(`SELECT user_id AS userId, nickname AS name, status FROM responses JOIN users ON users.id=responses.user_id WHERE plan_id=? ORDER BY nickname`).all(id);
    return { ...JSON.parse(row.content), id: row.id, ownerId: row.owner_id, responses, storage: 'server' };
  }
  function send(response, status, body, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    response.end(JSON.stringify(body));
  }
  function loginHeaders(userId, request) {
    const token = newId() + newId();
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), userId, Date.now() + 7 * 86400000);
    return nativeRequest(request) ? { 'X-Sangil-Token': token } : { 'Set-Cookie': cookie(token, 604800) + (!publicOrigin && request.socket.encrypted ? '; Secure' : '') };
  }

  return async function handleAPI(request, response) {
    if (!request.url.startsWith('/api/')) return false;
    try {
      const url = new URL(request.url, 'http://localhost');
      const method = request.method;
      if (!['GET', 'HEAD'].includes(method)) {
        // 쿠키 인증을 외부 페이지에서 악용하지 못하도록 출처와 전용 헤더를 확인합니다.
        const expectedOrigin = publicOrigin || `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
        assert((nativeRequest(request) || request.headers.origin === expectedOrigin) && request.headers['x-sangil-request'] === '1', '현재 앱에서 보낸 요청만 처리할 수 있습니다.', 403);
      }
      if (url.pathname === '/api/health' && method === 'GET') { send(response, 200, { mode: publicOrigin ? 'https-server' : 'local-server', version: projectPackage.version }); return true; }
      const noticeMatch=url.pathname.match(/^\/api\/notices\/(knps|seoultrail|citywall)$/);
      if(noticeMatch&&method==='GET'){send(response,200,{notices:await noticeService(noticeMatch[1])});return true;}
      const weatherMatch=url.pathname.match(/^\/api\/weather\/([a-z]+)$/);
      if(weatherMatch&&method==='GET'){send(response,200,{weather:await weatherService(weatherMatch[1])});return true;}
      if (url.pathname === '/api/auth/session' && method === 'GET') {
        const user = getUser(request);
        send(response, 200, { user }, !user && nativeRequest(request) ? clearSessionHeaders(request) : {}); return true;
      }
      if (['/api/auth/register', '/api/auth/login'].includes(url.pathname) && method === 'POST') {
        limit(request);
        const input = await readJSON(request, 4096);
        assert(textValid(input.nickname, 20) && typeof input.password === 'string' && input.password.length >= 8 && input.password.length <= 128, '별명 1~20자와 8~128자 비밀번호가 필요합니다.');
        const nickname = input.nickname.trim().normalize('NFC');
        let user = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
        if (url.pathname.endsWith('register')) {
          assert(!user, '이미 사용 중인 별명입니다.', 409);
          const id = newId(), salt = newId(), hash = await passwordHash(input.password, salt);
          db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, nickname, salt, hash);
          user = { id, nickname };
        } else {
          // 없는 계정도 동일한 키 유도 연산을 수행합니다.
          const valid = user ? await passwordMatches(input.password, user) : (await passwordHash(input.password, 'missing-user'), false);
          assert(valid, '별명 또는 비밀번호를 확인해 주세요.', 401);
        }
        send(response, 200, { user: { id: user.id, name: user.nickname } }, loginHeaders(user.id, request)); return true;
      }
      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        const token = requestToken(request);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
        send(response, 200, { ok: true }, clearSessionHeaders(request)); return true;
      }
      const user = getUser(request);
      if (url.pathname === '/api/account/export' && method === 'GET') {
        assert(user, '로그인이 필요합니다.', 401);
        const plans = db.prepare('SELECT id,content FROM plans WHERE owner_id=?').all(user.id).map(row => ({ ...JSON.parse(row.content), id: row.id }));
        const reviews = db.prepare('SELECT reviews.*,users.nickname FROM reviews JOIN users ON users.id=reviews.owner_id WHERE owner_id=?').all(user.id).map(publicReview);
        const responses = db.prepare('SELECT plan_id AS planId,status FROM responses WHERE user_id=?').all(user.id);
        send(response, 200, { user, plans, reviews, responses, exportedAt: new Date().toISOString(), schemaVersion: 2, photoExport: '후기 사진은 각 후기의 개별 JSON 보관 파일에 포함됩니다. 이 요약의 사진 주소는 서버 삭제 후 사용할 수 없습니다.' }); return true;
      }
      const reviewExport=url.pathname.match(/^\/api\/account\/export\/reviews\/([a-f0-9]{32})$/);
      if(reviewExport&&method==='GET'){
        assert(user,'로그인이 필요합니다.',401);
        const row=db.prepare('SELECT * FROM reviews WHERE id=? AND owner_id=?').get(reviewExport[1],user.id);
        assert(row,'내보낼 후기를 찾을 수 없습니다.',404);
        send(response,200,{schemaVersion:1,type:'sangil-ttara-review-archive',exportedAt:new Date().toISOString(),review:{...JSON.parse(row.content),id:row.id,mountainId:row.mountain_id},note:'사진을 포함한 개인 보관 파일입니다. 공개하거나 다른 사람에게 전달하기 전에 내용을 확인하세요.'});return true;
      }
      if ((url.pathname === '/api/account/password' && method === 'POST') || (url.pathname === '/api/account' && method === 'DELETE')) {
        assert(user, '로그인이 필요합니다.', 401);
        limit(request);
        const input = await readJSON(request, 4096);
        assert(typeof input.password === 'string' && input.password.length <= 128, '현재 비밀번호를 입력해 주세요.');
        const stored = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        assert(await passwordMatches(input.password, stored), '현재 비밀번호를 확인해 주세요.', 403);
        if (method === 'DELETE') {
          assert(input.confirm === '탈퇴', '확인란에 탈퇴를 입력해 주세요.');
          db.exec('BEGIN');
          try {
            db.prepare('DELETE FROM responses WHERE user_id=?').run(user.id);
            db.prepare('DELETE FROM plans WHERE owner_id=?').run(user.id);
            db.prepare('DELETE FROM reviews WHERE owner_id=?').run(user.id);
            db.prepare('DELETE FROM users WHERE id=?').run(user.id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          send(response, 200, { ok: true }, clearSessionHeaders(request)); return true;
        }
        assert(typeof input.newPassword === 'string' && input.newPassword.length >= 8 && input.newPassword.length <= 128 && input.newPassword !== input.password, '새 비밀번호는 기존과 다른 8~128자로 입력해 주세요.');
        const salt = newId(), hash = await passwordHash(input.newPassword, salt);
        db.exec('BEGIN');
        try {
          db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt, hash, user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          const renewedHeaders = loginHeaders(user.id, request);
          db.exec('COMMIT');
          send(response, 200, { ok: true }, renewedHeaders);
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return true;
      }
      if (url.pathname === '/api/plans' && method === 'GET') {
        assert(user, '로그인이 필요합니다.', 401);
        const rows = db.prepare('SELECT DISTINCT plans.id FROM plans LEFT JOIN responses ON responses.plan_id=plans.id WHERE plans.owner_id=? OR responses.user_id=?').all(user.id, user.id);
        send(response, 200, { plans: rows.map(row => getPlan(row.id)) }); return true;
      }
      if (url.pathname === '/api/plans' && method === 'POST') {
        assert(user, '로그인이 필요합니다.', 401);
        const input = await readJSON(request, 8192);
        assert(mountainValid(input.mountainId) && textValid(input.title, 80) && textValid(input.place, 120) && calendarValid(input.date, input.time), '일정의 코스·날짜·시간·장소를 확인해 주세요.');
        const content = { mountainId: input.mountainId, title: input.title.trim(), date: input.date, time: input.time, place: input.place.trim() };
        const id = input.id || newId();
        assert(/^[a-f0-9]{32}$/.test(id),'일정 번호가 올바르지 않습니다.');
        const previous=db.prepare('SELECT owner_id,content FROM plans WHERE id=?').get(id);
        if(previous){assert(previous.owner_id===user.id&&previous.content===JSON.stringify(content),'이미 다른 내용으로 저장된 일정 번호입니다.',409);send(response,200,{plan:getPlan(id)});return true;}
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO plans VALUES(?,?,?)').run(id, user.id, JSON.stringify(content));
          db.prepare('INSERT INTO responses VALUES(?,?,?)').run(id, user.id, 'yes');
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        send(response, 201, { plan: getPlan(id) }); return true;
      }
      const match = url.pathname.match(/^\/api\/plans\/([a-f0-9]{32})(?:\/(response))?$/);
      if (match) {
        const plan = getPlan(match[1]);
        assert(plan, '일정을 찾을 수 없습니다.', 404);
        if (method === 'GET') { send(response, 200, { plan }); return true; }
        assert(user, '로그인이 필요합니다.', 401);
        if (method === 'POST' && match[2]) {
          const input = await readJSON(request, 1024);
          assert(['yes', 'no'].includes(input.status), '참가 응답을 확인해 주세요.');
          db.prepare('INSERT INTO responses VALUES(?,?,?) ON CONFLICT(plan_id,user_id) DO UPDATE SET status=excluded.status').run(plan.id, user.id, input.status);
          send(response, 200, { plan: getPlan(plan.id) }); return true;
        }
        if (method === 'DELETE' && !match[2]) {
          assert(plan.ownerId === user.id, '일정을 만든 사람만 삭제할 수 있습니다.', 403);
          db.prepare('DELETE FROM plans WHERE id=?').run(plan.id);
          send(response, 200, { ok: true }); return true;
        }
      }
      const photoMatch=url.pathname.match(/^\/api\/reviews\/([a-f0-9]{32})\/photos\/([0-2])\/([a-f0-9]{16})$/);
      if(photoMatch&&['GET','HEAD'].includes(method)){
        const row=db.prepare('SELECT content FROM reviews WHERE id=?').get(photoMatch[1]);
        assert(row,'사진을 찾을 수 없습니다.',404);
        const photo=JSON.parse(row.content).photos?.[Number(photoMatch[2])];
        assert(typeof photo==='string'&&reviewPhotoPath(photoMatch[1],Number(photoMatch[2]),photo)===url.pathname,'사진이 변경되었거나 삭제되었습니다.',404);
        const image=decodeReviewPhoto(photo);
        response.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});response.end(method==='HEAD'?undefined:image.bytes);return true;
      }
      const pageMatch=url.pathname.match(/^\/api\/reviews\/page\/(all|[a-z]+)\/(0|[1-9][0-9]{0,14})$/);
      if ((url.pathname === '/api/reviews'||pageMatch) && method === 'GET') {
        const mountainId=pageMatch?.[1]||'all',cursor=Number(pageMatch?.[2]||0),limit=10;
        assert(mountainId==='all'||mountainValid(mountainId),'코스를 확인해 주세요.');
        const rows=db.prepare(`SELECT reviews.*,reviews.rowid AS cursor,nickname FROM reviews JOIN users ON users.id=reviews.owner_id WHERE (?='all' OR mountain_id=?) AND (?=0 OR reviews.rowid<?) ORDER BY reviews.rowid DESC LIMIT ?`).all(mountainId,mountainId,cursor,cursor,limit+1);
        const total=db.prepare("SELECT count(*) AS n FROM reviews WHERE ?='all' OR mountain_id=?").get(mountainId,mountainId).n;
        const page=rows.slice(0,limit);
        send(response, 200, {reviews:page.map(publicReview),total,nextCursor:rows.length>limit?page.at(-1).cursor:null});return true;
      }
      if (url.pathname === '/api/reviews' && method === 'POST') {
        assert(user, '로그인이 필요합니다.', 401);
        const input = await readJSON(request);
        assert(mountainValid(input.mountainId) && textValid(input.text, 1000) && Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5, '후기 내용을 확인해 주세요.');
        const id = input.id || newId();
        assert(/^[a-f0-9]{32}$/.test(id), '후기 번호가 올바르지 않습니다.');
        const old = db.prepare('SELECT * FROM reviews WHERE id=?').get(id);
        assert(!old || old.owner_id === user.id, '본인의 후기만 수정할 수 있습니다.', 403);
        assert(!old||old.mountain_id===input.mountainId,'후기의 코스는 변경할 수 없습니다.');
        const previous=old?JSON.parse(old.content):null;
        const photos=resolveReviewPhotos(input.photos||[],id,previous?.photos||[]);
        const same=previous&&previous.text===input.text.trim()&&previous.rating===input.rating&&JSON.stringify(previous.photos)===JSON.stringify(photos);
        if(same){send(response,200,{review:publicReview({...old,nickname:user.name})});return true;}
        assert(!old||!input.revision||input.revision===reviewRevision(old.content),'다른 화면에서 후기를 수정했습니다. 다시 불러온 뒤 저장해 주세요.',409);
        const content = { text: input.text.trim(), rating: input.rating, photos, date: previous?.date||new Date().toISOString().slice(0, 10),updatedAt:new Date().toISOString() };
        const encoded=JSON.stringify(content);
        const usage=db.prepare('SELECT COALESCE(SUM(length(content)),0) AS n FROM reviews WHERE owner_id=? AND id<>?').get(user.id,id).n;
        assert(usage+Buffer.byteLength(encoded)<=20*1024*1024,'계정의 후기 저장 한도(20MB)를 초과했습니다. 이전 사진을 정리해 주세요.',413);
        db.prepare('INSERT INTO reviews VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content').run(id,user.id,input.mountainId,encoded);
        send(response,200,{review:publicReview({id,owner_id:user.id,mountain_id:input.mountainId,content:encoded,nickname:user.name})});return true;
      }
      const reviewMatch = url.pathname.match(/^\/api\/reviews\/([a-f0-9]{32})$/);
      if (reviewMatch && method === 'DELETE') {
        assert(user, '로그인이 필요합니다.', 401);
        const old = db.prepare('SELECT owner_id FROM reviews WHERE id=?').get(reviewMatch[1]);
        assert(old, '후기를 찾을 수 없습니다.', 404);
        assert(old.owner_id === user.id, '본인의 후기만 삭제할 수 있습니다.', 403);
        db.prepare('DELETE FROM reviews WHERE id=?').run(reviewMatch[1]);
        send(response, 200, { ok: true }); return true;
      }
      throw new APIError(404, '요청한 기능을 찾을 수 없습니다.');
    } catch (error) {
      send(response, error.status || 500, { error: error.status ? error.message : '서버 처리 중 오류가 발생했습니다.' });
    }
    return true;
  };
}
