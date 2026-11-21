import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mapDatabase} from '../web/js/map-database.js';
import {mapManifest} from '../web/js/map-catalog.js';
import {courseCatalog} from '../web/js/catalog.js';
import {distanceKm} from '../web/js/core.js';
import {validateRoute} from '../web/js/navigation.js';
import {orderedRoute} from './lib/osm-route.mjs';

const definitions=[
  {mountainId:'suraksan',id:21955834,start:{lat:37.6894721,lng:127.0473537},end:{lat:37.672831,lng:127.0743867},name:/수락산|1코스/,
    note:'지도 경로 A는 서울창포원 쪽 1코스 분기점입니다. 도봉산역에서 A까지 접근 구간은 이 선에 포함되지 않습니다.'},
  {mountainId:'buramsan',id:22020366,start:{lat:37.6683452,lng:127.0837119},end:{lat:37.62044,lng:127.0851238},name:/3코스.*불암산/,
    note:'상계동 나들이 철쭉동산 쪽에서 화랑대역 쪽으로 표시합니다. 공식 안내 거리와 지도 계산 거리는 다를 수 있습니다.'}
];
const db=structuredClone(mapDatabase),manifest=structuredClone(mapManifest);
for(const definition of definitions){
  const file=new URL(`../map-source/osm-full-${definition.id}.json`,import.meta.url);
  const bytes=await fs.readFile(file),data=JSON.parse(bytes);
  const {relation,segments}=orderedRoute(data,definition.id);
  if(!definition.name.test(relation.tags.name)||relation.tags.fixme)throw Error('경로 이름 또는 보완 표시를 확인하세요.');
  const line=segments[0];
  if(distanceKm(line[0],definition.start)>distanceKm(line.at(-1),definition.start))line.reverse();
  if(distanceKm(line[0],definition.start)>.03||distanceKm(line.at(-1),definition.end)>.03)throw Error('검토한 출발·도착점과 다릅니다.');
  const validated=validateRoute(segments),course=courseCatalog[definition.mountainId];
  if(Math.abs(validated.km-course.km)/course.km>.1)throw Error('공식 안내와 거리 차이 검토 필요');
  const downloadedAt=(await fs.stat(file)).mtime.toISOString();
  const route={courseId:course.id,name:relation.tags.name,segments,provenance:'openstreetmap',
    sourceUrl:`https://www.openstreetmap.org/relation/${relation.id}`,sourceId:`relation/${relation.id}`,
    sourceModifiedAt:relation.timestamp,downloadedAt,sourceBaseAt:downloadedAt,
    sourceTimeBasis:'api-download',sourceVersion:relation.version,sourceSha256:createHash('sha256').update(bytes).digest('hex'),
    validation:'community-data-not-field-verified',license:db.license,note:definition.note};
  db.routes[definition.mountainId]=route;
  manifest.routes[definition.mountainId]={courseId:course.id,sourceId:route.sourceId,sourceUrl:route.sourceUrl,sourceBaseAt:downloadedAt,
    sourceModifiedAt:route.sourceModifiedAt,status:'osm-not-field-verified',count:validated.count,km:validated.km};
  console.log(`${definition.mountainId}: ${validated.count}점, ${validated.km.toFixed(3)}km`);
}
db.generatedAt=new Date().toISOString();manifest.generatedAt=db.generatedAt;
const output=new URL('../web/',import.meta.url),json=JSON.stringify(db);
await fs.writeFile(new URL('map-data/seoul-osm.json',output),json);
await fs.writeFile(new URL('js/map-database.js',output),'// OSM 파생 지리자료 · ODbL-1.0 · 자세한 출처는 web/map-data/README.md\nexport const mapDatabase = '+json+';\n');
await fs.writeFile(new URL('js/map-catalog.js',output),'// 기본 경로 메타데이터. 서버는 큰 지도 파일 대신 이 목록만 읽습니다.\nexport const mapManifest = '+JSON.stringify(manifest,null,2)+';\n');
