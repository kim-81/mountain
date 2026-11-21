// Railway의 시작 상태 검사는 전용 Host를 사용합니다.
// 해당 Host는 상태 확인 GET 한 곳에만 허용합니다.
export function requestHostAllowed(request, config, railway = Boolean(process.env.RAILWAY_PROJECT_ID)) {
  const allowed = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`];
  if (config.publicOrigin) allowed.push(new URL(config.publicOrigin).host);
  if (allowed.includes(request.headers.host)) return true;
  return railway && Boolean(config.publicOrigin) && request.headers.host === 'healthcheck.railway.app'
    && request.method === 'GET' && request.url === '/api/health';
}
