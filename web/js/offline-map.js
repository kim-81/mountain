import { escapeHTML } from './core.js';
import { routeLengthKm } from './navigation.js';
import { mapDatabase } from './map-database.js';
import { projectPoint, fitMapBounds, zoomMapBounds, panMapBounds, geographicBounds, boundsIntersect, coverageContains } from './map-geometry.js';

const mapViews = new Map();
let drag = null;
const routeCache = new Map();

export function bundledRoute(mountainId) {
  if(routeCache.has(mountainId))return routeCache.get(mountainId);
  const route = mapDatabase.routes[mountainId];
  if (!route) return null;
  const result = {
    ...route, count: route.segments.reduce((sum, segment) => sum + segment.length, 0),
    km: routeLengthKm(route.segments)
  };
  routeCache.set(mountainId,result);return result;
}
export function mapInteractionActive(){return drag!==null;}
export function mapDataSummary(mountainId) {
  return { coverage: mapDatabase.coverage.filter(c => c.mountains.includes(mountainId)), routes: Object.keys(mapDatabase.routes), generatedAt: mapDatabase.generatedAt };
}
function pathFor(points, view, pair = false) {
  const width = view.bounds.maxX - view.bounds.minX, height = view.bounds.maxY - view.bounds.minY;
  return points.map((p,index) => {
    const point = projectPoint(pair ? { lat:p[1],lng:p[0] } : p);
    return `${index?'L':'M'}${((point.x-view.bounds.minX)/width*560).toFixed(1)},${((view.bounds.maxY-point.y)/height*360).toFixed(1)}`;
  }).join(' ');
}
function coordinateOnMap(point, view) {
  const p=projectPoint(point), b=view.bounds;
  return { x:(p.x-b.minX)/(b.maxX-b.minX)*560, y:(b.maxY-p.y)/(b.maxY-b.minY)*360 };
}
function drawSVG(view) {
  const bounds = geographicBounds(view.bounds);
  const visible = mapDatabase.features.filter(feature => boundsIntersect(feature.bounds,bounds));
  const layerOrder = { forest:0,water:1,stream:2,road:3,trail:4,peak:5 };
  visible.sort((a,b) => layerOrder[a.kind]-layerOrder[b.kind]);
  const labels=[];
  const content = visible.map(feature => {
    const points=feature.coordinates;
    const path=pathFor(points,view,true);
    const restricted=['no','private'].includes(feature.access);
    let shape='';
    if(feature.kind==='peak') {
      const p=coordinateOnMap({lat:points[0][1],lng:points[0][0]},view);
      shape=`<path d="M${p.x-4} ${p.y+3}l4-8 4 8z" fill="#677553"/>`;
    } else if(['forest','water'].includes(feature.kind)) {
      const first=points[0],last=points.at(-1),closed=first[0]===last[0]&&first[1]===last[1];
      shape=`<path d="${path}${closed?' Z':''}" fill="${closed?(feature.kind==='forest'?'#d6e3c8':'#c3dbdf'):'none'}" stroke="${feature.kind==='forest'?'#bdcdb0':'#a3c8cf'}" stroke-width=".6"/>`;
    } else if(feature.kind==='road') {
      shape=`<path d="${path}" fill="none" stroke="#c9c5b2" stroke-width="3.6"/><path d="${path}" fill="none" stroke="#faf7eb" stroke-width="2.1"/>`;
    } else {
      shape=`<path d="${path}" fill="none" stroke="${feature.kind==='stream'?'#9bbfc8':restricted?'#bf8279':'#a5a38b'}" stroke-width="${feature.kind==='stream'?1.2:1}" ${feature.kind==='trail'?'stroke-dasharray="3 2"':''}/>`;
    }
    if(feature.name && labels.length<22 && ['peak','road','water'].includes(feature.kind)) {
      const center=points[Math.floor(points.length/2)],p=coordinateOnMap({lat:center[1],lng:center[0]},view);
      if(p.x>20&&p.x<540&&p.y>28&&p.y<335&&!labels.some(l=>Math.hypot(l.x-p.x,l.y-p.y)<55)) labels.push({...p,name:feature.name,peak:feature.kind==='peak'});
    }
    return shape;
  }).join('');
  const routePaths=(view.route?.segments||[]).map(segment=>`<path d="${pathFor(segment,view)}" fill="none" stroke="white" stroke-width="7"/><path d="${pathFor(segment,view)}" fill="none" stroke="#bd7144" stroke-width="3.8"/>`).join('');
  const trackGroups=[];
  for(const fix of view.fixes) {
    const group=trackGroups.at(-1);
    if(!group||fix.time-group.at(-1).time>120000)trackGroups.push([fix]);else group.push(fix);
  }
  const records=trackGroups.filter(group=>group.length>1).map(group=>`<path d="${pathFor(group,view)}" fill="none" stroke="#2d614e" stroke-width="3"/>`).join('');
  const routePoints=view.route?.segments.flat()||[];
  const facilityMarkers=(view.facilities||[]).map((item,index)=>{
    const p=coordinateOnMap(item,view);
    return `<g><title>${index+1}. ${escapeHTML(item.name||'시설 등록 지점')}</title><circle cx="${p.x}" cy="${p.y}" r="${view.focusedFacility===item.id?12:9}" fill="${view.focusedFacility===item.id?'#9b5939':'#657b80'}" stroke="white" stroke-width="2"/><text x="${p.x}" y="${p.y+3.5}" fill="white" text-anchor="middle" font-size="9">${index+1}</text></g>`;
  }).join('');
  const marker=(point,text,color)=>{
    if(!point)return '';
    const p=coordinateOnMap(point,view);
    return `<circle cx="${p.x}" cy="${p.y}" r="9" fill="${color}" stroke="white" stroke-width="2"/><text x="${p.x}" y="${p.y+3.5}" fill="white" text-anchor="middle" font-size="10">${text}</text>`;
  };
  const position=view.position?coordinateOnMap(view.position,view):null;
  const location=position?`<circle cx="${position.x}" cy="${position.y}" r="10" fill="#387ec4" stroke="white" stroke-width="3"/>`:'';
  const covered=coverageContains(mapDatabase.coverage,bounds);
  const meters=(view.bounds.maxX-view.bounds.minX)*Math.cos(((bounds[0]+bounds[2])/2)*Math.PI/180);
  const scaleMeters=meters>8000?2000:meters>3000?1000:meters>1200?500:meters>500?200:50;
  const scaleWidth=scaleMeters/meters*560;
  return `<svg viewBox="0 0 560 360" aria-label="OSM 도로·산길·숲 배경지도와 GPS 경로" role="img"><defs><clipPath id="map-clip-${view.key}"><rect width="560" height="360"/></clipPath></defs><rect width="560" height="360" fill="#f2f1e6"/><g clip-path="url(#map-clip-${view.key})">${content}${labels.map(p=>`<text x="${p.x}" y="${p.y-7}" text-anchor="middle" font-size="${p.peak?11:9}" fill="#667158" stroke="#f6f7ef" stroke-width="2.5" paint-order="stroke">${escapeHTML(p.name)}</text>`).join('')}${routePaths}${records}${facilityMarkers}${marker(routePoints[0],'A','#354b35')}${marker(routePoints.at(-1),'B','#bd7144')}${location}</g><rect x="9" y="9" width="42" height="23" rx="6" fill="#fffffff0"/><text x="30" y="25" text-anchor="middle" fill="#53654c" font-size="11">N ↑</text><g transform="translate(16 333)"><rect x="-5" y="-16" width="${scaleWidth+15}" height="31" rx="4" fill="#ffffffe0"/><path d="M0-6V0H${scaleWidth}V-6" stroke="#52614b" fill="none" stroke-width="1.5"/><text x="${scaleWidth/2}" y="11" text-anchor="middle" font-size="9" fill="#52614b">${scaleMeters>=1000?scaleMeters/1000+' km':scaleMeters+' m'}</text></g>${!covered?'<rect x="95" y="10" width="370" height="24" rx="7" fill="#fff5db"/><text x="280" y="26" text-anchor="middle" font-size="10" fill="#8e7548">화면 일부가 저장된 배경지도 범위 밖입니다.</text>':''}${position&&(position.x<0||position.x>560||position.y<0||position.y>360)?'<text x="280" y="348" text-anchor="middle" font-size="10" fill="#3978ac">현재 위치가 화면 밖입니다. ‘내 위치’를 눌러 확인하세요.</text>':''}</svg>`;
}

export function renderOfflineMap(route, fixes=[], position=null, options={}) {
  const key=(options.id||'map')+'-'+(options.mountainId||'route');
  let view=mapViews.get(key);
  const pointList=route?.segments.flat()||fixes;
  const center=options.center||{lat:37.58,lng:126.98};
  const fitPoints=pointList.length?pointList:[{lat:center.lat-.012,lng:center.lng-.016},{lat:center.lat+.012,lng:center.lng+.016}];
  if(!view) {view={key,bounds:fitMapBounds(fitPoints),manual:false};mapViews.set(key,view);}
  view.route=route;view.fixes=fixes;view.position=position;view.facilities=options.facilities||[];view.fitBounds=fitMapBounds(fitPoints);
  if(options.resetView)view.manual=false;
  if(!view.manual)view.bounds=view.fitBounds;
  const provenance=route?.provenance==='openstreetmap'?'OSM 기본 경로 · 현장 미검증':route?'사용자 GPX · 현장 미검증':'배경지도 · 기본 경로 미제공';
  return `<div class="offline-map"><div class="map-toolbar-buttons" aria-label="지도 조작"><button data-action="map-zoom-in" data-map-id="${key}" aria-label="지도 확대">+</button><button data-action="map-zoom-out" data-map-id="${key}" aria-label="지도 축소">−</button><button data-action="map-fit" data-map-id="${key}">전체 경로</button><button data-action="map-current" data-map-id="${key}">내 위치</button></div><div class="map-canvas" data-map-view="${key}" tabindex="0" role="region" aria-label="이동 가능한 지도. 방향키로 이동, 더하기·빼기로 확대 축소">${drawSVG(view)}</div><div class="map-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a><span>도로·산길·숲 · 등고선/실시간 통제 미포함</span></div><div class="map-legend"><span>━ 선택 경로</span><span>━ 실제 기록</span><span>● 현재 위치</span></div><small class="map-provenance">${escapeHTML(provenance)}${route?' · '+escapeHTML(route.name):''}</small>${route?.note?'<p class="map-provenance">'+escapeHTML(route.note)+'</p>':''}</div>`;
}

export function focusMapFacility(key,facility) {
  const view=mapViews.get(key);if(!view||!facility||!Number.isFinite(facility.lat)||!Number.isFinite(facility.lng))return false;
  const point=projectPoint(facility),centerX=(view.bounds.minX+view.bounds.maxX)/2,centerY=(view.bounds.minY+view.bounds.maxY)/2;
  view.bounds=panMapBounds(view.bounds,point.x-centerX,point.y-centerY);view.manual=true;view.focusedFacility=facility.id;redraw(key);return true;
}
export function changeMapView(action,key) {
  const view=mapViews.get(key);if(!view)return false;
  if(action==='map-zoom-in')view.bounds=zoomMapBounds(view.bounds,.65);
  if(action==='map-zoom-out')view.bounds=zoomMapBounds(view.bounds,1/.65);
  if(action==='map-fit'){view.bounds=view.fitBounds;view.manual=false;}
  else view.manual=true;
  if(action==='map-current') {
    if(!view.position)throw Error('위치 신호가 아직 없습니다. GPS 위치를 확인한 뒤 이용하세요.');
    const p=projectPoint(view.position),centerX=(view.bounds.minX+view.bounds.maxX)/2,centerY=(view.bounds.minY+view.bounds.maxY)/2;
    view.bounds=panMapBounds(view.bounds,p.x-centerX,p.y-centerY);
  }
  redraw(key);return true;
}
function redraw(key) {
  const element=document.querySelector(`[data-map-view="${key}"]`);
  if(element)element.innerHTML=drawSVG(mapViews.get(key));
}
export function startMapDrag(event) {
  const element=event.target.closest?.('[data-map-view]');if(!element||event.button>0)return;
  const view=mapViews.get(element.dataset.mapView);if(!view)return;
  drag={key:view.key,x:event.clientX,y:event.clientY,bounds:{...view.bounds},width:element.clientWidth,height:element.clientHeight,pointerId:event.pointerId};
  element.setPointerCapture?.(event.pointerId);event.preventDefault();
}
export function moveMapDrag(event) {
  if(!drag||drag.pointerId!==event.pointerId)return;
  const view=mapViews.get(drag.key);
  view.bounds=panMapBounds(drag.bounds,-(event.clientX-drag.x)/drag.width*(drag.bounds.maxX-drag.bounds.minX),(event.clientY-drag.y)/drag.height*(drag.bounds.maxY-drag.bounds.minY));
  view.manual=true;redraw(drag.key);
}
export function endMapDrag(){drag=null;}
export function keyMapView(event) {
  const element=event.target.closest?.('[data-map-view]');if(!element)return;
  const key=element.dataset.mapView,view=mapViews.get(key);
  if(['+','=','-','0'].includes(event.key)){event.preventDefault();changeMapView(event.key==='-'?'map-zoom-out':event.key==='0'?'map-fit':'map-zoom-in',key);return;}
  const direction={ArrowLeft:[-.2,0],ArrowRight:[.2,0],ArrowUp:[0,.2],ArrowDown:[0,-.2]}[event.key];
  if(direction){event.preventDefault();view.bounds=panMapBounds(view.bounds,direction[0]*(view.bounds.maxX-view.bounds.minX),direction[1]*(view.bounds.maxY-view.bounds.minY));view.manual=true;redraw(key);}
}
