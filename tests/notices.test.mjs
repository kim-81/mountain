import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialNotices,noticeAge,noticeSourceFor,selectNotices} from '../web/js/official-notices-data.js';
import {createNoticeService} from '../server/notices.mjs';
const knps='<tr data-href="/front/portal/safe/acsCtrDtl.do?menuNo=8000340&amp;rstId=0019"><td class="parkNm">북한산 </td><td>북한산</td><td class="control_02">부분통제</td><td class="last">2026-10-18 23:06</td></tr>';
test('Android가 수신한 한양도성 표의 줄바꿈·속성 배치를 처리한다',()=>{
  const html='<tr>\r\n<td class="subject"\r\n> <a\r\n\thref="?act=read&amp;bpoId=5000&amp;bcaId=0&amp;pageIndex=1">\r\n공지 예시\r\n</a></td>\r\n<td class="date">2026-11-16</td></tr>';
  const data=parseOfficialNotices('citywall',html);
  assert.equal(data.items[0].title,'공지 예시');
  assert.equal(data.items[0].date,'2026-11-16');
  assert.equal(data.items[0].id,'5000');
});
test('선택 코스의 우회 공지가 행사 목록에 묻히지 않고 1코스와 11코스를 구분한다', () => {
  const titles = ['[11코스] 통제 안내', ...Array(12).fill('서울둘레길 행사'), '[1코스] 옥수당근린공원 우회 안내'];
  const html = titles.map((title, index) =>
    `<tr><td><a href="javascript:goView('${2611030001 + index}');">${title}</a></td><td class="data">2026-11-03</td></tr>`
  ).join('');
  const data = parseOfficialNotices('seoultrail', html);
  const selected = selectNotices(data, { id: 'suraksan', name: '수락산', courseId: 'seoul-dulle-1' });
  assert.equal(selected[0].title, titles.at(-1));
  assert.equal(selected.length, 6);
  assert.equal(selected[1].title, titles[0]);
});
test('공식 통제 표는 공원 단위와 게시 갱신시각을 보존하고 형식 변경 시 실패한다',()=>{
  const result=parseOfficialNotices('knps',knps,1000);assert.equal(result.items[0].status,'부분통제');assert.equal(result.items[0].date,'2026-10-18 23:06');assert.equal(result.fetchedAt,1000);
  assert.throws(()=>parseOfficialNotices('knps',knps.replace('부분통제','알 수 없음')));
  assert.throws(()=>parseOfficialNotices('__proto__',knps));assert.throws(()=>parseOfficialNotices('knps','x'.repeat(2100000)));
  assert.equal(noticeSourceFor('inwangsan'),'citywall');assert.equal(noticeSourceFor('achasan'),'seoultrail');
});
test('공지 제목은 코드와 태그를 제거하고 공식 ID로만 주소를 만든다',()=>{
  const seoul=`<tr><td><a href="javascript:goView('2611030002');" class="ellipsis1"><script>alert(1)</script><b>통제 &amp; &#39;안내&#39;</b></a></td><td class="data">2026-11-03</td></tr>`;
  const item=parseOfficialNotices('seoultrail',seoul).items[0];assert.equal(item.title,"통제 & '안내'");assert.ok(item.url.startsWith('https://gil.seoul.go.kr/'));assert.ok(!item.url.includes('javascript'));
  assert.throws(()=>parseOfficialNotices('seoultrail',seoul.replace('2611030002','evil')));
  const city='<a href="?act=read&amp;bpoId=4997&amp;bcaId=0&amp;pageIndex=1"><strong class="title">시범 제목</strong><i class="date">2026-11-04</i></a>';
  assert.equal(parseOfficialNotices('citywall',city).items[0].id,'4997');
  const table='<tr><td class="subject"><a href="?act=read&amp;bpoId=4998&amp;bcaId=0&amp;pageIndex=1">인왕산 통제 &amp; 우회</a></td><td class="date">2026-11-06</td></tr>';
  const current=parseOfficialNotices('citywall',table).items[0];
  assert.equal(current.title,'인왕산 통제 & 우회');
  assert.equal(current.date,'2026-11-06');
  assert.match(current.url,/^https:\/\/seoulcitywall\.seoul\.go\.kr\//);
});
test('공지 캐시는 동시 요청을 합치고 실패 시 30분까지만 기존 수신시각을 유지한다',async()=>{
  let time=1000000,calls=0,fail=false;const service=createNoticeService({now:()=>time,fetcher:async(url)=>{calls++;assert.ok(url.startsWith('https://www.knps.or.kr/'));if(fail)throw Error('offline');await new Promise(resolve=>setTimeout(resolve,2));return new Response(knps);}});
  const [a,b]=await Promise.all([service('knps'),service('knps')]);assert.equal(calls,1);assert.deepEqual(a,b);
  time+=6*60000;fail=true;const stale=await service('knps');assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,a.fetchedAt);assert.equal(noticeAge(stale,time),'stale');
  time+=30*60000;await assert.rejects(service('knps'));assert.equal(noticeAge(stale,time),'expired');await assert.rejects(service('other'));assert.equal(calls,3);
});
