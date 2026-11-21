import test from 'node:test';
import assert from 'node:assert/strict';
import { pointToSegmentMeters, routeDistanceMeters, validateRoute, nextDeviation, appendFix } from '../web/js/navigation.js';
import { normalizeState } from '../web/js/store.js';
import { validSchedule } from '../web/js/core.js';

const line = [[{ lat: 37, lng: 127 }, { lat: 37.01, lng: 127 }]];
test('좌표에서 경로 선분까지 거리를 계산하고 끝점 바깥은 끝점 거리를 사용한다', () => {
  assert.ok(pointToSegmentMeters({ lat: 37.005, lng: 127 }, ...line[0]) < .01);
  const meters = pointToSegmentMeters({ lat: 37.005, lng: 127.001 }, ...line[0]);
  assert.ok(meters > 80 && meters < 100);
  assert.ok(pointToSegmentMeters({ lat: 37.02, lng: 127 }, ...line[0]) > 1000);
});
test('분리된 GPX 구간 사이에 존재하지 않는 선분을 만들지 않는다', () => {
  const segments = [[{ lat: 37, lng: 127 }, { lat: 37.001, lng: 127 }], [{ lat: 37.02, lng: 127 }, { lat: 37.021, lng: 127 }]];
  assert.ok(routeDistanceMeters({ lat: 37.01, lng: 127 }, segments) > 900);
  assert.ok(validateRoute(segments).km < .23);
});
test('GPX의 범위 밖 좌표와 비정상적으로 끊긴 구간은 거부한다', () => {
  assert.throws(() => validateRoute([[{ lat: 91, lng: 127 }, { lat: 37, lng: 127 }]]));
  assert.throws(() => validateRoute([[{ lat: 37, lng: 127 }, { lat: 38, lng: 127 }]]));
});
test('연속 3회 이탈, 90초 알림 제한, 경로 복귀를 판정한다', () => {
  let state;
  for (let i = 0; i < 3; i++) state = nextDeviation(state, { lat: 37.005, lng: 127.002, accuracy: 5, time: 100000 + i * 3000 }, line, true);
  assert.equal(state.alert, true); assert.equal(state.outside, true);
  state = nextDeviation(state, { lat: 37.005, lng: 127.002, accuracy: 5, time: 110000 }, line, true);
  assert.equal(state.alert, false);
  state = nextDeviation(state, { lat: 37.005, lng: 127, accuracy: 5, time: 113000 }, line, true);
  assert.equal(state.outside, false); assert.equal(state.outsideCount, 0);
});
test('위치 정확도가 낮거나 경로가 없는 경우 이탈 알림을 만들지 않는다', () => {
  assert.equal(nextDeviation(null, { lat: 37, lng: 127.1, accuracy: 200, time: 100000 }, line, true).alert, false);
  assert.equal(nextDeviation(null, { lat: 37, lng: 127.1, accuracy: 5, time: 100000 }, [], true).alert, false);
});
test('기록은 중복/과거 신호와 순간이동을 제외하고 긴 공백을 거리로 더하지 않는다', () => {
  const time = Date.now() - 300000;
  const session = { startedAt: time, points: [], km: 0 };
  assert.equal(appendFix(session, { lat: 37, lng: 127, accuracy: 5, time }), true);
  assert.equal(appendFix(session, { lat: 37, lng: 127, accuracy: 5, time }), false);
  assert.equal(appendFix(session, { lat: 38, lng: 128, accuracy: 5, time: time + 3000 }), false);
  assert.equal(appendFix(session, { lat: 37.001, lng: 127, accuracy: 5, time: time + 180000 }), true);
  assert.equal(session.km, 0);
});
test('이전 버전 저장값을 유지하며 잘못된 타입으로 앱이 멈추지 않는다', () => {
  const data = normalizeState({ favorites: ['achasan', 7, 'achasan'], records: [null, { km: 'oops' }], profile: { fitness: 9 }, activeSession: { points: [] } });
  assert.deepEqual(data.favorites, ['achasan']); assert.deepEqual(data.records, []);
  assert.equal(data.profile.fitness, 1); assert.equal(data.activeSession, null);
});
test('실제 달력에 없는 날짜와 잘못된 시간은 거부한다', () => {
  assert.equal(validSchedule('2026-02-30', '09:00'), false);
  assert.equal(validSchedule('2026-11-14', '25:99'), false);
  assert.equal(validSchedule('2028-02-29', '09:00'), true);
});

test('중복·과거 GPS 신호가 이탈 횟수를 늘리지 않고 재알림 간격을 지킨다',()=>{
  const outside={lat:37.005,lng:127.002,accuracy:5,time:100000};
  let result=nextDeviation(null,outside,line,true);
  result=nextDeviation(result,outside,line,true);
  result=nextDeviation(result,{...outside,time:99000},line,true);
  assert.equal(result.outsideCount,1);assert.equal(result.alert,false);
  result=nextDeviation(result,{...outside,time:103000},line,true);
  result=nextDeviation(result,{...outside,time:106000},line,true);
  assert.equal(result.alert,true);
  result=nextDeviation(result,{...outside,time:195999},line,true);assert.equal(result.alert,false);
  result=nextDeviation(result,{...outside,time:196000},line,true);assert.equal(result.alert,true);
});

test('시작 전·미래·잘못된 좌표 신호는 기록을 변경하지 않는다',()=>{
  const now=Date.now();const session={startedAt:now-1000,points:[],km:0};
  for(const fix of [{lat:37,lng:127,accuracy:5,time:now-2000},{lat:37,lng:127,accuracy:5,time:now+60000},{lat:91,lng:127,accuracy:5,time:now}])assert.equal(appendFix(session,fix),false);
  assert.equal(session.points.length,0);assert.equal(session.km,0);
});
