import {backend,apiRequest} from './api.js';
import {fetchForecast,weatherAge,weatherSource} from './weather-data.js';
import {escapeHTML as e} from './core.js';
const states=new Map();
function cached(id) {
  try {
    const data=JSON.parse(localStorage.getItem('sangil-weather-'+id)||'null');
    return data?.mountainId===id&&Array.isArray(data.days)&&data.days.length<=3&&data.days.every(day=>day&&Number.isFinite(day.time))&&weatherAge(data)!=='expired'?data:null;
  } catch {return null;}
}
export function weatherState(id) {
  if(!states.has(id)){const data=cached(id);states.set(id,{status:data&&weatherAge(data)==='fresh'?'ready':'idle',data,error:null});}
  return states.get(id);
}
export async function loadWeather(mountain) {
  const state=weatherState(mountain.id);
  if(state.status==='loading')return;
  state.status='loading';state.error=null;
  try {
    const data=backend.available?(await apiRequest('weather/'+mountain.id)).weather:await fetchForecast(mountain);
    if(data?.mountainId!==mountain.id||!Array.isArray(data.days)||!data.days.every(day=>day&&Number.isFinite(day.time))||weatherAge(data)==='expired')throw Error('날씨 예보의 유효 시간 또는 형식을 확인할 수 없습니다.');
    state.data=data;state.status='ready';
    try{localStorage.setItem('sangil-weather-'+mountain.id,JSON.stringify(data));}catch{/* 날씨 캐시 실패는 산행 기록 저장에 영향을 주지 않습니다. */}
  }catch(error){state.error=error.message;state.status='error';}
}
const value=(number,unit='')=>typeof number==='number'&&Number.isFinite(number)?`${Math.round(number)}${unit}`:'미확인';
const when=(time,day=false)=>Number.isFinite(time)?new Date(time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',...(day?{month:'numeric',day:'numeric',weekday:'short'}:{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}):'시각 미확인';
export function weatherPanel(mountain) {
  const state=weatherState(mountain.id),age=weatherAge(state.data);
  const data=age==='expired'?null:state.data;
  const stale=data&&(age!=='fresh'||data.stale||state.error||!navigator.onLine);
  const status=state.status==='loading'?'날씨를 확인하고 있어요':data?(stale?'이전 예보 · 최신 정보 재확인 필요':'최근 수신한 예보'):state.error?'날씨 연결 실패':'날씨 조회 준비';
  return `<div class="weather-strip"><div class="weather-heading"><h3>산행 날씨</h3><span class="data-badge ${stale?'sample':'verified'}">${e(status)}</span></div>
    ${data?`<div class="weather-now"><b>${value(data.temperature,'°')} · ${e(data.label)}</b><span>체감 ${value(data.feelsLike,'°')} · 바람 ${value(data.wind,'m/s')} · 돌풍 ${value(data.gust,'m/s')}</span></div><div class="weather-days">${data.days.map(day=>`<div><b>${e(when(day.time,true))}</b><span>${e(day.label)}</span><span>${value(day.low,'°')} / ${value(day.high,'°')}</span><span>강수 확률 ${value(day.rainProbability,'%')}</span></div>`).join('')}</div><p>수신 ${e(when(data.fetchedAt))} · 예보 기준 ${e(when(data.modelTime))}</p>`:'<p>아직 유효한 예보가 없습니다. 인터넷에 연결한 뒤 다시 확인해 주세요.</p>'}
    ${state.error?`<p class="form-error">${e(state.error)}</p>`:''}
    <button class="outline" data-action="weather-refresh" data-id="${mountain.id}" ${state.status==='loading'?'disabled':''}>날씨 다시 확인</button>
    <p>산의 공개 대표 지점 예보입니다. 정상 관측값·탐방 통제 상태와는 다릅니다.</p><p><a href="${weatherSource.url}" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> · <a href="${weatherSource.licence}" target="_blank" rel="noopener">CC BY 4.0 · 표시 형식 변환</a></p></div>`;
}
