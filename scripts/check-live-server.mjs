// 공개 서버를 두 예시 계정으로 검사합니다. 실제 개인정보를 사용하지 않습니다.
// 만든 검사 계정은 마지막에 본인 비밀번호로 삭제합니다.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {validateServerOrigin} from './configure-server.mjs';

const origin = validateServerOrigin(process.argv[2]);
assert(origin, '검사할 HTTPS 서버 주소가 필요합니다.');
const suffix = randomBytes(4).toString('hex');
const users = [];
const checks = [];
async function call(path, method = 'GET', body, user) {
  const response = await fetch(`${origin}/api/${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: {'Content-Type':'application/json', Origin:origin, 'X-Sangil-Request':'1', ...(user ? {Cookie:user.cookie} : {})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  const data = await response.json();
  return {status:response.status, data, cookie:response.headers.get('set-cookie')?.split(';')[0], secure:response.headers.get('set-cookie')?.includes('; Secure')};
}
try {
  const health = await call('health');
  assert.equal(health.status, 200); assert.equal(health.data.mode, 'https-server');
  checks.push(`HTTPS 운영 서버 ${health.data.version}`);
  for (const letter of ['A','B']) {
    const password = randomBytes(18).toString('hex');
    const created = await call('auth/register','POST',{nickname:`검사${letter}-${suffix}`, password});
    assert.equal(created.status,200);
    users.push({cookie:created.cookie,password});
    assert(created.secure); assert(created.cookie);
  }
  checks.push('두 예시 계정 생성·Secure 쿠키');
  assert.equal((await call('plans')).status,401);
  const plan = await call('plans','POST',{mountainId:'achasan',title:'자동 검사 일정',date:'2026-11-30',time:'09:00',place:'예시 만남 장소'},users[0]);
  assert.equal(plan.status,201);
  const id = plan.data.plan.id;
  assert.equal((await call(`plans/${id}/response`,'POST',{status:'yes'},users[1])).status,200);
  assert.equal((await call(`plans/${id}`,'GET',undefined,users[0])).data.plan.responses.length,2);
  assert.equal((await call(`plans/${id}`,'DELETE',{},users[1])).status,403);
  checks.push('일정 생성·다른 계정 참가·타인 삭제 차단');
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0z8AAAAASUVORK5CYII=';
  const review = await call('reviews','POST',{mountainId:'achasan',text:'자동 검사 예시 후기',rating:5,photos:[photo]},users[0]);
  assert.equal(review.status,200);
  const reviewId = review.data.review.id;
  assert((await call('reviews')).data.reviews.some(item=>item.id === reviewId));
  const image=await fetch(origin+review.data.review.photos[0],{signal:AbortSignal.timeout(20000)});
  assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/png');
  assert(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(photo.split(',')[1],'base64')));
  assert.equal((await call(`reviews/${reviewId}`,'DELETE',{},users[1])).status,403);
  checks.push('후기·사진 업로드 및 공개 조회·타인 삭제 차단');
  assert.equal((await call(`reviews/${reviewId}`,'DELETE',{},users[0])).status,200);
  assert.equal((await call(`plans/${id}`,'DELETE',{},users[0])).status,200);
} finally {
  for (const user of users) {
    const deleted = await call('account','DELETE',{password:user.password,confirm:'탈퇴'},user);
    assert.equal(deleted.status,200,'검사 계정 정리 실패');
  }
}
const report = {checkedAt:new Date().toISOString(),origin,checks,testAccountsRemoved:true,physicalDeviceTested:false};
await fs.mkdir(new URL('../outputs/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../outputs/live-server-check.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
