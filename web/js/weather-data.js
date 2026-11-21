export const weatherSource = { name: 'Open-Meteo', url: 'https://open-meteo.com/', licence: 'https://creativecommons.org/licenses/by/4.0/' };
export const WEATHER_FRESH_MS = 15 * 60000;
export const WEATHER_MAX_AGE_MS = 6 * 3600000;
export function weatherLabel(code) {
  if (code === 0) return '맑음';
  if ([1,2].includes(code)) return '구름 조금';
  if (code === 3) return '흐림';
  if ([45,48].includes(code)) return '안개';
  if ([51,53,55,56,57].includes(code)) return '이슬비';
  if ([61,63,65,66,67,80,81,82].includes(code)) return '비';
  if ([71,73,75,77,85,86].includes(code)) return '눈';
  if ([95,96,99].includes(code)) return '뇌우';
  return '상태 미확인';
}
const number = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
export function weatherURL(mountain) {
  if (!Number.isFinite(mountain?.lat) || !Number.isFinite(mountain?.lng) || Math.abs(mountain.lat)>90 || Math.abs(mountain.lng)>180) throw Error('날씨 조회 지점이 올바르지 않습니다.');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude:String(mountain.lat),longitude:String(mountain.lng),
    current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m',
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset',
    timezone:'Asia/Seoul',timeformat:'unixtime',wind_speed_unit:'ms',forecast_days:'3'}).toString();
  return url.href;
}
export function parseForecast(raw,mountainId,fetchedAt=Date.now()) {
  if (!raw || raw.error || !Number.isFinite(raw.current?.time) || raw.current.time < 0 || raw.timezone !== 'Asia/Seoul') throw Error('날씨 응답의 시각·지역을 확인할 수 없습니다.');
  if (raw.current_units?.temperature_2m !== '°C' || raw.current_units?.wind_speed_10m !== 'm/s') throw Error('날씨 응답의 단위가 예상과 다릅니다.');
  const value=raw.current;
  const daily=raw.daily;
  if (!Array.isArray(daily?.time) || daily.time.length < 1 || daily.time.length > 3) throw Error('일별 예보를 확인할 수 없습니다.');
  const days=daily.time.map((time,index)=>{
    if (!Number.isFinite(time) || time < 0) throw Error('일별 예보의 날짜가 올바르지 않습니다.');
    const code=number(daily.weather_code?.[index],0,99);
    return {time:time*1000,code,label:weatherLabel(code),high:number(daily.temperature_2m_max?.[index],-100,70),low:number(daily.temperature_2m_min?.[index],-100,70),rainProbability:number(daily.precipitation_probability_max?.[index],0,100),sunrise:number(daily.sunrise?.[index],0,1e11),sunset:number(daily.sunset?.[index],0,1e11)};
  });
  const code=number(value.weather_code,0,99);
  return {mountainId,fetchedAt,modelTime:value.time*1000,temperature:number(value.temperature_2m,-100,70),feelsLike:number(value.apparent_temperature,-120,90),humidity:number(value.relative_humidity_2m,0,100),wind:number(value.wind_speed_10m,0,150),gust:number(value.wind_gusts_10m,0,150),code,label:weatherLabel(code),days,source:weatherSource};
}
export function weatherAge(data,now=Date.now()) {
  if (!data || !Number.isFinite(data.fetchedAt) || !Number.isFinite(data.modelTime) || data.fetchedAt > now+300000 || data.modelTime > now+3600000) return 'expired';
  if (now-data.fetchedAt>WEATHER_MAX_AGE_MS || now-data.modelTime>WEATHER_MAX_AGE_MS) return 'expired';
  return now-data.fetchedAt>WEATHER_FRESH_MS || now-data.modelTime>90*60000 ? 'stale' : 'fresh';
}
export async function fetchForecast(mountain,{fetcher=globalThis.fetch,now=Date.now}={}) {
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetcher(weatherURL(mountain),{signal:controller.signal,credentials:'omit',cache:'no-store'});
    if(!response.ok)throw Error('날씨 제공처에 연결하지 못했습니다.');
    return parseForecast(await response.json(),mountain.id,now());
  } catch(error) { if(controller.signal.aborted)throw Error('날씨 조회 시간이 초과되었습니다.');throw error; }
  finally {clearTimeout(timeout);}
}
