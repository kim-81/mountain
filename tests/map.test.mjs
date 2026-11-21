import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { projectPoint,unprojectPoint,fitMapBounds,zoomMapBounds,panMapBounds,coverageContains } from '../web/js/map-geometry.js';
import { mapDatabase } from '../web/js/map-database.js';
import { bundledRoute,renderOfflineMap } from '../web/js/offline-map.js';
import { validateRoute } from '../web/js/navigation.js';

test('지도 좌표 투영과 역변환은 서울 위치를 보존한다',()=>{
  const original={lat:37.5798,lng:126.977};
  const restored=unprojectPoint(projectPoint(original));
  assert.ok(Math.abs(restored.lat-original.lat)<1e-9);
  assert.ok(Math.abs(restored.lng-original.lng)<1e-9);
  assert.ok(Number.isFinite(projectPoint({lat:90,lng:127}).y));
});
test('경로 맞춤·확대·이동은 좌표를 이동시키지 않고 카메라만 바꾼다',()=>{
  const points=[{lat:37.55,lng:127.1},{lat:37.58,lng:127.11}];
  const bounds=fitMapBounds(points);
  for(const p of points){const q=projectPoint(p);assert.ok(q.x>bounds.minX&&q.x<bounds.maxX&&q.y>bounds.minY&&q.y<bounds.maxY);}
  const zoomed=zoomMapBounds(bounds,.5);
  assert.ok(Math.abs((zoomed.maxX-zoomed.minX)*2-(bounds.maxX-bounds.minX))<.01);
  const moved=panMapBounds(bounds,200,-100);
  assert.equal(moved.minX,bounds.minX+200);assert.equal(moved.maxY,bounds.maxY-100);
});
test('서로 붙어 있는 저장 범위와 그 사이의 공백을 구분한다',()=>{
  assert.equal(coverageContains([{bounds:[0,0,1,1]},{bounds:[0,1,1,2]}],[.1,.1,.9,1.9]),true);
  assert.equal(coverageContains([{bounds:[0,0,1,.9]},{bounds:[0,1.1,1,2]}],[.1,.1,.9,1.9]),false);
  assert.equal(coverageContains([{bounds:[0,0,1,1]}],[-1,0,1,1]),false);
});
test('기본 경로 7개는 OSM 출처·현재 코스 번호·원본 시각을 포함하고 선형 검증을 통과한다',()=>{
  assert.deepEqual(Object.keys(mapDatabase.routes).sort(),['achasan','bukhaksan','bukhansan','buramsan','gwanaksan','inwangsan','suraksan']);
  for(const id of Object.keys(mapDatabase.routes)){
    const route=bundledRoute(id);
    assert.equal(route.provenance,'openstreetmap');
    assert.ok(route.sourceUrl.startsWith('https://www.openstreetmap.org/relation/'));
    assert.ok(Number.isFinite(Date.parse(route.sourceBaseAt)));
    assert.ok(validateRoute(route.segments).km>3);
    assert.equal(route.segments.length,1);
  }
  assert.equal(bundledRoute('suraksan').sourceId,'relation/21955834');
  assert.equal(bundledRoute('buramsan').sourceId,'relation/22020366');
  assert.ok(bundledRoute('suraksan').segments[0][0].lat>bundledRoute('suraksan').segments[0].at(-1).lat);
  assert.ok(bundledRoute('buramsan').segments[0][0].lat>bundledRoute('buramsan').segments[0].at(-1).lat);
});
test('참고 경로의 접근 구간·미검증 안내를 표시하고 코드로 실행하지 않는다',()=>{
  const source=bundledRoute('suraksan');
  const html=renderOfflineMap({...source,note:source.note+'<script>example()</script>'},[],null,{id:'notes-test',mountainId:'suraksan'});
  assert.ok(html.includes('도봉산역에서 A까지 접근 구간'));
  assert.ok(html.includes('&lt;script&gt;example()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});
test('배경 자료는 8개 산을 덮고 올바른 좌표·범위·ODbL 출처를 갖는다',()=>{
  assert.equal(new Set(mapDatabase.coverage.flatMap(c=>c.mountains)).size,8);
  assert.equal(mapDatabase.license.spdx,'ODbL-1.0');
  assert.ok(mapDatabase.features.length>1000);
  for(const feature of mapDatabase.features){
    assert.ok(feature.bounds[0]<=feature.bounds[2]&&feature.bounds[1]<=feature.bounds[3]);
    assert.ok(feature.coordinates.every(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90));
  }
});
test('오프라인 지도에는 기여자·라이선스·미검증 표시를 포함하고 외부 타일을 요청하지 않는다',()=>{
  const route=bundledRoute('achasan');
  const html=renderOfflineMap(route,[],null,{id:'test',mountainId:'achasan'});
  assert.ok(html.includes('© OpenStreetMap contributors'));
  assert.ok(html.includes('ODbL'));
  assert.ok(html.includes('현장 미검증'));
  assert.ok(html.includes('지도 확대'));
  assert.ok(!html.includes('<img')&&!html.includes('tile.openstreetmap.org'));
});
test('배포용 지리자료 JSON과 실행용 데이터 모듈은 동일한 자료를 제공한다',async()=>{
  const json=JSON.parse(await fs.readFile(new URL('../web/map-data/seoul-osm.json',import.meta.url),'utf8'));
  assert.equal(json.features.length,mapDatabase.features.length);
  assert.equal(json.generatedAt,mapDatabase.generatedAt);
  assert.equal(JSON.stringify(json.routes),JSON.stringify(mapDatabase.routes));
});
