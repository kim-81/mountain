// 앱 화면·서울 8개 산 주변 OSM 배경자료를 캐시합니다. 실시간 정보·등고선은 포함하지 않습니다.
const CACHE='seoul-trail-v0.8.7';
const FILES=['./','index.html','styles.css','enhancements.css','manifest.webmanifest','assets/mark.svg','assets/landscape.svg','js/app.js','js/core.js','js/store.js','js/data.js','js/catalog.js','js/navigation.js','js/route-map.js','js/api.js','js/server-config.js','js/review-client.js','js/photo-files.js','server-config.json','js/share-links.js','js/facility-database.js','js/facilities.js','js/course-support.js','map-data/seoul-facilities.json','js/weather-data.js','js/weather.js','js/official-notices-data.js','js/official-notices.js','js/record-files.js','map.css','js/map-database.js','js/map-catalog.js','js/map-geometry.js','js/offline-map.js','map-data/seoul-osm.json','map-data/README.md'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('seoul-trail-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
  // 접속 가능하면 최신 화면을 받고, 연결이 없으면 저장한 정적 파일로 동작합니다.
  event.respondWith(fetch(event.request).then(async response=>{
    if(response.ok && FILES.some(file=>new URL(file,self.registration.scope).pathname===url.pathname)){
      const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());
    }
    return response;
  }).catch(async()=>await caches.match(event.request,{ignoreSearch:true})||new Response('오프라인으로 저장되지 않은 파일입니다.',{status:503})));
});
self.addEventListener('message',event=>{if(event.data?.action==='cache-course')event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));});
