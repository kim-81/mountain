import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 프록시 헤더 대신 운영자가 지정한 공개 주소만 신뢰합니다.
export function serverConfig(env = process.env) {
  const publicOrigin = env.SANGIL_PUBLIC_ORIGIN || '';
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password) {
      throw Error('SANGIL_PUBLIC_ORIGIN은 경로 없는 HTTPS 주소여야 합니다. 예: https://trail.example.com');
    }
  }
  const port = Number(env.SANGIL_PORT || env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('SANGIL_PORT는 1~65535여야 합니다.');
  const host = env.SANGIL_LISTEN_HOST || '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || (host === '0.0.0.0' && !publicOrigin)) {
    throw Error('외부 수신은 HTTPS 운영 원점을 지정한 호스팅 환경에서만 설정하세요.');
  }
  return { host, port, publicOrigin,
    dataDirectory: path.resolve(env.SANGIL_DATA_DIR || fileURLToPath(new URL('../.local-data/', import.meta.url))) };
}
