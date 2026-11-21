import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceKm,recommend,encodePlan,decodePlan,escapeHTML,validFix} from '../web/js/core.js';
import {catalogMountains as mountains} from '../web/js/catalog.js';

test('등산 초보자에게 어려운 장시간 코스보다 쉬운 짧은 코스를 먼저 추천한다',()=>{
  const ranked=recommend(mountains,{experience:1,fitness:1,minutes:120,transport:'transit'});
  assert.equal(ranked[0].level,1);
  assert.ok(ranked[0].minutes<=120);
  assert.ok(ranked.find(m=>m.id==='bukhansan').score < ranked[0].score);
});
test('즐겨찾기와 완주 이력이 개인화 점수에 반영된다',()=>{
  const profile={experience:2,fitness:2,minutes:180,transport:'transit'};
  const before=recommend(mountains,profile).find(m=>m.id==='inwangsan');
  const after=recommend(mountains,profile,['inwangsan'],[{mountainId:'inwangsan',complete:true}]).find(m=>m.id==='inwangsan');
  assert.equal(after.score-before.score,11);
});
test('한글 일정은 공유 코드로 왕복하고 다른 기기의 응답은 가져오지 않는다',()=>{
  const plan={id:'test-1',mountainId:'achasan',title:'함께 걸어요 🌿',date:'2026-11-14',time:'09:30',place:'예시 역 입구',responses:[{name:'예시',status:'yes'}]};
  const decoded=decodePlan(encodePlan(plan),mountains);
  assert.equal(decoded.title,plan.title);assert.equal(decoded.place,plan.place);assert.deepEqual(decoded.responses,[]);
});
test('잘못되거나 너무 긴 공유 데이터는 거부한다',()=>{
  assert.throws(()=>decodePlan('!malformed',mountains));
  assert.throws(()=>decodePlan('a'.repeat(6001),mountains));
  assert.throws(()=>decodePlan(encodePlan({id:'x',mountainId:'unknown'}),mountains));
});
test('GPS 거리 계산은 동일 지점 0, 위도 1도 약 111km이다',()=>{
  assert.equal(distanceKm({lat:37,lng:127},{lat:37,lng:127}),0);
  assert.ok(Math.abs(distanceKm({lat:37,lng:127},{lat:38,lng:127})-111.2)<.1);
});
test('정확도가 낮거나 범위를 벗어난 GPS 지점은 사용하지 않는다',()=>{
  assert.equal(validFix({lat:37,lng:127,accuracy:10}),true);
  assert.equal(validFix({lat:37,lng:127,accuracy:200}),false);
  assert.equal(validFix({lat:200,lng:127,accuracy:10}),false);
  assert.equal(validFix({lat:37,lng:127,accuracy:-1}),false);
});
test('후기와 별명에 포함된 HTML이 화면 코드로 실행되지 않는다',()=>{
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
