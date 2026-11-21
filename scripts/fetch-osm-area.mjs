import fs from 'node:fs/promises';
const areas={
  'buram-connection':[127.065,37.619,127.095,37.636],
  'citywall-west':[126.959,37.567,126.975,37.596],
  'citywall-north':[126.965,37.585,127.006,37.599],
  'bonghwa':[127.077,37.599,127.101,37.621]
};
const name=process.argv[2],bounds=areas[name];
if(!bounds)throw Error('등록된 조사 영역을 선택하세요.');
const response=await fetch('https://api.openstreetmap.org/api/0.6/map.json?bbox='+bounds.join(','),{signal:AbortSignal.timeout(40000),headers:{'User-Agent':'SangilTtara route review'}});
if(!response.ok)throw Error('지도 원본 HTTP '+response.status);
const data=await response.json();
await fs.writeFile(new URL(`../map-source/area-${name}.json`,import.meta.url),JSON.stringify(data));
console.log(JSON.stringify({name,objects:data.elements.length,types:Object.fromEntries(['node','way','relation'].map(type=>[type,data.elements.filter(x=>x.type===type).length]))}));
