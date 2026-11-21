// 개발할 때만 실행하는 공개 지리자료 수집기입니다. 앱 사용자의 위치를 전송하지 않습니다.
// 래스터 타일을 내려받지 않으며, ODbL 원시 지리자료를 앱에서 직접 렌더링합니다.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { routeLengthKm } from '../web/js/navigation.js';
import { mapManifest } from '../web/js/map-catalog.js';

if(Object.keys(mapManifest.routes).length>3&&!process.argv.includes('--rebuild-base')) {
  throw Error('추가한 기본 경로가 있습니다. 이 초기 수집기는 3곳만 다시 만듭니다. 원본을 백업하고 --rebuild-base로 실행한 뒤 추가 경로·배경 보강 도구를 순서대로 실행하세요.');
}

const output = new URL('../web/map-data/', import.meta.url);
const archive = new URL('../map-source/', import.meta.url);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(archive, { recursive: true });

const areas = [
  { id: 'west', mountains: ['inwangsan', 'bukhaksan', 'bukhansan'], bounds: [37.56, 126.93, 37.66, 127.015] },
  { id: 'east', mountains: ['achasan', 'bonghwasan'], bounds: [37.535, 127.065, 37.625, 127.13] },
  { id: 'northeast', mountains: ['suraksan', 'buramsan'], bounds: [37.635, 127.035, 37.725, 127.12] },
  { id: 'south', mountains: ['gwanaksan'], bounds: [37.43, 126.94, 37.49, 127.005] }
];
const selectedRelations = [
  { mountainId: 'achasan', courseId: 'seoul-dulle-5', id: 17496414, ref: '5' },
  { mountainId: 'bukhansan', courseId: 'seoul-dulle-18', id: 17506001, ref: '18' },
  { mountainId: 'gwanaksan', courseId: 'seoul-dulle-11', id: 17538300, ref: '11' }
];
const license = {
  name: 'Open Database License 1.0', spdx: 'ODbL-1.0',
  url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors', copyrightUrl: 'https://www.openstreetmap.org/copyright'
};

async function queryOSM(name, query) {
  const cached = new URL(name + '.json', archive);
  if (process.argv.includes('--reuse')) {
    try { return JSON.parse(await fs.readFile(cached, 'utf8')); } catch {}
  }
  console.log('조회 시작: ' + name);
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SangilTtara/0.3 local-development' },
    body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(65000)
  });
  if (!response.ok) throw Error(name + ': Overpass HTTP ' + response.status);
  const data = await response.json();
  if (data.remark) throw Error(name + ': 불완전한 응답 ' + data.remark);
  if (!data.elements?.length) throw Error(name + ': 지리자료가 없습니다.');
  await fs.writeFile(cached, JSON.stringify(data));
  console.log(`${name}: ${data.elements.length}개 객체 수신`);
  return data;
}
const round = n => Math.round(n * 1e6) / 1e6;
const point = p => ({ lat: round(p.lat), lng: round(p.lon) });
const equal = (a, b) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
function simplifyBackground(points, tolerance = 2) {
  if(points.length<=3)return points;
  const latitude=points[0][1],cos=Math.cos(latitude*Math.PI/180);
  const projected=points.map(p=>[(p[0]-points[0][0])*111320*cos,(p[1]-latitude)*111320]);
  const keep=new Uint8Array(points.length);keep[0]=1;keep[points.length-1]=1;
  const stack=[[0,points.length-1]];
  while(stack.length) {
    const [start,end]=stack.pop(),a=projected[start],b=projected[end];
    const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    let farthest=-1,max=tolerance*tolerance;
    for(let i=start+1;i<end;i++) {
      const p=projected[i],t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
      const distance=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
      if(distance>max){max=distance;farthest=i;}
    }
    if(farthest>=0){keep[farthest]=1;stack.push([start,farthest],[farthest,end]);}
  }
  return points.filter((_,i)=>keep[i]).map(p=>p.map(n=>Math.round(n*1e5)/1e5));
}

const rawRoutes = await queryOSM('relations', `[out:json][timeout:45];(${selectedRelations.map(r => 'relation(' + r.id + ');').join('')});out meta geom;`);
const routes = {};
for (const definition of selectedRelations) {
  const relation = rawRoutes.elements.find(r => r.type === 'relation' && r.id === definition.id);
  if (!relation || relation.tags?.ref !== definition.ref || relation.tags?.fixme) throw Error('경로의 현재 코스 번호를 확인하세요: ' + definition.id);
  const segments = [];
  for (const member of relation.members || []) {
    if (member.type !== 'way' || !member.geometry?.length) continue;
    let line = member.geometry.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(point);
    if (line.length < 2) continue;
    if (member.role === 'backward') line.reverse();
    const previous = segments.at(-1);
    if (previous && equal(previous.at(-1), line[0])) previous.push(...line.slice(1));
    else if (previous && equal(previous.at(-1), line.at(-1))) previous.push(...line.reverse().slice(1));
    else segments.push(line);
  }
  if (!segments.length) throw Error('선형 경로가 없습니다: ' + definition.id);
  // 관계 멤버의 순서/방향이 다른 경우에도 좌표가 정확히 같은 끝점만 이어 붙입니다.
  // 떨어진 끝점 사이에 새로운 선분을 만들지 않습니다.
  const initialPoint=segments[0][0];
  let changed=true;
  while(changed) {
    changed=false;
    outer:for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++) {
      const a=segments[i],b=segments[j];let joined=null;
      if(equal(a.at(-1),b[0]))joined=[...a,...b.slice(1)];
      else if(equal(a.at(-1),b.at(-1)))joined=[...a,...[...b].reverse().slice(1)];
      else if(equal(a[0],b.at(-1)))joined=[...b,...a.slice(1)];
      else if(equal(a[0],b[0]))joined=[...[...b].reverse(),...a.slice(1)];
      if(joined){segments[i]=joined;segments.splice(j,1);changed=true;break outer;}
    }
  }
  if(segments.length===1) {
    const line=segments[0];
    const distance=p=>(p.lat-initialPoint.lat)**2+(p.lng-initialPoint.lng)**2;
    if(distance(line.at(-1))<distance(line[0]))line.reverse();
  }
  routes[definition.mountainId] = {
    courseId: definition.courseId, name: relation.tags.name, segments,
    provenance: 'openstreetmap', sourceUrl: `https://www.openstreetmap.org/relation/${relation.id}`,
    sourceId: 'relation/' + relation.id, sourceModifiedAt: relation.timestamp,
    downloadedAt: new Date().toISOString(), sourceBaseAt: rawRoutes.osm3s?.timestamp_osm_base,
    validation: 'community-data-not-field-verified', license
  };
}

const allFeatures = new Map();
const coverage = [];
for (const area of areas) {
  const box = area.bounds.join(',');
  const query = `[out:json][timeout:45];(way["highway"~"^(path|footway|steps|track|residential|tertiary|secondary|primary|service|pedestrian)$"](${box});way["natural"~"^(wood|water)$"](${box});way["landuse"="forest"](${box});way["waterway"~"^(river|stream)$"](${box});node["natural"="peak"](${box}););out geom;`;
  const raw = await queryOSM(area.id, query);
  let count = 0;
  for (const item of raw.elements) {
    const tags = item.tags || {};
    const original = item.type === 'node' ? [[round(item.lon), round(item.lat)]] : (item.geometry || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [round(p.lon), round(p.lat)]);
    const coordinates = item.type === 'node' ? original : simplifyBackground(original);
    if (!coordinates.length) continue;
    const kind = tags.natural === 'peak' ? 'peak' : tags.natural === 'water' ? 'water' : (tags.natural === 'wood' || tags.landuse === 'forest') ? 'forest' : tags.waterway ? 'stream' : ['path', 'footway', 'steps', 'track'].includes(tags.highway) ? 'trail' : 'road';
    const xs = coordinates.map(p => p[0]), ys = coordinates.map(p => p[1]);
    allFeatures.set(item.type + '/' + item.id, {
      id: item.type + '/' + item.id, kind,
      ...((tags['name:ko'] || tags.name) ? {name:tags['name:ko'] || tags.name}:{}),
      ...((tags.access || tags.foot) ? {access:tags.access || tags.foot}:{}),
      coordinates, bounds: [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)]
    });
    count++;
  }
  coverage.push({ ...area, sourceBaseAt: raw.osm3s?.timestamp_osm_base, featureCount: count });
}
const database = {
  version: 1, generatedAt: new Date().toISOString(), license, coverage,
  features: [...allFeatures.values()], routes
};
const json = JSON.stringify(database);
await fs.writeFile(new URL('seoul-osm.json', output), json);
await fs.writeFile(new URL('../js/map-database.js', output), '// OSM 파생 지리자료 · ODbL-1.0 · 자세한 출처는 web/map-data/README.md\nexport const mapDatabase = ' + json + ';\n');
const manifest={
  generatedAt:database.generatedAt,license,coverage,
  routes:Object.fromEntries(Object.entries(routes).map(([id,route])=>[id,{
    courseId:route.courseId,sourceId:route.sourceId,sourceUrl:route.sourceUrl,
    sourceBaseAt:route.sourceBaseAt,sourceModifiedAt:route.sourceModifiedAt,
    status:'osm-not-field-verified',count:route.segments.reduce((sum,s)=>sum+s.length,0),km:routeLengthKm(route.segments)
  }]))
};
await fs.writeFile(new URL('../js/map-catalog.js',output),'// 기본 경로 메타데이터. 서버는 큰 지도 파일 대신 이 목록만 읽습니다.\nexport const mapManifest = '+JSON.stringify(manifest,null,2)+';\n');
console.log(JSON.stringify({ output: fileURLToPath(output), bytes: Buffer.byteLength(json), features: database.features.length, routes: Object.keys(routes), segments: Object.fromEntries(Object.entries(routes).map(([id, r]) => [id, r.segments.length])) }, null, 2));
