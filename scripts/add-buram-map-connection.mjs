import fs from 'node:fs/promises';
import {mapDatabase} from '../web/js/map-database.js';
import {mapManifest} from '../web/js/map-catalog.js';
const file=new URL('../map-source/area-buram-connection.json',import.meta.url);
const raw=JSON.parse(await fs.readFile(file,'utf8'));
const nodes=new Map(raw.elements.filter(x=>x.type==='node').map(x=>[x.id,x]));
const features=new Map(mapDatabase.features.map(feature=>[feature.id,feature]));
let count=0;
for(const item of raw.elements){
  const tags=item.tags||{};
  if(item.type==='node'?tags.natural!=='peak':item.type!=='way'||!(/^(path|footway|steps|track|residential|tertiary|secondary|primary|service|pedestrian)$/.test(tags.highway)||['wood','water'].includes(tags.natural)||tags.landuse==='forest'||['river','stream'].includes(tags.waterway)))continue;
  const points=item.type==='node'?[item]:item.nodes.map(id=>nodes.get(id));
  if(points.some(point=>!Number.isFinite(point?.lat)||!Number.isFinite(point?.lon)))throw Error('지도 way 원본 좌표 누락');
  const coordinates=points.map(p=>[p.lon,p.lat]);
  const xs=coordinates.map(p=>p[0]),ys=coordinates.map(p=>p[1]);
  const kind=tags.natural==='peak'?'peak':tags.natural==='water'?'water':tags.natural==='wood'||tags.landuse==='forest'?'forest':tags.waterway?'stream':['path','footway','steps','track'].includes(tags.highway)?'trail':'road';
  const feature={id:`${item.type}/${item.id}`,kind,coordinates,bounds:[Math.min(...ys),Math.min(...xs),Math.max(...ys),Math.max(...xs)]};
  if(tags['name:ko']||tags.name)feature.name=tags['name:ko']||tags.name;
  if(tags.access||tags.foot)feature.access=tags.access||tags.foot;
  features.set(feature.id,feature);count++;
}
const coverage={id:'buram-connection',mountains:['buramsan'],bounds:[37.619,127.065,37.636,127.095],sourceBaseAt:(await fs.stat(file)).mtime.toISOString(),featureCount:count};
const db={...mapDatabase,generatedAt:new Date().toISOString(),features:[...features.values()],coverage:[...mapDatabase.coverage.filter(c=>c.id!==coverage.id),coverage]};
const manifest={...mapManifest,generatedAt:db.generatedAt,coverage:db.coverage};
const output=new URL('../web/',import.meta.url),json=JSON.stringify(db);
await fs.writeFile(new URL('map-data/seoul-osm.json',output),json);
await fs.writeFile(new URL('js/map-database.js',output),'// OSM 파생 지리자료 · ODbL-1.0 · 자세한 출처는 web/map-data/README.md\nexport const mapDatabase = '+json+';\n');
await fs.writeFile(new URL('js/map-catalog.js',output),'// 기본 경로 메타데이터. 서버는 큰 지도 파일 대신 이 목록만 읽습니다.\nexport const mapManifest = '+JSON.stringify(manifest,null,2)+';\n');
console.log(`불암산 남쪽 배경지도 ${count}객체 보강`);
