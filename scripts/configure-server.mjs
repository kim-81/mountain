import fs from 'node:fs/promises';
export function validateServerOrigin(value) {
  if (value === '') return value;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw Error('서버 주소는 경로·끝 슬래시·비밀번호 없는 HTTPS 원점이어야 합니다.');
  return value;
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const value = process.argv.includes('--device-only') ? '' : process.argv[process.argv.indexOf('--origin') + 1];
  if (!process.argv.includes('--device-only') && !process.argv.includes('--origin')) throw Error('--origin https://서버주소 또는 --device-only를 지정하세요.');
  const origin = validateServerOrigin(value);
  await fs.writeFile(new URL('../web/js/server-config.js', import.meta.url), `// 프로젝트의 지정 HTTPS 서버. 비밀 키를 넣지 마세요.\nexport const serverOrigin = ${JSON.stringify(origin)};\n`);
  await fs.writeFile(new URL('../web/server-config.json', import.meta.url), JSON.stringify({apiOrigin:origin}));
  console.log(origin ? '서버 주소 설정 완료. 네이티브 동기화 및 APK 재빌드가 필요합니다.' : '기기 저장 모드로 설정했습니다.');
}
