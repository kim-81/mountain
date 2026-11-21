import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../server/database.mjs';
import { createAPI } from '../server/api.mjs';
import { serverConfig } from '../server/config.mjs';

test('운영 설정은 HTTPS 원점만 허용하며 서버는 루프백에 유지한다', () => {
  assert.equal(serverConfig({}).host, '127.0.0.1');
  assert.equal(serverConfig({ SANGIL_PUBLIC_ORIGIN: 'https://trail.example.com', SANGIL_PORT: '5000' }).port, 5000);
  for (const origin of ['http://trail.example.com', 'https://trail.example.com/', 'https://trail.example.com/path', 'https://name:pass@trail.example.com']) {
    assert.throws(() => serverConfig({ SANGIL_PUBLIC_ORIGIN: origin }));
  }
  assert.throws(() => serverConfig({ SANGIL_PORT: 'invalid' }));
  assert.throws(() => serverConfig({ SANGIL_LISTEN_HOST: '0.0.0.0' }));
  assert.equal(serverConfig({ SANGIL_PUBLIC_ORIGIN: 'https://trail.example.com', SANGIL_LISTEN_HOST: '0.0.0.0', PORT: '10000' }).port, 10000);
});

test('HTTPS 프록시 출처·Secure 쿠키·계정 내보내기·비밀번호 교체·탈퇴를 검증한다', async () => {
  const db = openDatabase(':memory:');
  const publicOrigin = 'https://trail.example.com';
  const api = createAPI(db, { publicOrigin });
  const server = http.createServer(api);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  async function call(route, method = 'GET', body, cookie = '', origin = publicOrigin) {
    const response = await fetch(base + route, { method,
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-Sangil-Request': '1', 'X-Forwarded-Proto': 'https' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') || '' };
  }
  try {
    const a = await call('auth/register', 'POST', { nickname: '예시계정A', password: 'sample-password-a' });
    const b = await call('auth/register', 'POST', { nickname: '예시계정B', password: 'sample-password-b' });
    assert.equal(a.status, 200); assert.ok(a.cookie.includes('; Secure'));
    assert.equal((await call('health')).data.mode, 'https-server');
    const otherSession = await call('auth/login', 'POST', { nickname: '예시계정A', password: 'sample-password-a' });
    const input = { mountainId: 'achasan', title: '계정 테스트', date: '2026-12-01', time: '09:00', place: '예시 장소' };
    const plan = await call('plans', 'POST', input, a.cookie);
    const otherPlan = await call('plans', 'POST', input, b.cookie);
    await call(`plans/${plan.data.plan.id}/response`, 'POST', { status: 'yes' }, b.cookie);
    await call(`plans/${otherPlan.data.plan.id}/response`, 'POST', { status: 'yes' }, a.cookie);
    await call('reviews', 'POST', { mountainId: 'achasan', text: '내보내기 테스트', rating: 4 }, a.cookie);
    const exported = await call('account/export', 'GET', undefined, a.cookie);
    assert.equal(exported.data.plans.length, 1); assert.equal(exported.data.reviews.length, 1);
    assert.equal(exported.data.responses.length, 2);
    assert.equal(exported.data.user.name, '예시계정A');
    assert.ok(!JSON.stringify(exported.data).includes('password_hash'));
    assert.ok(!JSON.stringify(exported.data).includes('예시계정B'));
    assert.equal((await call('account/export')).status, 401);
    assert.equal((await call('account/password', 'POST', { password: 'sample-password-a', newPassword: 'replacement-password' }, a.cookie, 'https://other.invalid')).status, 403);
    assert.equal((await call('account/password', 'POST', { password: 'wrong-password', newPassword: 'replacement-password' }, a.cookie)).status, 403);
    const changed = await call('account/password', 'POST', { password: 'sample-password-a', newPassword: 'replacement-password' }, a.cookie);
    assert.equal(changed.status, 200); assert.ok(changed.cookie.includes('Secure'));
    assert.equal((await call('auth/session', 'GET', undefined, otherSession.cookie)).data.user, null);
    assert.equal((await call('auth/session', 'GET', undefined, a.cookie)).data.user, null);
    assert.equal((await call('auth/login', 'POST', { nickname: '예시계정A', password: 'sample-password-a' })).status, 401);
    assert.equal((await call('auth/login', 'POST', { nickname: '예시계정A', password: 'replacement-password' })).status, 200);
    assert.equal((await call('account', 'DELETE', { password: 'replacement-password', confirm: '아니요' }, changed.cookie)).status, 400);
    const deleted = await call('account', 'DELETE', { password: 'replacement-password', confirm: '탈퇴' }, changed.cookie);
    assert.equal(deleted.status, 200); assert.ok(deleted.cookie.includes('Max-Age=0'));
    for (const [table, column] of [['users','id'], ['sessions','user_id'], ['plans','owner_id'], ['responses','user_id'], ['reviews','owner_id']]) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`).get(a.data.user.id).n, 0);
    }
    assert.equal((await call('plans/' + plan.data.plan.id)).status, 404);
    assert.equal((await call('plans/' + otherPlan.data.plan.id)).data.plan.responses.length, 1);
    assert.equal((await call('auth/session', 'GET', undefined, b.cookie)).data.user.name, '예시계정B');
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); db.close(); }
});
