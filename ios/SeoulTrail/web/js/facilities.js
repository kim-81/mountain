import {facilityDatabase} from './facility-database.js';
import {distanceKm,escapeHTML as e} from './core.js';
const byId=new Map(facilityDatabase.features.map(item=>[item.id,item]));
export const facilityKinds={all:'전체',toilets:'화장실',drinking_water:'식수대',parking:'주차장',shelter:'쉼터',restaurant:'식당',cafe:'카페',convenience:'편의점',information:'안내'};
export function facilityReference(mountain,origin,route) {
  const points=route?.segments?.flat()||[];
  if(points.length&&origin==='start')return {...points[0],label:'선택 경로 출발점'};
  if(points.length&&origin==='end')return {...points.at(-1),label:'선택 경로 도착점'};
  return {lat:mountain.lat,lng:mountain.lng,label:'산 대표 위치'};
}
export function nearbyFacilities(mountain,{kind='all',origin='start',route=null,radius=1,limit=20}={}) {
  const reference=facilityReference(mountain,origin,route);
  const selectedRadius=[.5,1,3].includes(Number(radius))?Number(radius):1;
  const ids=facilityDatabase.mountainIndex[mountain.id]||[];
  const matches=ids.map(id=>byId.get(id)).filter(Boolean).filter(item=>kind==='all'||item.kind===kind)
    .map(item=>({...item,distanceKm:distanceKm(reference,item)})).filter(item=>item.distanceKm<=selectedRadius)
    .sort((a,b)=>a.distanceKm-b.distanceKm||a.id.localeCompare(b.id));
  return {reference,items:matches.slice(0,Math.min(50,Math.max(1,limit))),count:matches.length,radius:selectedRadius,sourceBaseAt:facilityDatabase.sourceBaseAt};
}
export function facilityById(id){return byId.get(id)||null;}
export function facilityPanel(mountain,options,route,mapHTML) {
  const result=nearbyFacilities(mountain,{...options,route});
  const hasRoute=Boolean(route?.segments?.flat().length);
  const date=new Date(facilityDatabase.sourceBaseAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'});
  return `<div class="facility-intro"><h3>주변 시설과 식당</h3><p>공개지도 등록 정보입니다. 영업·개방·음용 가능 여부는 현장 미확인입니다.</p><p>${e(result.reference.label)} 기준 <b>직선거리</b>입니다. 실제 걷는 길이나 접근 가능 여부를 뜻하지 않습니다.</p></div>
    <div class="form-grid facility-controls"><label>거리 기준<select id="facility-origin"><option value="start" ${hasRoute&&options.origin==='start'?'selected':''} ${hasRoute?'':'disabled'}>선택 경로 출발점</option><option value="end" ${hasRoute&&options.origin==='end'?'selected':''} ${hasRoute?'':'disabled'}>선택 경로 도착점</option><option value="mountain" ${!hasRoute||options.origin==='mountain'?'selected':''}>산 대표 위치</option></select></label><label>표시 반경<select id="facility-radius">${[.5,1,3].map(km=>`<option value="${km}" ${Number(options.radius)===km?'selected':''}>${km}km 이내</option>`).join('')}</select></label></div>
    <div class="filter-row facility-filters">${Object.entries(facilityKinds).map(([kind,label])=>`<button class="chip ${options.kind===kind?'selected':''}" aria-pressed="${options.kind===kind}" data-action="facility-filter" data-kind="${kind}">${label}</button>`).join('')}</div>
    ${mapHTML(result.items)}
    <p class="muted">수집 범위의 등록 자료 ${result.count}곳 중 가까운 ${result.items.length}곳 표시 · 지도 자료 기준 ${e(date)}</p>
    <div class="facility-list">${result.items.map((item,index)=>`<article class="facility-item"><div><span class="data-badge">${index+1} · ${e(facilityKinds[item.kind])}</span><h4>${e(item.name||facilityKinds[item.kind]+' (이름 미등록)')}</h4><p>직선 약 ${item.distanceKm<1?Math.round(item.distanceKm*1000)+'m':item.distanceKm.toFixed(1)+'km'}${item.approximate?' · 건물/영역 대표 좌표':''}</p>${item.address?`<p>${e(item.address)}</p>`:''}${item.openingHours?`<p>등록된 운영 시간: ${e(item.openingHours)} · 현재 영업 미확인</p>`:''}${item.kind==='drinking_water'?'<p>음용 가능 여부와 관리 상태를 현장에서 확인하세요.</p>':''}</div><div class="facility-links"><button class="small-link" data-action="facility-focus" data-id="${item.id}">지도에서 표시</button><a class="small-link" href="${item.sourceUrl}" target="_blank" rel="noopener">등록 원문 ↗</a><a class="small-link" href="https://map.naver.com/p/search/${encodeURIComponent((item.name||mountain.name+' '+facilityKinds[item.kind]))}" target="_blank" rel="noopener">지도 검색 ↗</a></div></article>`).join('')||'<div class="empty"><p>수집한 자료에서 해당 조건의 시설을 찾지 못했습니다. 반경·분류를 바꾸거나 공식 안내를 확인해 주세요.</p></div>'}</div>
    <p class="source-note"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL-1.0</a> · 대표 위치·경로 양 끝의 3km 안에서 분류별 가까운 자료를 선별한 목록으로 모든 시설을 포함하지 않습니다.</p>`;
}
