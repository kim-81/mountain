import {apiRequest} from './api.js';
import {noticeSources,noticeSourceFor,parseOfficialNotices,noticeAge,selectNotices} from './official-notices-data.js';
import {escapeHTML as e} from './core.js';
const states=new Map();
export function noticeState(id){const key=noticeSourceFor(id);if(!states.has(key))states.set(key,{status:'idle',data:null,error:null});return states.get(key);}
export async function loadNotices(mountain){
  const state=noticeState(mountain.id);if(state.status==='loading')return;
  state.status='loading';state.error=null;const sourceId=noticeSourceFor(mountain.id);
  try{
    const native=Boolean(globalThis.AndroidTrail||globalThis.webkit?.messageHandlers?.trail);
    const response=await apiRequest((native?'public-notices/':'notices/')+sourceId);
    const data=native?parseOfficialNotices(sourceId,response.html,response.fetchedAt):response.notices;
    if(data?.sourceId!==sourceId||noticeAge(data)==='expired'||!Array.isArray(data.items))throw Error('공지 자료의 유효 시간 또는 형식을 확인할 수 없습니다.');
    state.data=data;state.status='ready';
  }catch(error){state.status='error';state.error=error.message;}
}
export function noticesPanel(mountain){
  const state=noticeState(mountain.id),sourceId=noticeSourceFor(mountain.id),source=noticeSources[sourceId],data=noticeAge(state.data)==='expired'?null:state.data;
  const stale=data&&(noticeAge(data)!=='fresh'||data.stale||state.error||!navigator.onLine);
  return `<div class="weather-strip notice-panel"><div class="weather-heading"><h3>공식 공지·탐방 통제</h3><span class="data-badge sample">${state.status==='loading'?'조회 중':data?(stale?'이전 수신 자료':'공식 페이지 수신'):'연결 미확인'}</span></div><p>${sourceId==='knps'?'아래 상태는 공원 사무소 단위입니다. 선택한 둘레길 구간의 개방 여부를 뜻하지 않습니다.':'공식 게시판의 최근 제목·게시일입니다. 공지 유무로 코스의 개방 여부를 판단하지 않습니다.'}</p>
  ${data?`<ul class="notice-list">${selectNotices(data,mountain).map(item=>`<li><a href="${e(item.url)}" target="_blank" rel="noopener">${e(item.title)}${item.status?' · '+e(item.status):''} ↗</a><small>${item.status?'공단 표시 갱신 ':'게시 '}${e(item.date)}</small></li>`).join('')}</ul><p>앱 수신 ${e(new Date(data.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}${stale?' · 재확인 필요':''}</p>`:'<p>유효한 공지 자료가 없습니다. 출발 전 공식 원문에서 통제 구간을 확인하세요.</p>'}
  ${state.error||data?.error?'<p class="form-error">'+e(state.error||data.error)+'</p>':''}<div class="button-row"><button class="outline" data-action="notices-refresh" data-id="${mountain.id}" ${state.status==='loading'?'disabled':''}>공지 다시 확인</button><a href="${source.url}" target="_blank" rel="noopener">${e(source.name)} 원문 ↗</a></div><p class="muted">코스별 개방 미판정 · 수신 5분 이후 재확인, 30분 경과 자료는 숨깁니다.</p></div>`;
}
