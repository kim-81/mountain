import {mountains} from '../web/js/data.js';
import {fetchForecast,weatherAge} from '../web/js/weather-data.js';

export function createWeatherService(options={}) {
  const cache=new Map(),pending=new Map();
  return async function weather(id) {
    const mountain=mountains.find(m=>m.id===id);
    if(!mountain){const error=Error('지원하지 않는 산입니다.');error.status=404;throw error;}
    const now=(options.now||Date.now)();const cached=cache.get(id);
    if(weatherAge(cached,now)==='fresh')return {...cached,stale:false};
    if(pending.has(id))return pending.get(id);
    const request=(async()=>{
      try {const data=await fetchForecast(mountain,options);cache.set(id,data);return {...data,stale:weatherAge(data,(options.now||Date.now)())!=='fresh'};}
      catch {if(cached&&weatherAge(cached,(options.now||Date.now)())!=='expired')return {...cached,stale:true,notice:'갱신 실패 · 이전 예보입니다.'};const error=Error('날씨를 가져오지 못했습니다. 잠시 후 다시 확인해 주세요.');error.status=503;throw error;}
      finally {pending.delete(id);}
    })();
    pending.set(id,request);return request;
  };
}
