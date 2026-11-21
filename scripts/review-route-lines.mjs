import fs from 'node:fs/promises';
import {distanceKm} from '../web/js/core.js';
import {validateRoute} from '../web/js/navigation.js';

for(const id of process.argv.slice(2).map(Number)) {
  const data=JSON.parse(await fs.readFile(new URL(`../map-source/osm-full-${id}.json`,import.meta.url),'utf8'));
  const relation=data.elements.find(item=>item.type==='relation'&&item.id===id);
  const nodes=new Map(data.elements.filter(item=>item.type==='node').map(node=>[node.id,node]));
  const ways=new Map(data.elements.filter(item=>item.type==='way').map(way=>[way.id,way]));
  const lines=relation.members.filter(member=>member.type==='way').map(member=>{
    const way=ways.get(member.ref);if(!way)throw Error('원본 way 누락');
    return [...way.nodes];
  });
  let changed=true;
  while(changed){changed=false;outer:for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    let a=lines[i],b=lines[j],line;
    if(a.at(-1)===b[0])line=[...a,...b.slice(1)];
    else if(a.at(-1)===b.at(-1))line=[...a,...[...b].reverse().slice(1)];
    else if(a[0]===b.at(-1))line=[...b,...a.slice(1)];
    else if(a[0]===b[0])line=[...[...b].reverse(),...a.slice(1)];
    if(line){lines[i]=line;lines.splice(j,1);changed=true;break outer;}
  }}
  const segments=lines.map(line=>line.map(id=>{const node=nodes.get(id);if(!node)throw Error('원본 node 누락');return {lat:node.lat,lng:node.lon};}));
  const stats=segments.map(segment=>{
    let max=0;for(let i=1;i<segment.length;i++)max=Math.max(max,distanceKm(segment[i-1],segment[i]));
    return {...validateRoute([segment]),segments:undefined,start:segment[0],end:segment.at(-1),maxStepMeters:Math.round(max*1000)};
  });
  await fs.writeFile(new URL(`../map-source/route-review-${id}.json`,import.meta.url),JSON.stringify({relation,segments,stats}));
  console.log(JSON.stringify({id,tags:relation.tags,modified:relation.timestamp,lines:stats},null,2));
}
