import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mapDatabase} from '../web/js/map-database.js';
import {mapManifest} from '../web/js/map-catalog.js';
import {courseCatalog} from '../web/js/catalog.js';
import {validateRoute} from '../web/js/navigation.js';
import {verifyConnectedPath} from './lib/osm-route.mjs';
const sourceFiles=['osm-full-10997594','area-citywall-west','area-citywall-north'];
const sources=await Promise.all(sourceFiles.map(async name=>{const file=new URL(`../map-source/${name}.json`,import.meta.url);const bytes=await fs.readFile(file);return {name,bytes,data:JSON.parse(bytes),at:(await fs.stat(file)).mtime.toISOString()};}));
const merged=new Map();for(const source of sources)for(const item of source.data.elements)merged.set(`${item.type}/${item.id}`,item);
const elements=[...merged.values()];
const relation=elements.find(x=>x.type==='relation'&&x.id===10997594);
const db=structuredClone(mapDatabase),manifest=structuredClone(mapManifest);
for(const id of ['inwangsan','bukhaksan']){
  const candidate=JSON.parse(await fs.readFile(new URL(`../map-source/citywall-candidate-${id}.json`,import.meta.url),'utf8'));
  const segments=verifyConnectedPath(elements,candidate.nodeIds,candidate.edgeWayIds),checked=validateRoute(segments),course=courseCatalog[id];
  if(Math.abs(checked.km-course.km)/course.km>.1)throw Error('현재 코스 거리 대조 필요');
  if(candidate.offRelationKm>.5)throw Error('순성길 외 연결 비중 검토 필요');
  const downloadedAt=sources.map(s=>s.at).sort().at(-1);
  const route={courseId:course.id,name:`한양도성 ${id==='inwangsan'?'인왕':'백악'}구간 · OSM 보행로`,segments,
    provenance:'openstreetmap',sourceId:'relation/10997594',sourceUrl:'https://www.openstreetmap.org/relation/10997594',
    sourceModifiedAt:relation.timestamp,sourceBaseAt:downloadedAt,downloadedAt,sourceTimeBasis:'api-download',
    sourceSha256:createHash('sha256').update(JSON.stringify(sources.map(s=>createHash('sha256').update(s.bytes).digest('hex')))).digest('hex'),
    sourceWayIds:candidate.wayIds,connectingWayIds:candidate.nonRelationWays,
    validation:'community-data-not-field-verified',license:db.license,
    note:'OSM 순성길과 등록 보행로를 연결해 구성한 참고 경로입니다. 공식 GPX가 아니며, 탐방 시간·통제는 출발 전에 공식 안내에서 확인하세요.'};
  db.routes[id]=route;
  manifest.routes[id]={courseId:course.id,sourceId:route.sourceId,sourceUrl:route.sourceUrl,sourceBaseAt:downloadedAt,sourceModifiedAt:route.sourceModifiedAt,status:'osm-not-field-verified',count:checked.count,km:checked.km};
  console.log(`${id}: ${checked.count}점 · ${checked.km.toFixed(3)}km`);
}
db.generatedAt=new Date().toISOString();manifest.generatedAt=db.generatedAt;
const folder=new URL('../web/',import.meta.url),json=JSON.stringify(db);
await fs.writeFile(new URL('map-data/seoul-osm.json',folder),json);
await fs.writeFile(new URL('js/map-database.js',folder),'// OSM 파생 지리자료 · ODbL-1.0 · 자세한 출처는 web/map-data/README.md\nexport const mapDatabase = '+json+';\n');
await fs.writeFile(new URL('js/map-catalog.js',folder),'// 기본 경로 메타데이터. 서버는 큰 지도 파일 대신 이 목록만 읽습니다.\nexport const mapManifest = '+JSON.stringify(manifest,null,2)+';\n');
