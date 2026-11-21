// 공식 공개 페이지의 제목·날짜만 읽습니다. 페이지의 코드와 임의 주소는 사용하지 않습니다.
export const noticeSources={
  knps:{name:'국립공원공단 탐방 통제',url:'https://www.knps.or.kr/front/portal/safe/acsCtrList.do?menuNo=8000340'},
  seoultrail:{name:'서울둘레길 공지',url:'https://gil.seoul.go.kr/bbsctt/list.do?key=2304100032'},
  citywall:{name:'서울 한양도성 공지',url:'https://seoulcitywall.seoul.go.kr/board/B0001.do?bcaId=0&pageIndex=1'}
};
export function noticeSourceFor(id){return ['inwangsan','bukhaksan'].includes(id)?'citywall':id==='bukhansan'?'knps':'seoultrail';}
function plain(text){return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(?:#(\d+)|#x([a-f\d]+)|([a-z]+));/gi,(all,n,x,name)=>{if(n||x){const code=parseInt(n||x,n?10:16);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[name.toLowerCase()]||all;}).replace(/\s+/g,' ').trim().slice(0,300);}
export function parseOfficialNotices(sourceId,html,fetchedAt=Date.now()){
  if(!Object.hasOwn(noticeSources,sourceId)||typeof html!=='string'||html.length>2*1024*1024||!Number.isFinite(fetchedAt))throw Error('공식 공지 응답을 확인할 수 없습니다.');
  const source=noticeSources[sourceId],items=[];
  if(sourceId==='knps'){
    for(const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[]){
      const id=row.match(/rstId=(0019|0020)\b/)?.[1],cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>plain(m[1]));
      if(!id||cells.length!==4||cells[0]!=='북한산'||!['정상','부분통제','전면통제'].includes(cells[2])||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cells[3]))continue;
      items.push({id,title:cells[1],status:cells[2],date:cells[3],url:'https://www.knps.or.kr/front/portal/safe/acsCtrDtl.do?menuNo=8000340&rstId='+id});
    }
  }else if(sourceId==='seoultrail'){
    for(const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[]){
      const link=row.match(/<a\b[^>]*href="javascript:goView\('(\d{10})'\);"[^>]*>([\s\S]*?)<\/a>/i),date=row.match(/<td\b[^>]*class="data"[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/i)?.[1];
      if(link&&date&&plain(link[2]))items.push({id:link[1],title:plain(link[2]),date,url:'https://gil.seoul.go.kr/bbsctt/view.do?key=2304100032&sc_bbscttSn='+link[1]});
    }
  }else{
    const addCityNotice = (id, title, date) => {
      const cleaned = title ? plain(title) : '';
      if (cleaned && date) items.push({id,title:cleaned,date,url:'https://seoulcitywall.seoul.go.kr/board/B0001.do?act=read&bpoId='+id+'&bcaId=0&pageIndex=1'});
    };
    for (const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const link = row.match(/<a\b[^>]*href="\?act=read&amp;bpoId=(\d{1,9})&amp;bcaId=0&amp;pageIndex=1"[^>]*>([\s\S]*?)<\/a>/i);
      const date = row.match(/<td\b[^>]*class="date"[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/i)?.[1];
      if (link) addCityNotice(link[1], link[2], date);
    }
    for(const link of html.matchAll(/<a\b[^>]*href="\?act=read&amp;bpoId=(\d{1,9})&amp;bcaId=0&amp;pageIndex=1"[^>]*>([\s\S]*?)<\/a>/gi)){
      const title=link[2].match(/<strong\b[^>]*class="title"[^>]*>([\s\S]*?)<\/strong>/i)?.[1],date=link[2].match(/<i\b[^>]*class="date"[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/i>/i)?.[1];
      addCityNotice(link[1], title, date);
    }
  }
  if(!items.length)throw Error('공식 페이지의 표시 형식이 바뀌었거나 공지 자료가 없습니다. 원문을 확인해 주세요.');
  return {sourceId,source:source.name,url:source.url,fetchedAt,items:[...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,24)};
}
export function noticeAge(data,now=Date.now()){const age=now-data?.fetchedAt;return !Number.isFinite(age)||age< -60000||age>30*60000?'expired':age>5*60000?'stale':'fresh';}

export function selectNotices(data, mountain) {
  if (data.sourceId === 'knps') return data.items.slice(0, 2);
  const number = data.sourceId === 'seoultrail' && mountain.courseId?.match(/^seoul-dulle-(\d+)$/)?.[1];
  const byNumber = number ? new RegExp(`(?:^|[^\\d])0?${number}\\s*코스`) : null;
  const names = [mountain.name];
  if (mountain.id === 'bukhaksan') names.push('백악');
  const relevant = [];
  const other = [];
  for (const item of data.items) {
    const safety = /통제|우회|폐쇄|출입\s*(?:제한|금지)|이용\s*불가/.test(item.title);
    const matches = byNumber?.test(item.title) || names.some(name => name && item.title.includes(name));
    (safety && matches ? relevant : other).push(item);
  }
  return [...relevant, ...other].slice(0, 6);
}
