// OSM 원본 way의 같은 node 끝점만 연결합니다. 공백을 직선으로 메우지 않습니다.
export function orderedRoute(data, relationId) {
  const relation=data.elements.find(item=>item.type==='relation'&&item.id===relationId);
  if (!relation || relation.visible===false || relation.tags?.route!=='hiking') throw Error('유효한 OSM 도보 경로가 없습니다.');
  const nodes=new Map(data.elements.filter(item=>item.type==='node').map(node=>[node.id,node]));
  const ways=new Map(data.elements.filter(item=>item.type==='way').map(way=>[way.id,way]));
  const seen=new Set();
  const lines=relation.members.filter(member=>member.type==='way').map(member=>{
    if(seen.has(member.ref))throw Error('중복 way 멤버를 검토하세요.');
    seen.add(member.ref);
    const way=ways.get(member.ref);
    if(!way?.nodes || way.nodes.length<2)throw Error('원본 way 좌표 누락');
    if(way.tags?.foot==='no'||(['private','no'].includes(way.tags?.access)&&!['yes','designated','permissive'].includes(way.tags?.foot)))throw Error('보행 제한 way 포함');
    return [...way.nodes];
  });
  let changed=true;
  while(changed){changed=false;outer:for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i],b=lines[j];let line;
    if(a.at(-1)===b[0])line=[...a,...b.slice(1)];
    else if(a.at(-1)===b.at(-1))line=[...a,...[...b].reverse().slice(1)];
    else if(a[0]===b.at(-1))line=[...b,...a.slice(1)];
    else if(a[0]===b[0])line=[...[...b].reverse(),...a.slice(1)];
    if(line){lines[i]=line;lines.splice(j,1);changed=true;break outer;}
  }}
  if(lines.length!==1)throw Error(`기본 경로가 ${lines.length}개 구간으로 끊겨 있습니다.`);
  const segments=lines.map(line=>line.map(id=>{
    const node=nodes.get(id);
    if(!Number.isFinite(node?.lat)||!Number.isFinite(node?.lon))throw Error('원본 node 좌표 누락');
    return {lat:node.lat,lng:node.lon};
  }));
  return {relation,segments};
}

// 참고 코스의 모든 선분이 실제 OSM way의 인접 node인지 재확인합니다.
export function verifyConnectedPath(elements, nodeIds, edgeWayIds) {
  if(nodeIds.length<2||edgeWayIds.length!==nodeIds.length-1)throw Error('경로 선분 구성 오류');
  const nodes=new Map(elements.filter(x=>x.type==='node').map(x=>[x.id,x]));
  const ways=new Map(elements.filter(x=>x.type==='way').map(x=>[x.id,x]));
  for(let i=0;i<edgeWayIds.length;i++){
    const way=ways.get(edgeWayIds[i]),tags=way?.tags||{};
    if(!way||!/^(path|footway|steps|track|pedestrian|residential|service|living_street)$/.test(tags.highway)||tags.foot==='no'||(['no','private'].includes(tags.access)&&!['yes','designated','permissive'].includes(tags.foot)))throw Error('보행 가능 원본 way 확인 필요');
    const a=nodeIds[i],b=nodeIds[i+1];
    if(!way.nodes.some((id,index)=>index>0&&((id===a&&way.nodes[index-1]===b)||(id===b&&way.nodes[index-1]===a))))throw Error('원본에 없는 연결 선분');
  }
  return [nodeIds.map(id=>{
    const node=nodes.get(id),tags=node?.tags||{};
    if(!Number.isFinite(node?.lat)||!Number.isFinite(node?.lon))throw Error('경로 node 누락');
    if(tags.foot==='no'||(['no','private'].includes(tags.access)&&!['yes','designated','permissive'].includes(tags.foot)))throw Error('출입 제한 node 포함');
    return {lat:node.lat,lng:node.lon};
  })];
}
