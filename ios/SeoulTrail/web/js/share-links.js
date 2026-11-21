export function sharedPlanIdFromLink(value, expectedOrigin) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== expectedOrigin || url.username || url.password) throw Error('앱에 연결된 서버의 일정 링크를 사용해 주세요.');
  const match = url.hash.match(/^#shared\/([a-f0-9]{32})$/);
  if (!match) throw Error('서버 일정 링크의 형식이 올바르지 않습니다.');
  return match[1];
}
