import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {parseForecast,weatherAge,weatherURL,weatherLabel} from '../web/js/weather-data.js';
import {createWeatherService} from '../server/weather.mjs';
import {openDatabase} from '../server/database.mjs';
import {createAPI} from '../server/api.mjs';
const now=Date.now();
const example=()=>({timezone:'Asia/Seoul',current_units:{temperature_2m:'°C',wind_speed_10m:'m/s'},current:{time:Math.floor(now/1000),temperature_2m:0,apparent_temperature:-2,relative_humidity_2m:50,weather_code:0,wind_speed_10m:2,wind_gusts_10m:4},daily:{time:[Math.floor(now/1000)],temperature_2m_max:[5],temperature_2m_min:[-1],precipitation_probability_max:[0],weather_code:[0],sunrise:[Math.floor(now/1000)],sunset:[Math.floor(now/1000)+36000]}});

test('날씨는 산 대표 좌표와 명시한 단위로 조회하며 0과 미확인을 구분한다',()=>{
  const url=new URL(weatherURL({id:'example',lat:37.5,lng:127}));
  assert.equal(url.origin,'https://api.open-meteo.com');assert.equal(url.searchParams.get('wind_speed_unit'),'ms');
  assert.equal(url.searchParams.get('latitude'),'37.5');assert.equal(url.searchParams.get('forecast_days'),'3');
  const data=parseForecast(example(),'example',now);assert.equal(data.temperature,0);assert.equal(data.days[0].rainProbability,0);
  const missing=example();missing.current.temperature_2m=null;missing.daily.precipitation_probability_max=[null];
  assert.equal(parseForecast(missing,'example',now).temperature,null);assert.equal(parseForecast(missing,'example',now).days[0].rainProbability,null);
  assert.equal(weatherLabel(999),'상태 미확인');assert.throws(()=>weatherURL({lat:100,lng:127}));
});

test('예보 단위·날짜 오류를 거부하고 오래된 값은 현재 정보로 표시하지 않는다',()=>{
  const raw=example();raw.current_units.wind_speed_10m='km/h';assert.throws(()=>parseForecast(raw,'example',now));
  assert.throws(()=>parseForecast({error:true},'example',now));
  const data=parseForecast(example(),'example',now);
  assert.equal(weatherAge(data,now),'fresh');assert.equal(weatherAge(data,now+16*60000),'stale');
  assert.equal(weatherAge(data,now+7*3600000),'expired');assert.equal(weatherAge({...data,fetchedAt:now+1e8},now),'expired');
});

test('동시 날씨 조회는 한 번만 전송하고 갱신 실패 시 원래 수신 시각을 보존한다',async()=>{
  let time=now,calls=0,fail=false;
  const service=createWeatherService({now:()=>time,fetcher:async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));if(fail)throw Error('upstream unavailable');return {ok:true,json:async()=>example()};}});
  const [a,b]=await Promise.all([service('achasan'),service('achasan')]);assert.equal(calls,1);assert.equal(a.fetchedAt,b.fetchedAt);
  await service('achasan');assert.equal(calls,1);
  time+=20*60000;fail=true;const stale=await service('achasan');assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,now);
  time+=7*3600000;await assert.rejects(service('achasan'),error=>error.status===503);
  await assert.rejects(service('unknown'),error=>error.status===404);
});

test('날씨 API는 로그인 없이 정상 데이터·제공처 실패 상태를 구분해 응답한다',async()=>{
  const db=openDatabase(':memory:');const handle=createAPI(db,{weatherService:async id=>{if(id==='achasan')return {mountainId:id,source:'예시 제공처'};const error=Error('조회 실패');error.status=503;throw error;}});
  const server=http.createServer(handle);server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}/api/weather/`;
  try {const response=await fetch(url+'achasan');assert.equal(response.status,200);assert.equal((await response.json()).weather.mountainId,'achasan');assert.equal((await fetch(url+'bukhansan')).status,503);}
  finally{server.close();server.closeAllConnections();await once(server,'close');db.close();}
});
