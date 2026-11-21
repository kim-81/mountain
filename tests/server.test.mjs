import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../server/database.mjs';
import { createAPI } from '../server/api.mjs';

test('계정·일정·참가·후기의 서버 저장과 권한을 두 세션으로 검증한다', async () => {
  const database = openDatabase(':memory:');
  const api = createAPI(database);
  const server = http.createServer((request, response) => { api(request, response); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = 'GET', body, cookie = '', csrf = true) {
    const response = await fetch(origin + '/api/' + path, {
      method, headers: { 'Content-Type': 'application/json', Origin: csrf ? origin : 'https://other.invalid', 'X-Sangil-Request': '1', Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    const a = await call('auth/register', 'POST', { nickname: '예시등산객A', password: 'sample-password-a' });
    const b = await call('auth/register', 'POST', { nickname: '예시등산객B', password: 'sample-password-b' });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.notEqual(a.data.user.id, b.data.user.id);
    assert.equal((await call('auth/session', 'GET', undefined, a.cookie)).data.user.name, '예시등산객A');
    assert.equal((await call('auth/login', 'POST', { nickname: '예시등산객A', password: 'wrong-password' })).status, 401);
    assert.equal((await call('plans', 'GET')).status, 401);
    const input = { mountainId: 'achasan', title: '토요일 산행', date: '2026-11-14', time: '09:00', place: '예시 역 출구' };
    assert.equal((await call('plans', 'POST', input, a.cookie, false)).status, 403);
    assert.equal((await call('plans', 'POST', { ...input, date: '2026-02-30' }, a.cookie)).status, 400);
    const created = await call('plans', 'POST', input, a.cookie);
    assert.equal(created.status, 201);
    const id = created.data.plan.id;
    assert.equal((await call('plans/' + id + '/response', 'POST', { status: 'yes' }, b.cookie)).status, 200);
    const updated = await call('plans/' + id, 'GET', undefined, a.cookie);
    assert.equal(updated.data.plan.responses.length, 2);
    assert.equal((await call('plans', 'GET', undefined, b.cookie)).data.plans.length, 1);
    assert.equal((await call('plans/' + id, 'DELETE', {}, b.cookie)).status, 403);
    const review = await call('reviews', 'POST', { mountainId: 'achasan', text: '서버 검증용 후기', rating: 5, photos: [] }, a.cookie);
    assert.equal(review.status, 200);
    const reviewId = review.data.review.id;
    assert.equal((await call('reviews', 'GET')).data.reviews[0].text, '서버 검증용 후기');
    assert.equal((await call('reviews/' + reviewId, 'DELETE', {}, b.cookie)).status, 403);
    assert.equal((await call('reviews', 'POST', { id: reviewId, mountainId: 'achasan', text: '다른 사용자 수정', rating: 5, photos: [] }, b.cookie)).status, 403);
    assert.equal((await call('reviews/' + reviewId, 'DELETE', {}, a.cookie)).status, 200);
    assert.equal((await call('plans/' + id, 'DELETE', {}, a.cookie)).status, 200);
    assert.equal(database.prepare('SELECT count(*) AS n FROM responses').get().n, 0);
    const stored = database.prepare('SELECT * FROM users WHERE id=?').get(a.data.user.id);
    assert.notEqual(stored.password_hash, 'sample-password-a');
    await call('auth/logout', 'POST', {}, a.cookie);
    assert.equal((await call('auth/session', 'GET', undefined, a.cookie)).data.user, null);
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); database.close(); }
});
