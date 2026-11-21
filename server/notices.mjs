import {noticeSources,parseOfficialNotices,noticeAge} from '../web/js/official-notices-data.js';
export function createNoticeService({fetcher=fetch,now=Date.now}={}){
  const cache=new Map(),pending=new Map();
  return async function(sourceId){
    if(!Object.hasOwn(noticeSources,sourceId)){const error=Error('지원하지 않는 공지 출처입니다.');error.status=400;throw error;}
    const old=cache.get(sourceId);if(noticeAge(old,now())==='fresh')return old;
    if(pending.has(sourceId))return pending.get(sourceId);
    const work=(async()=>{try{
      const response=await fetcher(noticeSources[sourceId].url,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{Accept:'text/html','User-Agent':'SangilTtara/0.8 public-notices'}});
      if(!response.ok)throw Error('공식 공지 서버에 연결하지 못했습니다.');
      let size=0;const parts=[];for await(const part of response.body){size+=part.byteLength;if(size>2*1024*1024)throw Error('공식 공지 응답이 너무 큽니다.');parts.push(part);}
      const data=parseOfficialNotices(sourceId,Buffer.concat(parts).toString('utf8'),now());cache.set(sourceId,data);return data;
    }catch(error){if(noticeAge(old,now())!=='expired')return {...old,stale:true,error:'재조회에 실패했습니다. 원문의 현재 상태를 확인해 주세요.'};throw error;}finally{pending.delete(sourceId);}})();
    pending.set(sourceId,work);return work;
  };
}
