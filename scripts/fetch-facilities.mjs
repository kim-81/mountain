import fs from 'node:fs/promises';
import {mapManifest} from '../web/js/map-catalog.js';
import {mapDatabase} from '../web/js/map-database.js';
import {mountains} from '../web/js/data.js';
import {distanceKm} from '../web/js/core.js';
const root=new URL('../map-source/',import.meta.url);
await fs.mkdir(root,{recursive:true});
const archive=new URL('facilities.json',root);
let data;
if(process.argv.includes('--reuse')) data=JSON.parse(await fs.readFile(archive,'utf8'));
else {
  const queries=mapManifest.coverage.flatMap(area=>{
    const bounds=area.bounds.join(',');
    return [`nwr["amenity"~"^(toilets|drinking_water|parking|shelter|restaurant|cafe)$"](${bounds});`,`nwr["shop"="convenience"](${bounds});`,`nwr["tourism"="information"](${bounds});`];
  });
  const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'SangilTtara/0.8 local-development'},body:new URLSearchParams({data:'[out:json][timeout:60];('+queries.join('')+');out meta center;'}),signal:AbortSignal.timeout(70000)});
  if(!response.ok)throw Error('시설 조회 HTTP '+response.status);
  data=await response.json();if(data.remark)throw Error(data.remark);
  await fs.writeFile(archive,JSON.stringify(data));
}
const features=[];
for(const element of data.elements||[]) {
  const tags=element.tags||{};if(['private','no'].includes(tags.access))continue;
  const lat=element.lat??element.center?.lat,lng=element.lon??element.center?.lon;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)continue;
  const kind=tags.shop==='convenience'?'convenience':tags.tourism==='information'?'information':tags.amenity;
  if(!['toilets','drinking_water','parking','shelter','restaurant','cafe','convenience','information'].includes(kind))continue;
  const id=element.type+'/'+element.id;
  const text=(value,max=160)=>typeof value==='string'?value.slice(0,max):null;
  features.push({id,kind,name:text(tags['name:ko']||tags.name)||null,lat,lng,approximate:element.type!=='node',
    openingHours:text(tags.opening_hours),fee:text(tags.fee,40),wheelchair:text(tags.wheelchair,40),cuisine:text(tags.cuisine,80),
    address:text([tags['addr:city'],tags['addr:street'],tags['addr:housenumber']].filter(Boolean).join(' '))||null,
    sourceUrl:'https://www.openstreetmap.org/'+id,sourceModifiedAt:element.timestamp||null});
}
const selected=new Map(),mountainIndex={};
for(const mountain of mountains) {
  const route=mapDatabase.routes[mountain.id];
  const points=route?.segments.flat()||[];
  const references=[mountain,...(points.length?[points[0],points.at(-1)]:[])];
  const ids=new Set();
  for(const reference of references) {
    const counts={};
    for(const item of features.map(feature=>({...feature,distance:distanceKm(reference,feature)})).filter(feature=>feature.distance<=3).sort((a,b)=>a.distance-b.distance)) {
      if(['restaurant','cafe','convenience'].includes(item.kind)&&!item.name)continue;
      if((counts[item.kind]||0)>=20)continue;
      counts[item.kind]=(counts[item.kind]||0)+1;ids.add(item.id);
    }
  }
  mountainIndex[mountain.id]=[...ids];
  for(const item of features)if(ids.has(item.id))selected.set(item.id,item);
}
const database={version:1,generatedAt:new Date().toISOString(),sourceBaseAt:data.osm3s?.timestamp_osm_base||null,license:mapManifest.license,searchRadiusKm:3,maxPerCategoryPerReference:20,mountainIndex,features:[...selected.values()]};
await fs.writeFile(new URL('../web/map-data/seoul-facilities.json',import.meta.url),JSON.stringify(database));
await fs.writeFile(new URL('../web/js/facility-database.js',import.meta.url),'// 공개 OSM 시설 등록 자료 · ODbL-1.0 · 영업/개방은 현장 미확인\nexport const facilityDatabase = '+JSON.stringify(database)+';\n');
console.log(JSON.stringify({sourceCount:features.length,packagedCount:database.features.length,byMountain:Object.fromEntries(Object.entries(mountainIndex).map(([id,items])=>[id,items.length])),sourceBaseAt:database.sourceBaseAt},null,2));
