import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mountains} from '../web/js/data.js';
import {facilityDatabase} from '../web/js/facility-database.js';
import {nearbyFacilities,facilityReference,facilityPanel} from '../web/js/facilities.js';
import {renderOfflineMap,bundledRoute} from '../web/js/offline-map.js';
import {courseSupport} from '../web/js/course-support.js';
test('새 기본 경로의 출발점 주변 시설을 산 대표 위치와 구분해 검색한다',()=>{
  for(const id of ['suraksan','buramsan','inwangsan','bukhaksan']){
    const mountain=mountains.find(m=>m.id===id),route=bundledRoute(id);
    const result=nearbyFacilities(mountain,{route,origin:'start',kind:'toilets',radius:1});
    assert.ok(result.items.length>0,id);
    assert.ok(result.items.every(item=>item.kind==='toilets'&&item.distanceKm<=1));
    assert.equal(result.reference.lat,route.segments[0][0].lat);
  }
});

test('시설은 8개 산의 공개 좌표·OSM 원문·라이선스를 포함하고 원본 JSON과 일치한다',async()=>{
  assert.equal(Object.keys(facilityDatabase.mountainIndex).length,8);assert.equal(facilityDatabase.license.spdx,'ODbL-1.0');
  assert.ok(facilityDatabase.features.length>100);const ids=new Set();
  for(const item of facilityDatabase.features){assert.ok(!ids.has(item.id));ids.add(item.id);assert.ok(Number.isFinite(item.lat)&&Math.abs(item.lat)<=90&&Number.isFinite(item.lng)&&Math.abs(item.lng)<=180);assert.match(item.sourceUrl,/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);}
  for(const list of Object.values(facilityDatabase.mountainIndex))assert.ok(list.every(id=>ids.has(id)));
  const json=JSON.parse(await fs.readFile(new URL('../web/map-data/seoul-facilities.json',import.meta.url),'utf8'));assert.deepEqual(json,facilityDatabase);
});

test('시설 검색은 분류·직선 반경·선택한 출발/도착 기준을 지키고 없는 시설을 만들지 않는다',()=>{
  const mountain=mountains.find(m=>m.id==='achasan');
  const result=nearbyFacilities(mountain,{kind:'toilets',origin:'mountain',radius:1});
  assert.ok(result.items.every(item=>item.kind==='toilets'&&item.distanceKm<=1));
  for(let i=1;i<result.items.length;i++)assert.ok(result.items[i].distanceKm>=result.items[i-1].distanceKm);
  const route={segments:[[{lat:37,lng:127},{lat:37.1,lng:127.1}]]};
  assert.equal(facilityReference(mountain,'start',route).lat,37);assert.equal(facilityReference(mountain,'end',route).lat,37.1);
  assert.equal(facilityReference(mountain,'start',null).lat,mountain.lat);
  assert.equal(nearbyFacilities({...mountain,id:'missing'}).items.length,0);
});

test('시설 화면과 지도는 등록 원문·미확인 상태·직선거리와 번호를 표시한다',()=>{
  const mountain=mountains[0];
  const html=facilityPanel(mountain,{kind:'all',origin:'mountain',radius:3},null,()=>'<div>지도 영역</div>');
  assert.ok(html.includes('직선거리'));assert.ok(html.includes('현장 미확인'));assert.ok(html.includes('ODbL-1.0'));assert.ok(!html.includes('<script'));
  const map=renderOfflineMap(null,[],null,{id:'facility-test',mountainId:mountain.id,center:mountain,facilities:[{id:'example',lat:mountain.lat,lng:mountain.lng,name:'<시설>'}]});
  assert.ok(map.includes('1. &lt;시설&gt;'));assert.ok(!map.includes('<시설>'));
});

test('공식 준비 정보는 모든 산에 확인일·공식 출처를 두고 실시간 개방으로 단정하지 않는다',()=>{
  for(const mountain of mountains){const item=courseSupport[mountain.id];assert.ok(item&&item.transport.length>5&&item.notes.length);assert.match(item.source,/^https:\/\/(gil|seoulcitywall)\.seoul\.go\.kr\//);assert.ok(Number.isFinite(Date.parse(item.checkedAt)));}
  assert.ok(courseSupport.bonghwasan.notes.some(note=>note.includes('식수대')));
});
