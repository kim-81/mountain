import fs from 'node:fs/promises';
import {distanceKm} from '../web/js/core.js';
import {validateRoute} from '../web/js/navigation.js';
const raw=await Promise.all(['osm-full-10997594','area-citywall-west','area-citywall-north'].map(async name=>JSON.parse(await fs.readFile(new URL(`../map-source/${name}.json`,import.meta.url),'utf8'))));
const all=new Map();for(const data of raw)for(const item of data.elements)all.set(`${item.type}/${item.id}`,item);
const relation=raw[0].elements.find(item=>item.type==='relation'&&item.id===10997594);
const preferred=new Set(relation.members.filter(m=>m.type==='way').map(m=>m.ref));
const nodes=new Map([...all.values()].filter(x=>x.type==='node').map(x=>[x.id,x]));
const graph=new Map();
for(const way of all.values()){
  if(way.type!=='way')continue;
  const t=way.tags||{};
  if(!/^(path|footway|steps|track|pedestrian|residential|service|living_street)$/.test(t.highway)||t.foot==='no'||t.highway==='construction'||(['no','private'].includes(t.access)&&!['yes','designated','permissive'].includes(t.foot)))continue;
  for(let i=1;i<way.nodes.length;i++){
    const a=nodes.get(way.nodes[i-1]),b=nodes.get(way.nodes[i]);
    if(!a||!b)continue;
    const km=distanceKm({lat:a.lat,lng:a.lon},{lat:b.lat,lng:b.lon});
    for(const [from,to]of [[a.id,b.id],[b.id,a.id]]){
      if(!graph.has(from))graph.set(from,[]);
      graph.get(from).push({to,km,weight:km*(preferred.has(way.id)?1:2),way:way.id,preferred:preferred.has(way.id)});
    }
  }
}
function nearest(point){let best;for(const id of graph.keys()){const n=nodes.get(id);const km=distanceKm(point,{lat:n.lat,lng:n.lon});if(!best||km<best.km)best={id,km};}if(best.km>.08)throw Error('경유지 주변 보행로 없음');return best;}
function shortest(start,end){
  const cost=new Map([[start,0]]),previous=new Map(),pending=new Set([start]);
  while(pending.size){
    let current,min=Infinity;for(const id of pending){if(cost.get(id)<min){min=cost.get(id);current=id;}}
    pending.delete(current);if(current===end)break;
    for(const edge of graph.get(current)||[]){const next=min+edge.weight;if(next<(cost.get(edge.to)??Infinity)){cost.set(edge.to,next);previous.set(edge.to,{from:current,...edge});pending.add(edge.to);}}
  }
  if(!cost.has(end))throw Error('실제로 연결된 보행로 없음');
  const ids=[end],edges=[];let current=end;
  while(current!==start){const p=previous.get(current);if(!p)throw Error('경로 추적 실패');edges.push(p);current=p.from;ids.push(current);}
  return {ids:ids.reverse(),edges:edges.reverse()};
}
const definitions={
  inwangsan:[{name:'돈의문 터',lat:37.5683101,lng:126.9688097},{name:'인왕산 정상',lat:37.584, lng:126.9579},{name:'창의문',lat:37.59262308,lng:126.96651658}],
  bukhaksan:[{name:'창의문',lat:37.59262308,lng:126.96651658},{name:'백악마루',lat:37.5930264,lng:126.9737648},{name:'숙정문',lat:37.5955,lng:126.9815},{name:'와룡공원',lat:37.5917,lng:126.9901},{name:'혜화문',lat:37.58795335,lng:127.00387288}]
};
for(const [id,points]of Object.entries(definitions)){
  try{
    const anchors=points.map(p=>({...p,...nearest(p)})),ids=[],edges=[];
    for(let i=1;i<anchors.length;i++){const section=shortest(anchors[i-1].id,anchors[i].id);ids.push(...section.ids.slice(i===1?0:1));edges.push(...section.edges);}
    const segments=[ids.map(id=>({lat:nodes.get(id).lat,lng:nodes.get(id).lon}))];
    const checked=validateRoute(segments),offRelation=edges.filter(e=>!e.preferred).reduce((s,e)=>s+e.km,0);
    const output={id,anchors,segments,nodeIds:ids,edgeWayIds:edges.map(e=>e.way),wayIds:[...new Set(edges.map(e=>e.way))],nonRelationWays:[...new Set(edges.filter(e=>!e.preferred).map(e=>e.way))],km:checked.km,offRelationKm:offRelation};
    await fs.writeFile(new URL(`../map-source/citywall-candidate-${id}.json`,import.meta.url),JSON.stringify(output));
    console.log(JSON.stringify({...output,segments:undefined,nodeIds:undefined,edgeWayIds:undefined,wayIds:undefined,nonRelationWays:output.nonRelationWays,points:checked.count},null,2));
  }catch(error){console.log(JSON.stringify({id,error:error.message}));}
}
