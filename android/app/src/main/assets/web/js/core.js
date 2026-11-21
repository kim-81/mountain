export function escapeHTML(value='') { return String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function distanceKm(a,b) {
  const r=Math.PI/180, dlat=(b.lat-a.lat)*r, dlng=(b.lng-a.lng)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function recommend(items, profile, favorites=[], records=[]) {
  const desired=Math.min(Number(profile.experience),Number(profile.fitness));
  return [...items].map(m=>{
    let score=100-Math.abs(m.level-desired)*22-Math.max(0,m.minutes-Number(profile.minutes))*.45;
    if(profile.transport===m.transport) score+=5;
    if(favorites.includes(m.id)) score+=8;
    const completed=records.filter(r=>r.complete);
    if(completed.some(r=>r.mountainId===m.id)) score+=3;
    return {...m,score};
  }).sort((a,b)=>b.score-a.score);
}
export function encodePlan(plan) {
  const {id,mountainId,title,date,time,place}=plan;
  const bytes=new TextEncoder().encode(JSON.stringify({id,mountainId,title,date,time,place}));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodePlan(encoded, mountains) {
  if(!encoded || encoded.length>6000) throw Error('잘못된 공유 링크입니다.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
  if(typeof value.id!=='string'||value.id.length>80||!mountains.some(m=>m.id===value.mountainId)||typeof value.title!=='string'||!value.title.trim()||value.title.length>80||!validSchedule(value.date,value.time)||typeof value.place!=='string'||!value.place.trim()||value.place.length>120) throw Error('일정 형식을 확인해 주세요.');
  return {id:value.id,mountainId:value.mountainId,title:value.title,date:value.date,time:value.time,place:value.place,responses:[]};
}
export function formatTime(minutes) { const n=Math.round(minutes); return `${Math.floor(n/60)?Math.floor(n/60)+'시간 ':''}${n%60?n%60+'분':''}`.trim() || '0분'; }
export function validFix(fix) {return fix && Number.isFinite(fix.lat)&&Number.isFinite(fix.lng)&&Math.abs(fix.lat)<=90&&Math.abs(fix.lng)<=180&&Number.isFinite(fix.accuracy)&&fix.accuracy>=0&&fix.accuracy<=80;}
export function validSchedule(date, time) {
  if (typeof date !== 'string' || typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
