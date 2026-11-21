import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedRoute,verifyConnectedPath} from '../scripts/lib/osm-route.mjs';
const fixture=()=>({elements:[
  ...[1,2,3,4].map(id=>({type:'node',id,lat:37+id*.0001,lon:127})),
  {type:'way',id:10,nodes:[3,2]}, {type:'way',id:11,nodes:[4,3]}, {type:'way',id:12,nodes:[1,2]},
  {type:'relation',id:20,tags:{route:'hiking'},members:[10,11,12].map(ref=>({type:'way',ref}))}
]});
test('멤버 순서·방향이 달라도 원본 node 연결만으로 경로를 만든다',()=>{
  const line=orderedRoute(fixture(),20).segments[0];
  assert.deepEqual(line.map(p=>p.lat),[37.0004,37.0003,37.0002,37.0001]);
});
test('조합 경로는 실제 원본의 인접 node만 허용하고 가짜 연결·출입 제한을 차단한다',()=>{
  const data=fixture();for(const way of data.elements.filter(x=>x.type==='way'))way.tags={highway:'footway'};
  assert.equal(verifyConnectedPath(data.elements,[1,2,3,4],[12,10,11])[0].length,4);
  assert.throws(()=>verifyConnectedPath(data.elements,[1,3],[12]),/원본에 없는/);
  data.elements[1].tags={access:'private'};
  assert.throws(()=>verifyConnectedPath(data.elements,[1,2],[12]),/출입 제한/);
});
test('분리된 끝점·중복 멤버·보행 제한·좌표 누락은 묵인하지 않는다',()=>{
  let data=fixture();data.elements.find(x=>x.id===12).nodes=[1,4];
  // 모두 이어진 경우에는 닫힌 경로도 허용하지만 실제로 떨어진 경우는 거부합니다.
  data.elements.find(x=>x.id===12).nodes=[1,5];
  assert.throws(()=>orderedRoute(data,20),/끊겨/);
  data=fixture();data.elements.at(-1).members.push({type:'way',ref:10});assert.throws(()=>orderedRoute(data,20),/중복/);
  data=fixture();data.elements.find(x=>x.id===10).tags={foot:'no'};assert.throws(()=>orderedRoute(data,20),/보행 제한/);
  data=fixture();data.elements[0].lat=NaN;assert.throws(()=>orderedRoute(data,20),/좌표 누락/);
});
