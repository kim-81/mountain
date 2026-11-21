import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../web/js/api.js';

test('서버 지연·비JSON 응답·통신 단절·인증 만료는 복구 가능한 오류로 전달한다', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>proxy unavailable</html>', { status: 502 });
    await assert.rejects(apiRequest('health'), /응답 형식/);
    globalThis.fetch = async () => { throw new TypeError('network failure'); };
    await assert.rejects(apiRequest('health'), /인터넷 연결/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '로그인이 필요합니다.' }), { status: 401 });
    await assert.rejects(apiRequest('plans'), error => error.status === 401);
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted'))));
    await assert.rejects(apiRequest('health', 'GET', undefined, { timeoutMs: 10 }), /새로고침으로 확인/);
  } finally { globalThis.fetch = original; }
});
