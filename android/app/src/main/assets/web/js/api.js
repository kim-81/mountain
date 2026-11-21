import {serverOrigin} from './server-config.js';
// 웹은 동일 출처 쿠키, 앱은 OS의 HTTPS 통신·보호 저장소를 사용합니다.
export const backend = { available: false, user: null, error: null };
const requests = new Map();
let sequence = 0;
const isNative = () => Boolean(globalThis.AndroidTrail || globalThis.webkit?.messageHandlers?.trail);
globalThis.onTrailAPI = message => {
  const request = requests.get(message.requestId);
  if (!request) return;
  requests.delete(message.requestId); clearTimeout(request.timer);
  if (message.error) { request.reject(Error(message.error)); return; }
  if (message.status < 200 || message.status >= 300) {
    if (message.status === 401) backend.user = null;
    const error = Error(message.body?.error || '서버 요청을 처리하지 못했습니다.'); error.status = message.status; request.reject(error);
  } else request.resolve(message.body);
};
function nativeRequest(path, method, body, timeoutMs) {
  if (!serverOrigin && !/^public-notices\/(knps|seoultrail|citywall)$/.test(path)) return Promise.reject(Error('공유 서버가 아직 설정되지 않았습니다. 기기 기록을 이용해 주세요.'));
  return new Promise((resolve, reject) => {
    const requestId = `api-${++sequence}`;
    const timer = setTimeout(() => { requests.delete(requestId); reject(Error('서버 응답이 늦어지고 있습니다. 저장 결과를 새로고침으로 확인해 주세요.')); }, timeoutMs);
    requests.set(requestId, {resolve,reject,timer});
    try {
      const message = JSON.stringify({action:'api',requestId,path,method,...(body === undefined ? {} : {body})});
      if (globalThis.AndroidTrail) globalThis.AndroidTrail.postMessage(message);
      else globalThis.webkit.messageHandlers.trail.postMessage(message);
    } catch { requests.delete(requestId); clearTimeout(timer); reject(Error('앱 통신 기능을 시작하지 못했습니다.')); }
  });
}
export async function apiRequest(path, method = 'GET', body, { timeoutMs = 15000 } = {}) {
  if (!/^[a-z0-9/-]+$/.test(path) || !['GET','POST','DELETE'].includes(method)) throw Error('지원하지 않는 서버 요청입니다.');
  if (isNative()) return nativeRequest(path, method, body, timeoutMs + 2000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
  const response = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    headers: { 'Content-Type': 'application/json', 'X-Sangil-Request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let result;
  try { result = await response.json(); }
  catch { throw Error('서버 응답 형식을 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.'); }
  if (!response.ok) {
    if (response.status === 401) backend.user = null;
    const error = Error(result?.error || '서버 요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return result;
  } catch (error) {
    if (controller.signal.aborted) throw Error('서버 응답이 늦어지고 있습니다. 저장 결과를 새로고침으로 확인한 뒤 다시 시도해 주세요.');
    if (error instanceof TypeError) throw Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export async function connectBackend() {
  if (isNative() ? !serverOrigin : !/^https?:$/.test(globalThis.location.protocol)) return;
  try {
    const health = await apiRequest('health');
    if (!['local-server', 'https-server'].includes(health.mode)) throw Error('지원하는 서버가 아닙니다.');
    const session = await apiRequest('auth/session');
    backend.user = session.user;
    backend.available = true;
    backend.error = null;
  } catch (error) { backend.available = false; backend.user = null; backend.error = error.message; }
}
