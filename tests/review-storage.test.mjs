import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../server/database.mjs';
import {createAPI} from '../server/api.mjs';
import {decodeReviewPhoto} from '../server/review-photos.mjs';
import {photoDimensions} from '../web/js/photo-files.js';
import {reviewImageURL,serverDraftId} from '../web/js/review-client.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0z8AAAAASUVORK5CYII=';

test('사진 파일은 실제 형식·픽셀 크기를 검증하고 표시 주소는 지정 서버로 제한한다',()=>{
  const image=decodeReviewPhoto(png);assert.equal(image.mime,'image/png');assert.equal(photoDimensions(image.bytes).width,1);
  assert.throws(()=>decodeReviewPhoto('data:image/png;base64,PHN2Zz4='));
  const large=Buffer.from(image.bytes);large.writeUInt32BE(50000,16);assert.throws(()=>decodeReviewPhoto('data:image/png;base64,'+large.toString('base64')));
  assert.equal(reviewImageURL('javascript:alert(1)','https://trail.example.com'),null);
  assert.equal(reviewImageURL('https://attacker.invalid/image.png','https://trail.example.com'),null);
  const path='/api/reviews/'+'a'.repeat(32)+'/photos/0/'+'b'.repeat(16);
  assert.equal(reviewImageURL(path,'https://trail.example.com'),'https://trail.example.com'+path);
  assert.match(serverDraftId(),/^[a-f0-9]{32}$/);assert.notEqual(serverDraftId(),serverDraftId());
});

test('사진 응답을 분리하고 후기 페이지·동시 수정·재시도 중복·소유권을 검증한다',async()=>{
  const db=openDatabase(':memory:');const api=createAPI(db);const server=http.createServer(api);server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie=''){
    const response=await fetch(origin+'/api/'+path,{method,headers:{Origin:origin,'X-Sangil-Request':'1','Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try {
    const a=await call('auth/register','POST',{nickname:'사진검사A',password:'sample-photo-a'});
    const b=await call('auth/register','POST',{nickname:'사진검사B',password:'sample-photo-b'});
    const id='a'.repeat(32),input={id,mountainId:'achasan',text:'사진이 있는 예시 후기',rating:4,photos:[png]};
    const created=await call('reviews','POST',input,a.cookie);assert.equal(created.status,200);const review=created.data.review;
    assert.match(review.photos[0],/^\/api\/reviews\//);assert.ok(!JSON.stringify(review).includes('base64,'));
    const summary=await call('account/export','GET',undefined,a.cookie);
    assert.equal(summary.data.schemaVersion,2);assert.ok(!JSON.stringify(summary.data).includes('base64,'));
    const archive=await call('account/export/reviews/'+id,'GET',undefined,a.cookie);
    assert.equal(archive.data.review.photos[0],png);
    assert.equal((await call('account/export/reviews/'+id,'GET',undefined,b.cookie)).status,404);
    assert.equal((await call('account/export/reviews/'+id)).status,401);
    assert.equal((await call('reviews','POST',input,a.cookie)).status,200);assert.equal(db.prepare('SELECT count(*) AS n FROM reviews').get().n,1);
    const photo=await fetch(origin+review.photos[0]);assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/png');assert.ok((await photo.arrayBuffer()).byteLength>0);
    const edited=await call('reviews','POST',{...input,text:'수정한 후기',photos:review.photos,revision:review.revision},a.cookie);assert.equal(edited.status,200);
    assert.equal((await call('reviews','POST',{...input,text:'다른 화면의 옛 수정',photos:review.photos,revision:review.revision},a.cookie)).status,409);
    assert.equal((await call('reviews','POST',{...input,id:'b'.repeat(32),photos:review.photos},b.cookie)).status,409);
    assert.equal((await call('reviews','POST',{...input,text:'다른 사용자 수정'},b.cookie)).status,403);
    for(let i=1;i<=22;i++)assert.equal((await call('reviews','POST',{...input,id:i.toString(16).padStart(32,'0'),photos:[],text:'페이지 예시 '+i},a.cookie)).status,200);
    const first=(await call('reviews/page/achasan/0')).data;assert.equal(first.reviews.length,10);assert.equal(first.total,23);assert.ok(first.nextCursor);
    const second=(await call('reviews/page/achasan/'+first.nextCursor)).data;assert.equal(second.reviews.length,10);
    assert.ok(!first.reviews.some(item=>second.reviews.some(other=>other.id===item.id)));
    const third=(await call('reviews/page/achasan/'+second.nextCursor)).data;assert.equal(third.reviews.length,3);assert.equal(third.nextCursor,null);
    assert.equal((await call('reviews/page/buramsan/0')).data.total,0);
    const plan={id:'c'.repeat(32),mountainId:'achasan',title:'재시도 일정',date:'2026-11-29',time:'09:00',place:'예시 장소'};
    assert.equal((await call('plans','POST',plan,a.cookie)).status,201);assert.equal((await call('plans','POST',plan,a.cookie)).status,200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM plans').get().n,1);
    assert.equal((await call('plans','POST',{...plan,title:'다른 내용'},a.cookie)).status,409);
    await call('reviews/'+id,'DELETE',{},a.cookie);assert.equal((await fetch(origin+review.photos[0])).status,404);
  } finally {server.close();server.closeAllConnections();await once(server,'close');db.close();}
});
