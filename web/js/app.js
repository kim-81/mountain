import {reviewImageURL,serverDraftId} from './review-client.js';
import {prepareReviewPhotos} from './photo-files.js';
import {facilityPanel,facilityById} from './facilities.js';
import {courseSupport} from './course-support.js';
import {noticeState,loadNotices,noticesPanel} from './official-notices.js';
import {weatherState,loadWeather,weatherPanel} from './weather.js';
import {levelNames} from './data.js';
import {catalogMountains as mountains,sourceLabel,preparationItems} from './catalog.js';
import {backend,apiRequest,connectBackend} from './api.js';
import {serverOrigin} from './server-config.js';
import {sharedPlanIdFromLink} from './share-links.js';
import {appendFix,nextDeviation} from './navigation.js';
import {parseGPX,geoMap} from './route-map.js';
import {bundledRoute,mapDataSummary,changeMapView,focusMapFacility,startMapDrag,moveMapDrag,endMapDrag,keyMapView,mapInteractionActive} from './offline-map.js';
import {escapeHTML as e,distanceKm,recommend,encodePlan,decodePlan,formatTime,validFix} from './core.js';
import {state,persist,uid} from './store.js';
import {parseRecordBackup,mergeRecordBackup,makeRecordBackup,recordGPX} from './record-files.js';

// 1. 공통 상태와 작은 도우미. 산 데이터는 data.js, 계산은 core.js에서 수정합니다.
const $=s=>document.querySelector(s);
function routeFor(id){return state.routes[id]||bundledRoute(id);}
function routeKind(route){return route?.provenance==='openstreetmap'?'OSM 기본 경로':'사용자 GPX';}
function mapOptions(m,id){return {mountainId:m.id,center:{lat:m.lat,lng:m.lng},id};}
const icons={home:'⌂',map:'⌁',plans:'▦',my:'♧'};
const tabs=[['home','발견하기'],['map','등산 지도'],['plans','함께 가요'],['my','나의 산행']];
let current='home', selected=mountains[0], filter='all', query='', location=null, active=null, watch=null, timer=null, pending=null;
let detailId=null, detailTab='course', sharedPlanId=null;
let reviewPhotos=[], fixStatus='위치 권한을 허용하면 실제 GPS 기록을 시작합니다.';
let pendingBackup = null;
let pendingRoute = null;
let recoveryTimer = null;
let recoverySessionId = null;
const reviewPages=new Map();let photoGeneration=0;
let facilityOptions={kind:'all',origin:'start',radius:1};
const nativeAndroid=()=>globalThis.AndroidTrail;
const nativeIOS=()=>globalThis.webkit?.messageHandlers?.trail;
function nativeCall(action,payload={}) { const message=JSON.stringify({action,...payload});if(nativeAndroid()){nativeAndroid().postMessage(message);return true;}if(nativeIOS()){nativeIOS().postMessage(message);return true;}return false;}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>$('#toast').classList.remove('visible'),4200);}
globalThis.onTrailExport = () => toast('기록 파일을 저장했어요.');
function save(){if(!persist()) {toast('저장 공간이 부족합니다. 사진이나 이전 기록을 정리해 주세요.');return false;}return true;}
function showDialog(html){pendingRoute=null;$('#dialog-body').innerHTML=`<button class="close" data-action="close" aria-label="닫기">×</button>${html}`;if(!$('#dialog').open)$('#dialog').showModal();}
function closeDialog(){pendingRoute=null;$('#dialog').close();}
function isDetailVisible(id, tab) {
  return detailId === id && detailTab === tab && $('#dialog').open
    && Boolean($('#dialog-body .detail-tabs'));
}
function downloadJSON(value, filename) {
  downloadFile(JSON.stringify(value, null, 2), filename, 'application/json');
}
function downloadFile(content, filename, mime) {
  if (new TextEncoder().encode(content).byteLength > 16 * 1024 * 1024) throw Error('파일이 16MB를 초과합니다. 기록별 GPX로 나누어 저장해 주세요.');
  if (nativeCall('export', { content, filename })) return;
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function accountDialog() {
  if (!state.user) { login(); return; }
  const server = backend.available && backend.user?.id === state.user.id;
  showDialog(`<span class="eyebrow">YOUR ACCOUNT</span><h2>${e(state.user.name)}님</h2><p>${server ? '서버 계정입니다. GPS 기록과 GPX는 이 기기에 보관합니다.' : '이 기기에서 사용하는 예시 계정입니다.'}</p><div class="account-actions"><button class="outline wide" data-action="export">기기 산행 기록 내보내기</button>${server ? '<button class="outline wide" data-action="export-account">서버의 내 자료 내보내기</button><button class="outline wide" data-action="password-dialog">비밀번호 변경</button><button class="subtle wide" data-action="delete-account-dialog">서버 계정 탈퇴</button>' : ''}<button class="outline wide" data-action="logout">로그아웃</button><button class="subtle wide" data-action="import-plan">공유 일정 코드 가져오기</button></div>`);
}
function login(then) {
    if (state.user && (!backend.available || backend.user?.id === state.user.id)) { then?.(); return; }
    if (backend.available && (active || state.activeSession)) { toast('진행 중인 산행을 저장한 뒤 서버 로그인을 확인해 주세요.'); return; }
    pending = then;
    const server = backend.available;
    showDialog(`<span class="eyebrow">WELCOME TO SANGIL TTARA</span><h2>나만의 산행을 모아보세요.</h2>
      <p>${server ? '연결된 서버에 계정을 만들고 일정을 함께 관리할 수 있어요. 테스트용 별명과 비밀번호를 사용하세요.' : '현재는 기기 저장 모드입니다. 예시 별명으로 기록을 체험하세요.'}</p>
      <form id="login-form">${server ? '<label>이용 방식<select name="mode"><option value="login">로그인</option><option value="register">테스트 계정 만들기</option></select></label>' : ''}
      <label>별명<input name="nickname" maxlength="20" autocomplete="username" required placeholder="예: 산길여행자"></label>
      ${server ? '<label>테스트 비밀번호<input name="password" type="password" minlength="8" maxlength="128" autocomplete="off" required placeholder="8자 이상 · 실제 사용 중인 비밀번호 입력 금지"></label>' : ''}
      <button class="primary wide">${server ? '계속하기' : '예시 계정으로 시작'}</button><p id="form-error" class="form-error" role="alert"></p></form>`);
  }
// 2. 화면을 그리는 함수. 문자열 안의 HTML이 실제 화면 구성입니다.
function nav(){for(const id of ['side-nav','bottom-nav'])$('#'+id).innerHTML=tabs.map(([key,label])=>`<a href="#${key}" class="nav-link ${current===key?'active':''}" ${current===key?'aria-current="page"':''}><span aria-hidden="true">${icons[key]}</span>${label}</a>`).join('');}
function pageTitle(kicker,title,description,action=''){return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;}
function stats(m) {
    return `<div class="route-stats"><span>◷ ${formatTime(m.minutes)}</span><span>↔ ${m.km} km</span>${m.ascent == null ? '<span>↗ 상승량 미확인</span>' : `<span>↗ ${m.ascent} m${m.metadataStatus === 'sample' ? ' (예시)' : ''}</span>`}</div>`;
  }
function card(m,index=0){const favorite=state.favorites.includes(m.id);return `<article class="mountain-card"><div class="card-scene ${m.tint}"><img src="assets/landscape.svg" alt="산 능선 일러스트 · 실제 ${m.name} 사진 아님" loading="lazy"><span class="difficulty level-${m.level}">${levelNames[m.level]}</span><button class="favorite ${favorite?'checked':''}" data-action="favorite" data-id="${m.id}" aria-label="${m.name} 즐겨찾기" aria-pressed="${favorite}">${favorite?'♥':'♡'}</button><span class="scene-caption">${String(index+1).padStart(2,'0')} / SANGIL TTARA</span></div><div class="card-body"><span class="data-badge ${m.sourceUrl?'verified':'sample'}">${m.sourceUrl?'공식 안내 수치 확인':'예시 코스'}</span><span class="district">${m.district}${location?` · 약 ${distanceKm(location,m).toFixed(1)}km 거리`:''}</span><h3><button class="text-button" data-action="detail" data-id="${m.id}">${m.name}<span>↗</span></button></h3><p>${m.title}</p>${stats(m)}<div class="card-bottom"><span>${m.mood}</span><button data-action="detail" data-id="${m.id}" class="small-link">코스 보기 →</button></div></div></article>`;}
function filtered(){let list=mountains.filter(m=>(m.name+m.district+m.mood).includes(query));if(filter==='easy')list=list.filter(m=>m.level===1);if(filter==='short')list=list.filter(m=>m.minutes<=120);if(filter==='saved')list=list.filter(m=>state.saved.includes(m.id));if(filter==='personal')return recommend(list,state.profile,state.favorites,state.records);if(location)list.sort((a,b)=>distanceKm(location,a)-distanceKm(location,b));return list;}
function renderCards() {
    const list = filtered();
    $('#results-count').textContent = `${list.length}개의 산 · 공식 안내 확인 ${list.filter(m => m.sourceUrl).length}개`;
    $('#mountain-grid').innerHTML = list.length ? list.map(card).join('') : `<div class="empty"><h3>조건에 맞는 산이 없어요.</h3><p>검색어나 필터를 바꿔 보세요.</p></div>`;
  }
function home(){return `<section class="hero"><div class="hero-art"></div><div class="hero-content"><span class="eyebrow light">A LITTLE CLOSER TO NATURE</span><h1>이번 주말,<br>어떤 산을 걸을까요?</h1><p>멀리 가지 않아도 괜찮아요.<br>서울의 산에서 나에게 맞는 길을 발견하세요.</p><button class="cream-button" data-action="recommend">나에게 맞는 코스 찾기 <span>↗</span></button><div class="hero-foot"><span>SEOUL, KOREA</span><span>서울 8개 산 · GPX 경로 관리</span></div></div></section><div class="section-heading"><div><span class="eyebrow">EXPLORE YOUR NEXT TRAIL</span><h2>가까운 산부터, 가볍게</h2></div><button class="subtle" data-action="locate">◎ 내 주변 산 찾기</button></div><div class="search-row"><label class="search-box"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="산 이름이나 지역을 검색하세요" value="${e(query)}" aria-label="산 이름 또는 지역 검색"></label><button class="outline" data-action="recommend">☷ 맞춤 조건</button></div><div class="filter-row">${[['all','전체 코스'],['easy','초보자 추천'],['short','2시간 이내'],['personal','나의 맞춤 추천'],['saved','저장한 코스']].map(([id,label])=>`<button class="chip ${filter===id?'selected':''}" data-action="filter" data-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><div class="results-meta"><span id="results-count"></span><span>${location?'근사 대표 위치 기준 직선거리순':'서울 전체 · 위치 없이도 이용 가능'}</span></div><div id="mountain-grid" class="mountain-grid"></div><div class="info-banner"><span class="info-symbol">i</span><div><b>편안한 산행은, 꼼꼼한 준비에서</b><p>코스를 미리 저장하고 출발 전 날씨와 탐방 통제를 확인하세요. 공식 안내 확인 여부와 경로 준비 상태를 코스별로 확인하세요.</p></div></div>`;}
function detail(m) {
    if(detailId!==m.id)facilityOptions={kind:'all',origin:'start',radius:1};
    detailId = m.id;
    const support=courseSupport[m.id];
    const reviews = state.reviews.filter(r => r.mountainId === m.id);
    const reviewPage=reviewPages.get(m.id);
    const route = routeFor(m.id);
    const checklist = state.checklists[m.id] || [];
    const content = {
      course: ()=>`<span class="notice ${m.sourceUrl ? 'source-checked' : ''}">${sourceLabel(m)}</span>${stats(m)}
        <p class="course-name">${e(m.course)}</p><p class="muted">공식 둘레길 안내 수치는 정상 등정 코스와 다릅니다. 예시 코스는 별도로 표시합니다.</p>
        ${geoMap(route,[],null,mapOptions(m,'detail'))}<dl class="course-facts"><dt>출발 → 도착</dt><dd>${e(m.start)} → ${e(m.end)}</dd><dt>경로 준비</dt><dd>${route ? `${route.count}개 좌표 · ${route.km.toFixed(2)}km · ${routeKind(route)}` : '기본 경로 없음 · GPX로 추가 가능'}</dd><dt>난이도</dt><dd>${levelNames[m.level]}${m.levelBasis ? ' · '+e(m.levelBasis) : (m.sourceUrl ? ' · 공식 안내 기준' : ' · 예시')}</dd><dt>경사·코스 최고 고도</dt><dd>검증 데이터 미확보</dd></dl>
        ${route?.provenance==='openstreetmap'?`<div class="route-source"><b>OSM 기여자 경로 · 현장 미검증</b>공식 안내 거리 ${m.km}km / OSM 계산 거리 ${route.km.toFixed(2)}km · 두 자료는 출처와 측정 방식이 다릅니다.<br><a href="${e(route.sourceUrl)}" target="_blank" rel="noopener">원본 경로 확인 ↗</a> · OSM 기준 ${e(route.sourceBaseAt?.slice(0,10)||'미확인')}</div>`:''}
        ${m.waypoints.length ? `<h3>주요 경유지</h3><ol class="waypoints">${m.waypoints.map(p => `<li>${e(p)}</li>`).join('')}</ol>` : ''}
        ${m.sourceUrl ? `<a class="source-link" href="${m.sourceUrl}" target="_blank" rel="noopener">공식 코스 안내 확인 ↗</a>` : ''}
        <div class="detail-actions"><button class="primary" data-action="select" data-id="${m.id}">이 코스로 산행 준비 →</button><button class="outline" data-action="import-route" data-id="${m.id}">GPX 경로 가져오기</button><button class="outline" data-action="save-course" data-id="${m.id}">${state.saved.includes(m.id) ? '✓ 저장됨' : '↓ 코스 저장'}</button></div>`,
      prepare: ()=>`<div class="readiness"><b>출발 준비 ${checklist.length}/${preparationItems.length}</b><progress max="${preparationItems.length}" value="${checklist.length}"></progress></div>
        <div class="checklist">${preparationItems.map(([key, label]) => `<label class="checkbox"><input type="checkbox" data-checklist="${key}" data-mountain="${m.id}" ${checklist.includes(key) ? 'checked' : ''}>${label}</label>`).join('')}</div>
        <div class="detail-grid"><section><h3>교통·귀가</h3><p>${e(support?.transport||m.station)}${m.sourceUrl ? '' : ' (예시)'}</p></section><section><h3>시설·준비 안내</h3>${support?.notes?.length?'<ul class="support-notes">'+support.notes.map(note=>'<li>'+e(note)+'</li>').join('')+'</ul>':'<p>현재 운영 상태는 현장에서 확인하세요.</p>'}<button class="small-link" data-action="detail-tab" data-tab="facilities">주변 시설·식당 보기 →</button>${support?'<p class="muted">공식 안내 확인 '+e(support.checkedAt)+' · <a href="'+e(support.source)+'" target="_blank" rel="noopener">출처 확인 ↗</a></p>':''}</section></div>
        ${weatherPanel(m)}${noticesPanel(m)}`,
      facilities: ()=>facilityPanel(m,facilityOptions,route,items=>geoMap(route,[],null,{...mapOptions(m,'facilities'),facilities:items})),
      reviews: ()=>`<div class="section-heading compact"><h3>이 코스의 이야기 ${reviewPage?.total==null?reviews.length:reviewPage.total+reviews.filter(r=>r.storage!=='server').length}</h3><button class="small-link" data-action="review" data-id="${m.id}">후기 쓰기 +</button></div>
        ${reviews.length ? reviews.map(r => `<article class="review"><b>${e(r.author)}</b><span>★ ${r.rating} · ${e(r.date)} · ${r.storage === 'server' ? '서버 저장' : '이 기기'}</span><p>${e(r.text)}</p><div class="review-photos">${(r.photos||[]).map(photo=>reviewImageURL(photo)).filter(Boolean).map(photo=>`<img src="${e(photo)}" alt="산행 후기 사진 · 온라인에서 확인" loading="lazy" referrerpolicy="no-referrer">`).join('')}</div>${state.user?.id === r.userId ? `<button class="small-link" data-action="edit-review" data-id="${r.id}">수정</button> <button class="small-link" data-action="delete-review" data-id="${r.id}">삭제</button>` : ''}</article>`).join('') : '<p class="muted">첫 번째 산행 이야기를 남겨 주세요.</p>'}${reviewPage?.error?'<p class="form-error">'+e(reviewPage.error)+'</p>':''}<div class="button-row">${backend.available?'<button class="outline" data-action="reviews-refresh" data-id="'+m.id+'" '+(reviewPage?.status==='loading'?'disabled':'')+'>후기 새로고침</button>':''}${reviewPage?.nextCursor?'<button class="primary" data-action="reviews-more" data-id="'+m.id+'" '+(reviewPage.status==='loading'?'disabled':'')+'>이전 후기 더 보기</button>':''}</div>${reviewPage?.status==='loading'?'<p role="status">후기를 불러오고 있어요.</p>':''}`
    };
    showDialog(`<span class="eyebrow">SANGIL TTARA / ${e(m.district)}</span><h2>${e(m.name)}</h2><p>${e(m.title)}</p>
      <div class="detail-tabs" role="tablist" aria-label="코스 상세">${[['course', '코스 정보'], ['prepare', '산행 준비'], ['facilities','주변 시설'], ['reviews', '후기·사진']].map(([key, label]) => `<button role="tab" aria-selected="${detailTab === key}" class="${detailTab === key ? 'selected' : ''}" data-action="detail-tab" data-tab="${key}">${label}</button>`).join('')}</div><section role="tabpanel">${content[detailTab]()}</section>`);
    if(detailTab==='reviews'&&backend.available&&navigator.onLine&&!reviewPages.has(m.id))refreshMountainReviews(m.id);
    if(detailTab==='prepare'&&noticeState(m.id).status==='idle'&&navigator.onLine) refreshNotices(m);
    if(detailTab==='prepare'&&weatherState(m.id).status==='idle'&&navigator.onLine) refreshWeather(m);
  }
function refreshNotices(m) {
  const work=loadNotices(m);
  if(isDetailVisible(m.id,'prepare'))detail(m);
  work.finally(()=>{if(isDetailVisible(m.id,'prepare'))detail(m);});
}
function refreshWeather(m) {
  const work=loadWeather(m);
  if(isDetailVisible(m.id,'prepare'))detail(m);
  work.finally(()=>{if(isDetailVisible(m.id,'prepare'))detail(m);});
}
function reviewPhotoPreview() {
  return reviewPhotos.map((photo,index)=>{const url=reviewImageURL(photo);return url?`<div class="photo-preview-item"><img src="${e(url)}" alt="첨부 사진 ${index+1}" referrerpolicy="no-referrer"><button type="button" class="small-link" data-action="remove-photo" data-index="${index}">사진 ${index+1} 삭제</button></div>`:'';}).join('');
}
function updateReviewPhotos() {
  $('#photo-preview').innerHTML=reviewPhotoPreview();
  $('#photo-status').textContent=`${reviewPhotos.length}장 선택 · ${backend.available?'서버 저장 예정':'이 기기에 저장 예정'}`;
}
async function refreshMountainReviews(id,more=false) {
  const previous=reviewPages.get(id);
  if(!backend.available||previous?.status==='loading'||(more&&!previous?.nextCursor))return;
  const page={...previous,status:'loading',error:null};reviewPages.set(id,page);
  if(isDetailVisible(id,'reviews'))detail(mountains.find(m=>m.id===id));
  try {
    const result=await apiRequest(`reviews/page/${id}/${more?previous.nextCursor:0}`);
    if(reviewPages.get(id)!==page)return;
    const keep=state.reviews.filter(review=>review.storage!=='server'||review.mountainId!==id||more);
    state.reviews=[...new Map([...keep,...result.reviews].map(review=>[review.id,review])).values()];
    Object.assign(page,{status:'ready',total:result.total,nextCursor:result.nextCursor});save();
  } catch(error) {if(reviewPages.get(id)===page)Object.assign(page,{status:'error',error:error.message});}
  finally {if(reviewPages.get(id)===page&&isDetailVisible(id,'reviews'))detail(mountains.find(m=>m.id===id));}
}
function mapPage() {
    const m = selected, route = routeFor(m.id);
    return `${pageTitle('ON THE TRAIL', '한 걸음씩, 나의 속도로', '경로와 준비 사항을 확인한 뒤 산행을 시작하세요.')}
      ${state.activeSession && !active ? '<div class="recovery-banner"><b>종료되지 않은 산행 기록이 있어요.</b><button class="primary" data-action="resume-session">기록 이어가기</button><button class="outline" data-action="recover-finish">종료해 저장하기</button></div>' : ''}
      <div class="map-layout"><section class="panel map-panel"><div class="map-toolbar"><label>선택한 코스<select id="map-course">${mountains.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${x.name} · ${x.course}</option>`).join('')}</select></label><span class="tag">${route ? routeKind(route) : '기본 경로 없음'}</span></div>
      <div id="live-map">${geoMap(route,active?.points||[],location,mapOptions(m,'live'))}</div><div class="map-note"><b>${route ? '배경지도 위에서 선택 경로와 현재 위치를 확인하세요.' : '이 산은 배경지도만 제공됩니다. GPX를 가져와 경로를 추가하세요.'}</b><p>도로·산길·숲 배경지도는 앱에 포함됩니다. 등고선과 실시간 통제 정보는 포함되지 않으며, 기본 경로는 현장 미검증 자료입니다.</p></div><div class="button-row map-tools"><button class="outline" data-action="import-route" data-id="${m.id}">GPX 가져오기</button>${state.routes[m.id]&&bundledRoute(m.id)?`<button class="subtle" data-action="use-bundled-route" data-id="${m.id}">OSM 기본 경로 사용</button>`:''}<button class="subtle" data-action="detail" data-id="${m.id}">코스·산행 준비 확인 ↗</button></div></section>
      <aside class="panel recording"><span class="eyebrow">TODAY’S WALK</span><h2>${m.name}</h2><p>${e(m.course)}</p>${stats(m)}<div class="live-stats"><div><b id="live-time">00:00:00</b><span>기록 시간</span></div><div><b id="live-distance">0.00</b><span>이동 거리 km</span></div></div><p id="gps-status" class="gps-status">${e(fixStatus)}</p><p id="gps-coordinate" class="muted"></p><p id="deviation-status" class="deviation-status"></p>
      <label class="checkbox"><input id="deviation-enabled" type="checkbox" ${active?.alertsEnabled ? 'checked' : ''} ${!route || active ? 'disabled' : ''}>선택 경로 기준 이탈 감지</label><small>70m 이상 벗어난 정확한 위치 신호가 연속 3회 수신되면 알립니다. 현장 검증 전 기능입니다.</small>
      <button class="primary wide" data-action="${active ? 'finish' : 'start'}">${active ? '■ 산행 종료' : '▶ GPS 산행 시작'}</button><button class="outline wide" data-action="save-course" data-id="${m.id}">${state.saved.includes(m.id) ? '✓ 코스 저장됨' : '↓ 코스 오프라인 저장'}</button><button class="subtle wide" data-action="plan" data-id="${m.id}">이 코스로 일정 만들기 +</button><small>브라우저 백그라운드 알림은 제한될 수 있습니다. 네이티브의 화면 꺼짐 기록·알림은 실기기 검증이 필요합니다.</small></aside></div>`;
  }
function planCard(p) {
    const m = mountains.find(x => x.id === p.mountainId);
    const server = p.storage === 'server';
    return `<article class="panel plan-card"><span class="tag">${e(p.date)} · ${e(p.time)}</span><h3>${e(p.title)}</h3><p>${m?.name || ''} · ${e(p.place)}</p><small>${server ? '서버에서 응답 동기화' : '기기에만 저장된 일정'}</small>
      <div class="participants">${p.responses?.length ? p.responses.map(r => `<span>${e(r.name)} · ${r.status === 'yes' ? '참가' : '불참'}</span>`).join('') : '아직 참가 응답이 없어요.'}</div><div class="button-row"><button class="primary" data-action="respond" data-id="${e(p.id)}" data-status="yes">참가</button><button class="outline" data-action="respond" data-id="${e(p.id)}" data-status="no">불참</button><button class="subtle" data-action="share" data-id="${e(p.id)}">링크 공유 ↗</button>${!server || p.ownerId === state.user?.id ? `<button class="subtle" data-action="delete-plan" data-id="${e(p.id)}">삭제</button>` : ''}</div></article>`;
  }
function plansPage() {
    return `${pageTitle('BETTER TOGETHER', '함께 걸으면, 더 좋은 길', '코스를 고른 뒤 날짜와 장소를 정해 공유하세요.', `<button class="primary" data-action="plan" data-id="${selected.id}">+ 새 일정</button>`)}<div class="info-banner"><span>↗</span><div><b>${backend.available ? '같은 서버에 접속한 사용자끼리 응답을 공유합니다.' : '현재 기기에 저장하는 모드입니다.'}</b><p>${backend.available ? '서버 일정은 10초마다 새로 확인합니다. 연결 오류가 나면 새로고침으로 저장 결과를 확인해 주세요.' : '기기별 참가 응답은 합쳐지지 않습니다. 로컬 미리보기 서버를 실행하면 서버 계정을 사용할 수 있습니다.'}</p></div><button class="small-link" data-action="refresh-server">새로고침</button></div><div class="plan-list">${state.plans.length ? state.plans.map(planCard).join('') : '<div class="empty panel"><h2>함께할 다음 산행을 계획해요.</h2><p>마음에 드는 코스를 고르고 일정을 만들어 보세요.</p><a class="primary" href="#home">코스 둘러보기 →</a></div>'}</div>`;
  }
function myPage(){const records=state.records;return `${pageTitle('YOUR TRAIL JOURNAL','걸어온 길이, 나의 이야기','좋아하는 산과 소중한 걸음을 한곳에 모아요.',`<button class="outline" data-action="account">${state.user?'계정 관리':'로그인 / 체험'}</button>`)}<div class="summary-grid"><div class="panel"><span>나의 산행</span><b>${records.length}<small>회</small></b></div><div class="panel"><span>완주한 코스</span><b>${records.filter(r=>r.complete).length}<small>회</small></b></div><div class="panel"><span>총 이동 거리</span><b>${records.reduce((n,r)=>n+r.km,0).toFixed(1)}<small>km</small></b></div><div class="panel"><span>오프라인 저장</span><b>${state.saved.length}<small>개</small></b></div></div><div class="section-heading"><h2>나의 산행 기록</h2><div class="record-tools"><button class="small-link" data-action="import-records">기록 가져오기 ↑</button><button class="small-link" data-action="export">기록 내보내기 ↓</button></div></div>${records.length?records.map(r=>`<article class="panel record"><div><span class="eyebrow">${e(r.date)} · ${r.complete?'완주 확인':'산행 기록'}</span><h3>${mountains.find(m=>m.id===r.mountainId)?.name||'산행'}</h3><p>${r.km.toFixed(2)} km · ${formatTime(r.minutes)} · GPS ${r.points.length}개 지점</p><details><summary>기록 경로 좌표 보기</summary><p>${r.points.length?r.points.map(p=>`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`).join(' → '):'수신된 위치가 없습니다.'}</p></details></div><div><button class="small-link" data-action="export-gpx" data-id="${e(r.id)}">GPX 저장</button> <button class="small-link" data-action="review" data-id="${r.mountainId}">후기 작성</button> <button class="small-link" data-action="delete-record" data-id="${r.id}">삭제</button></div></article>`).join(''):'<div class="empty panel"><h3>아직 기록된 걸음이 없어요.</h3><p>등산 지도에서 GPS 산행을 시작해 보세요.</p><a class="small-link" href="#map">산행 준비하기 →</a></div>'}<div class="section-heading"><h2>즐겨찾는 산</h2><span class="muted">${state.favorites.length}개</span></div><div class="mountain-grid">${mountains.filter(m=>state.favorites.includes(m.id)).map(card).join('')||'<p class="muted">마음에 드는 산의 하트를 눌러 보세요.</p>'}</div><div class="section-heading"><h2>저장한 코스·GPX</h2></div><div class="saved-list">${state.saved.map(id=>{const m=mountains.find(x=>x.id===id);return m?`<div class="panel saved-row"><span>${m.name} · ${routeFor(id)?'배경지도·경로 저장':'배경지도·코스 정보 저장'}</span><button class="small-link" data-action="remove-save" data-id="${id}">저장 해제</button></div>`:'';}).join('')||'<p class="muted">코스 상세에서 오프라인 저장을 선택하세요.</p>'}</div>`;}
function render(){nav();$('#main').innerHTML=({home,map:mapPage,plans:plansPage,my:myPage}[current]||home)();if(current==='home')renderCards();if(current==='map')updateRecording();}
function route() {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('shared/')) {
      current = 'plans';
      sharedPlanId = hash.slice(7);
      if (/^[a-f0-9]{32}$/.test(sharedPlanId) && backend.available) refreshServer().catch(error => toast(error.message));
    } else if (hash.startsWith('plan/')) {
      try { const p = decodePlan(hash.slice(5), mountains); if (!state.plans.some(x => x.id === p.id)) { state.plans.push(p); save(); } current = 'plans'; }
      catch (error) { toast(error.message); current = 'plans'; }
    } else current = tabs.some(t => t[0] === hash) ? hash : 'home';
    render(); window.scrollTo(0, 0);
  }
function recommendDialog(){const p=state.profile;showDialog(`<span class="eyebrow">FIND YOUR PACE</span><h2>어떤 산행을 원하세요?</h2><p>현재의 체력에 맞춰 무리 없는 길부터 찾아보세요.</p><form id="recommend-form"><div class="form-grid"><label>등산 경험<select name="experience">${[[1,'처음이거나 익숙하지 않아요'],[2,'가끔 등산해요'],[3,'자주 등산해요']].map(([v,t])=>`<option value="${v}" ${p.experience==v?'selected':''}>${t}</option>`).join('')}</select></label><label>체력 수준<select name="fitness">${[[1,'가벼운 걷기가 편해요'],[2,'꾸준히 운동해요'],[3,'긴 산행도 자신 있어요']].map(([v,t])=>`<option value="${v}" ${p.fitness==v?'selected':''}>${t}</option>`).join('')}</select></label><label>원하는 산행 시간<select name="minutes">${[90,120,180,240,300].map(v=>`<option value="${v}" ${p.minutes==v?'selected':''}>${formatTime(v)} 이내</option>`).join('')}</select></label><label>이동 수단<select name="transport"><option value="transit" ${p.transport==='transit'?'selected':''}>대중교통</option><option value="car" ${p.transport==='car'?'selected':''}>자가용</option></select></label></div><p class="muted">즐겨찾기와 완주 이력도 추천 순서에 반영합니다. 공식 안내 수치를 비교한 추천이며, 현장 상태와 실시간 통제를 보장하지 않습니다.</p><button class="primary wide">맞춤 코스 보기 →</button></form>`);}
function planDialog(id){login(()=>{const m=mountains.find(x=>x.id===id)||selected;showDialog(`<span class="eyebrow">LET’S WALK TOGETHER</span><h2>다음 산행을 약속해요.</h2><form id="plan-form" data-draft-id="${backend.available?serverDraftId():''}"><label>선택한 코스<select name="mountainId">${mountains.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${x.name} · ${x.course}</option>`).join('')}</select></label><label>일정 이름<input name="title" maxlength="80" value="${m.name} 함께 걸어요" required></label><div class="form-grid"><label>날짜<input type="date" name="date" required></label><label>시간<input type="time" name="time" value="09:00" required></label></div><label>만나는 장소<input name="place" maxlength="120" placeholder="예: 역 1번 출구 앞 (개인 주소 입력 금지)" required></label><button class="primary wide">일정 만들기</button></form>`);});}
function reviewDialog(id,existing){login(()=>{photoGeneration++;reviewPhotos=existing?.photos?[...existing.photos]:[];showDialog(`<span class="eyebrow">TRAIL STORIES</span><h2>${mountains.find(m=>m.id===id)?.name} 산행 이야기</h2><form id="review-form" data-mountain="${id}" data-edit="${existing?.id||''}" data-draft-id="${backend.available?serverDraftId():''}" data-revision="${e(existing?.revision||'')}"><label>별점<select name="rating">${[5,4,3,2,1].map(n=>`<option value="${n}" ${existing?.rating==n?'selected':''}>${'★'.repeat(n)}</option>`).join('')}</select></label><label>후기<textarea name="text" rows="4" maxlength="1000" required placeholder="다음 등산객에게 도움이 될 이야기를 남겨 주세요.">${e(existing?.text||'')}</textarea></label><div id="photo-preview">${reviewPhotoPreview()}</div><label>사진 추가 (최대 3장)<input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="muted" id="photo-status">${reviewPhotos.length}장 선택 · ${backend.available?"후기와 함께 연결된 서버에 저장합니다.":"이 기기에만 보관합니다."}</p><button type="button" class="small-link" data-action="clear-photos">첨부 사진 비우기</button><button class="primary wide">후기 저장</button></form>`);});}
// 3. 실제 GPS 수신. 네이티브 앱에서는 운영체제 위치 서비스, 브라우저에서는 geolocation 사용.
function locate(){fixStatus='현재 위치를 확인하고 있어요.';toast(fixStatus);if(nativeCall('locate'))return;if(!navigator.geolocation){toast('이 환경에서는 위치 정보를 사용할 수 없어요.');return;}navigator.geolocation.getCurrentPosition(p=>onFix({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,time:p.timestamp}),()=>toast('위치를 확인하지 못했어요. 권한을 확인하거나 지역 검색을 이용하세요.'),{enableHighAccuracy:true,timeout:15000});}
function onFix(fix, deferUpdate = false) {
    if (!validFix(fix)) { fixStatus = '위치 정확도가 낮아 다음 GPS 신호를 기다립니다.'; if (!deferUpdate) updateRecording(); return false; }
    if (!Number.isFinite(fix.time) || fix.time < Date.now() - 86400000 || fix.time > Date.now() + 10000) return false;
    if (!location || fix.time >= (location.time || 0)) location = { lat: fix.lat, lng: fix.lng, time: fix.time };
    fixStatus = `GPS 수신 중 · 정확도 약 ${Math.round(fix.accuracy)}m`;
    let changed = false;
    if (active) {
      changed = appendFix(active, fix);
      active.deviation = nextDeviation(active.deviation, fix, active.routeSegments, active.alertsEnabled);
      if (active.deviation.alert) {
        toast('선택 경로에서 벗어났을 수 있어요. 현재 위치와 주변을 확인해 주세요.');
        // 네이티브는 서비스에서 별도 판정합니다. 브라우저에서만 화면 알림/기기 알림을 보냅니다.
        if (!nativeAndroid() && !nativeIOS() && globalThis.Notification?.permission === 'granted') new Notification('산길따라 · 경로 확인', { body: '가져온 경로에서 벗어났을 수 있어요. 주변과 위치를 확인해 주세요.' });
      }
      state.activeSession = active;
      if (!deferUpdate && changed && !persist()) fixStatus = '저장 공간이 부족합니다. 기록을 종료하고 내보내 주세요.';
    }
    if (!deferUpdate) {
      updateRecording();
      if (current === 'home') renderCards();
    }
    return changed;
  }
globalThis.onTrailLocation=onFix;
globalThis.onTrailLocations = fixes => {
  if (!Array.isArray(fixes) || !fixes.length) return;
  let changed = false;
  for (const fix of fixes) if (onFix(fix, true)) changed = true;
  if (changed && !persist()) fixStatus = '저장 공간이 부족합니다. 기록을 종료하고 내보내 주세요.';
  updateRecording();
  if (current === 'home') renderCards();
};
globalThis.onTrailRecovery = (fixes, sessionId) => {
  if (sessionId !== recoverySessionId || active?.id !== sessionId) return;
  clearTimeout(recoveryTimer);
  recoverySessionId = null;
  if (!Array.isArray(fixes)) { toast('기기에 남은 GPS 기록을 읽지 못했습니다.'); return; }
  globalThis.onTrailLocations(fixes);
  finish();
};
globalThis.onTrailError=message=>{fixStatus=String(message);toast(fixStatus);updateRecording();};
function updateRecording() {
    if (current !== 'map') return;
    const elapsed = active ? Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000)) : 0;
    $('#live-time').textContent = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60].map(n => String(n).padStart(2, '0')).join(':');
    $('#live-distance').textContent = (active?.km || 0).toFixed(2);
    $('#gps-status').textContent = fixStatus;
    $('#gps-coordinate').textContent = location ? `현재 좌표 ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : '';
    if(!mapInteractionActive()) $('#live-map').innerHTML=geoMap(routeFor(selected.id),active?.points||[],location,mapOptions(selected,'live'));
    $('#deviation-status').textContent = active?.alertsEnabled ? (active.deviation?.distance == null ? '이탈 감지: GPS 신호 대기' : `선택 경로까지 약 ${active.deviation.distance}m${active.deviation.outside ? ' · 경로 확인 필요' : ''}`) : '이탈 감지: 사용 안 함';
  }
function start() {
    const alertsEnabled = $('#deviation-enabled')?.checked || false;
    login(async () => {
      if (active || state.activeSession) { toast('이전 산행을 먼저 이어가거나 종료해 주세요.'); return; }
      active = { id: uid(), userId: state.user.id, mountainId: selected.id, courseId: selected.courseId, startedAt: Date.now(), points: [], km: 0, alertsEnabled, routeSegments: routeFor(selected.id)?.segments || [], deviation: null };
      state.activeSession = active;
      if (!save()) { active = null; state.activeSession = null; return; }
      if (alertsEnabled && !nativeAndroid() && !nativeIOS() && 'Notification' in globalThis && Notification.permission === 'default') await Notification.requestPermission();
      beginGPS(false);
    });
  }
function finish(){if(!active)return;showDialog(`<span class="eyebrow">WELL WALKED</span><h2>오늘도 수고했어요.</h2><p>${active.km.toFixed(2)}km · GPS ${active.points.length}개 지점이 기록되었습니다.</p><form id="finish-form"><label class="checkbox"><input type="checkbox" name="complete"> 선택한 코스를 완주했어요.</label><p class="muted">완주 여부는 직접 확인합니다. GPS만으로 판정하지 않습니다.</p><button class="primary wide">산행 종료하고 저장</button></form>`);}
async function saveCourse(id) {
    if (!state.saved.includes(id)) { state.saved.push(id); if (!save()) { state.saved = state.saved.filter(x => x !== id); return; } }
    let cached = Boolean(nativeAndroid() || nativeIOS());
    try {
      if ('caches' in globalThis && !cached) {
        const names = await caches.keys();
        for (const name of names.filter(n => n.startsWith('seoul-trail-'))) {
          const cache=await caches.open(name);
          const checks=await Promise.all(['index.html','js/map-database.js','js/offline-map.js','js/map-geometry.js'].map(file=>cache.match(new URL(file,globalThis.location.href))));
          if(checks.every(Boolean))cached=true;
        }
      }
    } catch { cached = false; }
    toast(`${routeFor(id) ? '코스와 경로 선택을 저장했어요.' : '코스 정보를 저장했어요. 이 산의 기본 경로는 없습니다.'} ${cached ? '서울 배경지도 오프라인 준비됨.' : '배경지도 캐시가 아직 준비되지 않았어요. 온라인에서 다시 확인해 주세요.'}`);
    if ($('#dialog').open) detail(mountains.find(m => m.id === id)); else render();
  }
async function sharePlan(id) {
    const p = state.plans.find(x => x.id === id);
    if (!p) return;
    const base = new URL(serverOrigin || locationHref());
    base.hash = p.storage === 'server' ? 'shared/' + id : 'plan/' + encodePlan(p);
    const url = base.href;
    const local = !/^https?:/.test(url) || ['127.0.0.1', 'localhost', 'appassets.androidplatform.net'].includes(base.hostname);
    showDialog(`<h2>일정 공유</h2><p>${local ? '현재 주소는 같은 PC에서만 열립니다. 다른 기기와 공유하려면 공개 HTTPS 서버가 필요합니다.' : '링크를 받은 사람이 일정을 확인할 수 있습니다.'}</p><label>공유 링크<textarea rows="3" readonly>${e(url)}</textarea></label>${p.storage !== 'server' ? `<label>다른 기기에서 가져올 코드<textarea rows="3" readonly>${e(encodePlan(p))}</textarea></label>` : ''}<button class="primary wide" data-action="copy-share" data-id="${e(id)}">링크 복사</button>`);
  }
function locationHref(){return globalThis.location.href;}
// 4. 버튼의 data-action 값으로 동작을 연결합니다. HTML에 새 버튼을 넣으면 이곳에 동작 추가.

document.addEventListener('input',event=>{if(event.target.id==='search'){query=event.target.value;renderCards();}});

// 5. 입력 양식 저장. 데이터는 store.js의 persist()를 통해 현재 기기에 저장합니다.

$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog'))closeDialog();});
window.addEventListener('hashchange',route);window.addEventListener('online',connection);window.addEventListener('offline',connection);
window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});
function connection() {
  $('#connection').textContent = !navigator.onLine ? '오프라인' : (backend.available ? '서버 연결' : '기기 저장');
  $('#connection').classList.toggle('offline', !navigator.onLine);
}
if('serviceWorker'in navigator && /^https?:/.test(globalThis.location.protocol) && !nativeAndroid()&&!nativeIOS())navigator.serviceWorker.register('./sw.js').catch(()=>toast('오프라인 캐시를 준비하지 못했어요. 서버 실행 상태를 확인해 주세요.'));


// 기기 내 산행 기록은 계정마다 구분합니다. 서버로 위치 이력을 자동 전송하지 않습니다.
function switchUser(user) {
  state.journals ||= {};
  const previous = state.user?.id || 'guest';
  state.journals[previous] = { records: state.records, favorites: state.favorites, profile: state.profile };
  if (previous !== (user?.id || 'guest')) {
    const journal = state.journals[user?.id || 'guest'];
    state.records = journal?.records || [];
    state.favorites = journal?.favorites || [];
    state.profile = journal?.profile || { experience: 1, fitness: 1, minutes: 180, transport: 'transit' };
  }
  state.user = user;
  save();
}

async function refreshServer({includeReviews=true}={}) {
  if (!backend.available || !navigator.onLine) return;
  if(includeReviews){const reviews=await apiRequest('reviews');state.reviews=[...state.reviews.filter(r=>r.storage!=='server'),...reviews.reviews];reviewPages.clear();}
  let serverPlans = [];
  if (backend.user) serverPlans = (await apiRequest('plans')).plans;
  if (sharedPlanId) {
    const shared = (await apiRequest('plans/' + sharedPlanId)).plan;
    if (!serverPlans.some(p => p.id === shared.id)) serverPlans.push(shared);
  }
  state.plans = [...state.plans.filter(p => p.storage !== 'server'), ...serverPlans];
  save();
  if (current === 'plans') render();
  if (detailId && isDetailVisible(detailId,'reviews')) detail(mountains.find(m => m.id === detailId));
}

function beginGPS(resume) {
  fixStatus = 'GPS 신호를 기다립니다. 위치 권한을 확인해 주세요.';
  const handled = nativeCall('start', {
    resume, startedAt: active.startedAt, alertsEnabled: active.alertsEnabled,
    routeSegments: active.routeSegments || []
  });
  if (!handled) {
    if (navigator.geolocation) watch = navigator.geolocation.watchPosition(
      p => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp }),
      () => globalThis.onTrailError('GPS를 수신하지 못했습니다. 위치 권한과 기기 설정을 확인해 주세요.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    else globalThis.onTrailError('이 환경에서는 GPS를 사용할 수 없습니다.');
  }
  clearInterval(timer);
  timer = setInterval(updateRecording, 1000);
  render();
}

function routeImportDialog(id) {
  if (active || state.activeSession) { toast('진행 중인 산행을 저장한 뒤 경로를 가져와 주세요.'); return; }
  const mountain = mountains.find(m => m.id === id);
  showDialog(`<span class="eyebrow">YOUR ROUTE, OFFLINE</span><h2>${e(mountain.name)} GPX 경로 가져오기</h2>
    <p>파일은 이 기기에서 읽고 저장합니다. 서울 8개 산 주변 배경지도와 함께 표시하며 실시간 통제 정보는 포함하지 않습니다.</p>
    <form id="route-import-form" data-mountain="${id}"><label>경로 이름<input name="routeName" required maxlength="80" value="${e(mountain.name)} 내 경로"></label>
    <label>GPX 파일 (3MB 이하)<input name="gpx" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" required></label>
    <label class="checkbox"><input type="checkbox" name="confirmed" required>직접 확보한 경로이며 출처와 이용 조건을 확인했습니다.</label>
    <p class="muted">가져온 경로는 공식 검증 경로로 표시하지 않습니다. 여러 구간은 임의의 직선으로 연결하지 않습니다.</p>
    <button class="primary wide">경로 미리 보기</button><p id="form-error" class="form-error" role="alert"></p></form>`);
}

function previewImportedRoute(mountain, route) {
  const nearest = route.segments.reduce((distance, segment) =>
    segment.reduce((minimum, point) => Math.min(minimum, distanceKm(mountain, point)), distance), Infinity);
  const warning = nearest > 3
    ? `<p role="alert">가장 가까운 경로 지점도 산의 대표 위치에서 직선으로 약 ${nearest.toFixed(1)}km 떨어져 있습니다. 선택한 산과 파일이 맞는지 확인해 주세요.</p>` : '';
  showDialog(`<span class="eyebrow">GPX</span><h2>${e(mountain.name)} 경로 확인</h2>
    <p>${e(route.name)} · ${route.km.toFixed(2)}km · ${route.segments.length}개 구간 · ${route.count}개 좌표</p>
    ${warning}${geoMap(route, [], null, { ...mapOptions(mountain, 'gpx-preview'), resetView: true })}
    <p>공식 코스 안내와 출발·도착 위치를 비교해 주세요. ${state.routes[mountain.id] ? '저장하면 이 산에 가져왔던 경로를 교체합니다.' : '저장하면 이 산의 사용자 경로로 표시합니다.'}</p>
    <form id="route-confirm-form"><button class="primary wide">이 경로 저장</button><button type="button" class="outline wide" data-action="import-route" data-id="${mountain.id}">다른 파일 선택</button><p id="form-error" class="form-error" role="alert"></p></form>`);
  pendingRoute = { mountain, route, userId: state.user?.id ?? null };
}

async function handleAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action, id = button.dataset.id;
  try {
    if(action.startsWith('map-')) {changeMapView(action,button.dataset.mapId);return;}
    if(action==='use-bundled-route') {
      if(active)throw Error('산행 중에는 경로를 바꿀 수 없습니다.');
      delete state.routes[id];save();selected=mountains.find(m=>m.id===id);closeDialog();globalThis.location.hash='map';render();toast('OSM 기본 경로로 전환했어요.');return;
    }
    switch (action) {
      case 'reviews-more': await refreshMountainReviews(id,true);break;
      case 'reviews-refresh': await refreshMountainReviews(id,false);break;
      case 'remove-photo': {const index=Number(button.dataset.index);if(Number.isInteger(index)&&index>=0&&index<reviewPhotos.length){photoGeneration++;reviewPhotos.splice(index,1);updateReviewPhotos();}break;}
      case 'facility-filter': facilityOptions.kind=button.dataset.kind;detail(mountains.find(m=>m.id===detailId));break;
      case 'facility-focus': focusMapFacility('facilities-'+detailId,facilityById(id));$('#dialog [data-map-view]')?.scrollIntoView({block:'center',behavior:'smooth'});break;
      case 'notices-refresh': refreshNotices(mountains.find(m=>m.id===id)); break;
      case 'weather-refresh': refreshWeather(mountains.find(m=>m.id===id)); break;
      case 'server-status':
        showDialog(`<span class="eyebrow">CONNECTION</span><h2>${backend.available ? '서버에 연결되어 있어요' : '현재 기기 저장 모드예요'}</h2><p>${serverOrigin ? '앱의 지정 서버: ' + e(serverOrigin) : (nativeAndroid() || nativeIOS()) ? '공유 서버 주소가 아직 준비되지 않았습니다. 지도와 산행 기록은 이 기기에서 이용할 수 있습니다.' : '같은 주소의 미리보기 서버에 연결합니다.'}</p>${backend.error ? `<p class="form-error">${e(backend.error)}</p>` : ''}<p>서버에 저장한 일정·후기와 기기 GPS 기록은 구분해서 보관합니다. 기기 자료를 서버로 자동 업로드하지 않습니다.</p><button class="primary wide" data-action="refresh-server">연결 다시 확인</button>`); break;
      case 'close': pendingBackup = null; closeDialog(); break;
      case 'account':
        accountDialog();
        break;
      case 'password-dialog':
        showDialog(`<h2>비밀번호 변경</h2><p>변경하면 다른 기기의 로그인도 해제됩니다.</p><form id="password-form"><label>현재 비밀번호<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><label>새 비밀번호<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label>새 비밀번호 확인<input name="repeat" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><button class="primary wide">비밀번호 변경</button><p id="form-error" class="form-error" role="alert"></p></form>`); break;
      case 'delete-account-dialog':
        if (active || state.activeSession) throw Error('진행 중인 산행을 저장한 뒤 계정을 관리해 주세요.');
        showDialog(`<h2>서버 계정 탈퇴</h2><p>계정과 작성한 일정·후기·사진·참가 응답이 삭제되며 복구할 수 없습니다. 먼저 내 자료를 내보내세요. 다른 기기에 저장한 GPS 기록은 별도로 남습니다.</p><form id="delete-account-form"><label>현재 비밀번호<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><label>확인 문구<input name="confirm" placeholder="탈퇴" required></label><label class="checkbox"><input name="removeLocal" type="checkbox">이 기기에 남은 해당 계정의 기록·즐겨찾기도 삭제</label><button class="primary wide">계정과 서버 자료 삭제</button><p id="form-error" class="form-error" role="alert"></p></form>`); break;
      case 'export-account': {
        const data=await apiRequest('account/export');
        showDialog(`<span class="eyebrow">YOUR SERVER ARCHIVE</span><h2>서버 자료 보관하기</h2><p>일정 ${data.plans.length}개 · 후기 ${data.reviews.length}개 · 참가 응답 ${data.responses.length}개</p><p>전체 요약에는 사진 주소만 포함됩니다. 사진 원본을 함께 보관하려면 아래 후기별 파일도 저장하세요. 계정 탈퇴·후기 삭제 후에는 사진 주소로 볼 수 없습니다.</p><button class="primary wide" data-action="export-account-summary">전체 요약 저장</button><div class="archive-reviews">${data.reviews.map(review=>`<button class="outline wide" data-action="export-review" data-id="${review.id}">${e(mountains.find(m=>m.id===review.mountainId)?.name||'산행')} · ${e(review.date)} · 사진 ${(review.photos||[]).length}장 포함 저장</button>`).join('')||'<p>내가 작성한 후기가 없습니다.</p>'}</div><p class="muted">개인 보관용 JSON입니다. 서버로 다시 가져오는 기능은 포함하지 않습니다.</p>`);break;
      }
      case 'export-account-summary': downloadJSON(await apiRequest('account/export'), 'sangil-ttara-account-summary.json'); break;
      case 'export-review': downloadJSON(await apiRequest('account/export/reviews/'+id), 'sangil-ttara-review-'+id+'.json'); break;
      case 'logout':
        if (active || (state.activeSession && state.activeSession.userId === state.user?.id)) { toast('진행 중인 산행을 저장한 뒤 로그아웃해 주세요.'); return; }
        if (backend.available) { await apiRequest('auth/logout', 'POST', {}); backend.user = null; }
        switchUser(null); closeDialog(); await refreshServer(); render(); break;
      case 'locate': locate(); break;
      case 'recommend': recommendDialog(); break;
      case 'filter': filter = button.dataset.filter; render(); break;
      case 'detail': detailTab = 'course'; detail(mountains.find(m => m.id === id)); break;
      case 'detail-tab': detailTab = button.dataset.tab; detail(mountains.find(m => m.id === detailId)); break;
      case 'favorite':
        state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
        save(); render(); break;
      case 'select':
        if (active && selected.id !== id) { toast('기록 중에는 코스를 바꿀 수 없어요.'); return; }
        selected = mountains.find(m => m.id === id); closeDialog(); globalThis.location.hash = 'map'; render(); break;
      case 'save-course': await saveCourse(id); break;
      case 'remove-save': state.saved = state.saved.filter(x => x !== id); save(); render(); break;
      case 'import-route': routeImportDialog(id); break;
      case 'plan': planDialog(id); break;
      case 'review': reviewDialog(id); break;
      case 'edit-review': {
        const review = state.reviews.find(r => r.id === id);
        if (review?.userId === state.user?.id) reviewDialog(review.mountainId, review);
        break;
      }
      case 'delete-review':
        showDialog(`<h2>후기와 사진을 삭제할까요?</h2><p>삭제하면 복구할 수 없습니다.</p><button class="primary wide" data-action="confirm-delete-review" data-id="${e(id)}">후기와 사진 삭제</button>`);break;
      case 'confirm-delete-review': {
        const review = state.reviews.find(r => r.id === id);
        if (review?.userId !== state.user?.id) return;
        if (review.storage === 'server') await apiRequest('reviews/' + id, 'DELETE', {});
        state.reviews = state.reviews.filter(r => r.id !== id);reviewPages.delete(review.mountainId);save();detail(mountains.find(m => m.id === review.mountainId));break;
      }
      case 'clear-photos': photoGeneration++;reviewPhotos=[];$('#photo-input').value='';updateReviewPhotos();break;
      case 'start': start(); break;
      case 'finish':
        if (recoverySessionId) { toast('기기에 남은 GPS 기록을 확인 중입니다.'); break; }
        finish(); break;
      case 'resume-session':
      case 'recover-finish': {
        const session = state.activeSession;
        if (!session) return;
        if (!state.user || (session.userId && session.userId !== state.user.id)) { toast('기록을 시작한 계정으로 로그인해 주세요.'); return; }
        active = session;
        selected = mountains.find(m => m.id === session.mountainId) || selected;
        if (action === 'resume-session') beginGPS(true);
        else {
          render();
          recoverySessionId = session.id;
          if (nativeCall('replay-gps', { sessionId: session.id })) {
            recoveryTimer = setTimeout(() => {
              recoverySessionId = null;
              toast('기기에 남은 GPS 기록을 확인하지 못했습니다. 현재 기록은 유지됩니다.');
            }, 5000);
          } else {
            recoverySessionId = null;
            finish();
          }
        }
        break;
      }
      case 'respond': login(async () => {
        try {
          const plan = state.plans.find(p => p.id === id);
          if (plan.storage === 'server') {
            const result = await apiRequest('plans/' + id + '/response', 'POST', { status: button.dataset.status });
            state.plans = state.plans.map(p => p.id === id ? result.plan : p);
          } else {
            plan.responses = (plan.responses || []).filter(r => r.userId !== state.user.id);
            plan.responses.push({ userId: state.user.id, name: state.user.name, status: button.dataset.status });
          }
          save(); closeDialog(); render();
        } catch (error) { toast(error.message); }
      }); break;
      case 'share': await sharePlan(id); break;
      case 'copy-share': {
        const textarea = $('#dialog textarea');
        await navigator.clipboard.writeText(textarea.value); toast('링크를 복사했어요.'); break;
      }
      case 'delete-plan':
        showDialog(`<h2>일정을 삭제할까요?</h2><p>이 일정과 참가 응답이 삭제됩니다.</p><button class="primary wide" data-action="confirm-delete-plan" data-id="${e(id)}">삭제하기</button>`); break;
      case 'confirm-delete-plan': {
        const plan = state.plans.find(p => p.id === id);
        if (plan?.storage === 'server') await apiRequest('plans/' + id, 'DELETE', {});
        state.plans = state.plans.filter(p => p.id !== id); save(); closeDialog(); render(); break;
      }
      case 'delete-record':
        showDialog(`<h2>산행 기록을 삭제할까요?</h2><p>이 기기의 현재 계정에서 삭제됩니다. 보관하려면 먼저 기록을 내보내 주세요.</p><button class="primary wide" data-action="confirm-delete-record" data-id="${e(id)}">이 기록 삭제</button>`); break;
      case 'confirm-delete-record': {
        const before = state.records;
        state.records = before.filter(r => r.id !== id);
        if (!save()) { state.records = before; break; }
        closeDialog(); render(); toast('기록을 삭제했어요.'); break;
      }
      case 'export-gpx': {
        const record = state.records.find(r => r.id === id);
        if (!record) throw Error('기록을 찾을 수 없습니다.');
        const name = mountains.find(m => m.id === record.mountainId)?.name || '산행 기록';
        downloadFile(recordGPX(record, name + ' · ' + record.date), `sangil-${record.mountainId}-${record.startedAt}.gpx`, 'application/gpx+xml'); break;
      }
      case 'import-records':
        if (active || state.activeSession) throw Error('진행 중인 산행을 저장한 뒤 기록을 가져와 주세요.');
        pendingBackup = null;
        showDialog(`<span class="eyebrow">YOUR TRAIL BACKUP</span><h2>산행 기록 가져오기</h2><p>산길따라에서 내보낸 JSON 기록 파일을 선택하세요. 파일을 확인한 뒤 추가할 기록 수를 보여드립니다.</p><p>현재 ${state.user ? e(state.user.name) + ' 계정' : '비회원 영역'}에 추가합니다. 기존 기록은 덮어쓰지 않으며 로그인 정보·서버 일정·후기는 가져오지 않습니다.</p><form id="backup-file-form"><label>기록 JSON 파일 (최대 16MB)<input type="file" accept=".json,application/json" required></label><button class="primary wide">파일 확인</button><p id="form-error" class="form-error" role="alert"></p></form>`); break;
      case 'refresh-server':
        await connectBackend();
        if (!backend.available) throw Error(backend.error || '공유 서버가 아직 설정되지 않았거나 연결할 수 없습니다. 기기 기록은 유지됩니다.');
        if (!active && !state.activeSession) switchUser(backend.user);
        await refreshServer(); connection(); toast('서버 정보를 확인했어요.'); break;
      case 'export': {
        downloadJSON(makeRecordBackup(state.records), 'sangil-ttara-records.json'); break;
      }
      case 'import-plan': showDialog(`<h2>공유 일정 가져오기</h2><form id="import-form"><label>공유 링크 또는 기기 일정 코드<textarea name="code" rows="5" maxlength="6000" required></textarea></label><button class="primary wide">일정 열기</button><p id="form-error" class="form-error" role="alert"></p></form>`); break;
    }
  } catch (error) {
    if (error.status === 401 && !active) { backend.user = null; switchUser(null); }
    toast(error.message);
  }
}

async function handleChange(event) {
  const input = event.target;
  if (input.dataset.checklist) {
    const id = input.dataset.mountain;
    const items = new Set(state.checklists[id] || []);
    if (input.checked) items.add(input.dataset.checklist); else items.delete(input.dataset.checklist);
    state.checklists[id] = [...items]; save(); detail(mountains.find(m => m.id === id));
  }
  if(input.id==='facility-origin'||input.id==='facility-radius'){if(input.id==='facility-origin')facilityOptions.origin=input.value;else facilityOptions.radius=Number(input.value);detail(mountains.find(m=>m.id===detailId));return;}
  if (input.id === 'map-course') {
    if (active) { toast('기록 중에는 코스를 바꿀 수 없어요.'); input.value = selected.id; return; }
    selected = mountains.find(m => m.id === input.value); render();
  }
  if(input.id==='photo-input') {
    if(input.disabled)return;
    const form=$('#review-form'),button=form.querySelector('button.primary'),generation=++photoGeneration;
    input.disabled=true;
    button.disabled=true;
    try{const photos=await prepareReviewPhotos([...input.files]);if(generation!==photoGeneration||!form.isConnected||!$('#dialog').open)return;if(reviewPhotos.length+photos.length>3)throw Error('기존 사진을 포함해 최대 3장입니다. 먼저 사진을 지워 주세요.');reviewPhotos.push(...photos);input.value='';updateReviewPhotos();}
    catch(error){if(generation===photoGeneration&&form.isConnected&&$('#dialog').open)toast(error.message);}
    finally{input.value='';input.disabled=false;if(button.isConnected)button.disabled=false;}
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target, data = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('button.primary');
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;
  try {
    switch (form.id) {
      case 'backup-file-form': {
        if (active || state.activeSession) throw Error('진행 중인 산행을 저장해 주세요.');
        const file = form.querySelector('input[type="file"]').files[0];
        if (!file || file.size > 16 * 1024 * 1024) throw Error('16MB 이하 JSON 기록 파일을 선택해 주세요.');
        const records = parseRecordBackup(await file.text(), mountains);
        const preview = mergeRecordBackup(state.records, records, state.user?.id);
        pendingBackup = { records, userId: state.user?.id || null };
        showDialog(`<h2>가져올 기록을 확인해 주세요</h2><p>파일의 기록 ${records.length}개 중 <strong>${preview.added}개 추가</strong>, 같은 번호의 기록 ${preview.skipped}개는 건너뜁니다.</p><p>현재 ${state.user ? e(state.user.name) + ' 계정' : '비회원 영역'}에 추가합니다. 기존 기록을 교체하거나 완주 여부를 바꾸지 않습니다.</p><form id="restore-records-form"><button class="primary wide" ${preview.added ? '' : 'disabled'}>확인한 기록 추가</button><p id="form-error" class="form-error" role="alert"></p></form>`); break;
      }
      case 'restore-records-form': {
        if (active || state.activeSession) throw Error('진행 중인 산행을 저장해 주세요.');
        if (!pendingBackup || pendingBackup.userId !== (state.user?.id || null)) throw Error('계정이 바뀌었습니다. 파일을 다시 선택해 주세요.');
        const before = state.records;
        const merged = mergeRecordBackup(before, pendingBackup.records, state.user?.id);
        state.records = merged.records;
        if (!save()) { state.records = before; throw Error('저장 공간이 부족해 가져오기를 취소했습니다. 기존 기록은 유지됩니다.'); }
        pendingBackup = null; closeDialog(); globalThis.location.hash = 'my'; render(); toast(`${merged.added}개 기록을 추가했어요.`); break;
      }
      case 'password-form':
        if (data.newPassword !== data.repeat) throw Error('새 비밀번호 확인이 일치하지 않습니다.');
        await apiRequest('account/password', 'POST', { password: data.password, newPassword: data.newPassword });
        accountDialog(); toast('비밀번호를 변경했어요. 다른 로그인은 해제되었습니다.'); break;
      case 'delete-account-form': {
        if (active || state.activeSession) throw Error('진행 중인 산행을 저장해 주세요.');
        const oldId = state.user.id;
        await apiRequest('account', 'DELETE', { password: data.password, confirm: data.confirm });
        backend.user = null; switchUser(null);
        if (data.removeLocal === 'on') delete state.journals[oldId];
        state.plans = state.plans.filter(p => p.ownerId !== oldId || p.storage !== 'server');
        state.reviews = state.reviews.filter(r => r.userId !== oldId || r.storage !== 'server');
        save(); closeDialog(); render(); toast('서버 계정과 자료를 삭제했어요.'); break;
      }
      case 'login-form': {
        const name = data.nickname.trim();
        if (!name) throw Error('별명을 입력해 주세요.');
        if (backend.available) {
          backend.user = (await apiRequest('auth/' + data.mode, 'POST', { nickname: name, password: data.password })).user;
          switchUser(backend.user);
          await refreshServer();
        } else switchUser({ id: 'example-user', name });
        closeDialog(); render(); const task = pending; pending = null; await task?.(); break;
      }
      case 'recommend-form':
        state.profile = { experience: Number(data.experience), fitness: Number(data.fitness), minutes: Number(data.minutes), transport: data.transport };
        save(); filter = 'personal'; closeDialog(); globalThis.location.hash = 'home'; render(); toast('입력한 조건과 내 이력으로 추천 순서를 바꿨어요.'); break;
      case 'plan-form': {
        if (!state.user || (backend.available && backend.user?.id !== state.user.id)) throw Error('로그인 상태가 바뀌었습니다. 계정을 다시 확인해 주세요.');
        if (!data.title.trim() || !data.place.trim()) throw Error('일정 이름과 장소를 입력해 주세요.');
        const plan = backend.available && backend.user
          ? (await apiRequest('plans','POST',{...data,id:form.dataset.draftId||undefined})).plan
          : { id: uid(), ...data, title: data.title.trim(), place: data.place.trim(), responses: [{ userId: state.user.id, name: state.user.name, status: 'yes' }], storage: 'device' };
        state.plans.unshift(plan); save(); closeDialog(); globalThis.location.hash = 'plans'; render(); break;
      }
      case 'review-form': {
        if (!state.user || (backend.available && backend.user?.id !== state.user.id)) throw Error('로그인 상태가 바뀌었습니다. 계정을 다시 확인해 주세요.');
        if (!data.text.trim()) throw Error('후기 내용을 입력해 주세요.');
        let review = { id: form.dataset.edit || uid(), mountainId: form.dataset.mountain, userId: state.user.id, author: state.user.name, text: data.text.trim(), rating: Number(data.rating), date: new Date().toLocaleDateString('ko-KR'), photos: reviewPhotos, storage: 'device' };
        const old = state.reviews.find(r => r.id === review.id);
        if (backend.available && backend.user) {
          const payload={...review,id:old?.storage==='server'?old.id:(form.dataset.draftId||serverDraftId()),revision:form.dataset.revision||undefined};
          review = (await apiRequest('reviews', 'POST', payload)).review;
        }
        const previous = [...state.reviews];
        state.reviews = [review, ...state.reviews.filter(r => r.id !== review.id && r.id !== form.dataset.edit)];
        if (!save()) { state.reviews = previous; throw Error('사진 용량을 줄이거나 저장 공간을 정리해 주세요.'); }
        if(review.storage==='server')reviewPages.delete(review.mountainId);
        toast(review.storage === 'server' ? '후기를 서버에 저장했어요.' : '후기를 이 기기에 저장했어요.'); detailTab = 'reviews'; detail(mountains.find(m => m.id === review.mountainId)); break;
      }
      case 'route-import-form': {
        if (active || state.activeSession) throw Error('진행 중인 산행을 먼저 저장해 주세요.');
        const file = form.querySelector('input[type="file"]').files[0];
        if (!file || file.size > 3 * 1024 * 1024 || !data.routeName.trim()) throw Error('경로 이름과 3MB 이하 GPX 파일을 확인해 주세요.');
        if (!data.confirmed) throw Error('경로 출처와 이용 조건을 확인해 주세요.');
        const mountain = mountains.find(m => m.id === form.dataset.mountain);
        const userId = state.user?.id ?? null;
        const content = await file.text();
        if (!form.isConnected || !$('#dialog').open) break;
        if (userId !== (state.user?.id ?? null)) throw Error('계정이 바뀌었습니다. 파일을 다시 선택해 주세요.');
        const route = { ...parseGPX(content), name: data.routeName.trim(), importedAt: new Date().toISOString(), provenance: 'user-provided', courseId: mountain.courseId };
        previewImportedRoute(mountain, route);
        break;
      }
      case 'route-confirm-form': {
        if (active || state.activeSession) throw Error('진행 중인 산행을 먼저 저장해 주세요.');
        if (!pendingRoute || pendingRoute.userId !== (state.user?.id ?? null)) throw Error('경로 파일을 다시 선택해 주세요.');
        const { mountain, route } = pendingRoute;
        const old = state.routes[mountain.id];
        state.routes[mountain.id] = route;
        if (!save()) { if (old) state.routes[mountain.id] = old; else delete state.routes[mountain.id]; throw Error('경로를 저장할 공간이 부족합니다.'); }
        selected = mountain;
        closeDialog(); globalThis.location.hash = 'map'; render(); toast(`GPX ${route.count}개 좌표를 저장했어요. 여러 구간은 분리해서 표시합니다.`); break;
      }
      case 'finish-form': {
        if (!active) return;
        const record = { ...active, routeSegments: undefined, date: new Date(active.startedAt).toLocaleDateString('ko-KR'), minutes: (Date.now() - active.startedAt) / 60000, complete: data.complete === 'on' };
        const previousSession = state.activeSession;
        state.records.unshift(record); state.activeSession = null;
        if (!save()) { state.records.shift(); state.activeSession = previousSession; throw Error('기록을 저장할 공간이 부족합니다.'); }
        nativeCall('stop');
        if (watch !== null) navigator.geolocation.clearWatch(watch);
        watch = null; clearInterval(timer); active = null; fixStatus = '산행 기록을 저장했어요.';
        closeDialog(); globalThis.location.hash = 'my'; render(); break;
      }
      case 'import-form': {
        const sharedId = sharedPlanIdFromLink(data.code.trim(), serverOrigin || globalThis.location.origin);
        if (sharedId) {
          if (!backend.available) throw Error('공유 일정을 열려면 서버 연결이 필요합니다.');
          const plan = (await apiRequest('plans/' + sharedId)).plan;
          sharedPlanId = sharedId;
          state.plans = [...state.plans.filter(p => p.id !== sharedId), plan];
          save(); closeDialog(); globalThis.location.hash = 'plans'; render(); break;
        }
        const plan = decodePlan(data.code.trim(), mountains);
        if (!state.plans.some(p => p.id === plan.id)) state.plans.unshift(plan);
        save(); closeDialog(); globalThis.location.hash = 'plans'; render(); break;
      }
    }
  } catch (error) {
    if (error.status === 401 && !active && !state.activeSession) { backend.user = null; switchUser(null); }
    const message = form.querySelector('#form-error');
    if (message) message.textContent = error.message;
    toast(error.message);
  } finally { if (submit?.isConnected) submit.disabled = false; }
}

document.addEventListener('pointerdown',startMapDrag);
document.addEventListener('pointermove',moveMapDrag);
document.addEventListener('pointerup',endMapDrag);
document.addEventListener('pointercancel',endMapDrag);
document.addEventListener('keydown',keyMapView);
document.addEventListener('click', handleAction);
document.addEventListener('change', handleChange);
document.addEventListener('submit', handleSubmit);

async function initialize() {
  route(); connection();
  nativeCall('ready');
  await connectBackend();
  if (backend.available) {
    // 진행 중인 기록은 계정이 맞는지 확인한 뒤 사용자가 명시적으로 복구합니다.
    switchUser(backend.user);
    try { await refreshServer(); } catch (error) { toast(error.message); }
    route(); connection();
  }
  setInterval(() => {
    if (current === 'plans' && document.visibilityState === 'visible' && !$('#dialog').open) refreshServer({includeReviews:false}).catch(error => toast(error.message));
  }, 10000);
  if (state.activeSession) toast('저장되지 않은 산행이 있어요. 등산 지도에서 복구할 수 있습니다.');
}
initialize();
