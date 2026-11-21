import {mountains} from '../web/js/data.js';
import {fetchForecast,weatherAge} from '../web/js/weather-data.js';
const mountain=mountains.find(m=>m.id==='achasan');
const data=await fetchForecast(mountain);
console.log(JSON.stringify({mountain:mountain.name,temperature:data.temperature,wind:data.wind,days:data.days.length,modelTime:new Date(data.modelTime).toISOString(),fetchedAt:new Date(data.fetchedAt).toISOString(),freshness:weatherAge(data),source:data.source.name},null,2));
