import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {openDatabase} from '../server/database.mjs';
import {createAPI} from '../server/api.mjs';
import {validateServerOrigin} from '../scripts/configure-server.mjs';
import {sharedPlanIdFromLink} from '../web/js/share-links.js';
import {productionEnvironment} from '../scripts/serve-production.mjs';

test('휴대폰 세션으로 두 계정의 일정·후기를 공유하고 쿠키·위조 출처·로그아웃을 구분한다',async()=>{
  const db=openDatabase(':memory:');const handle=createAPI(db,{publicOrigin:'https://trail.example.com'});
  const server=http.createServer(handle);server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,token='',headers={}) {
    const response=await fetch(origin+'/api/'+path,{method,headers:{'Content-Type':'application/json','X-Sangil-Request':'1','X-Sangil-Native':'1',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),token:response.headers.get('x-sangil-token'),cookie:response.headers.get('set-cookie')};
  }
  try {
    const a=await call('auth/register','POST',{nickname:'휴대폰예시A',password:'test-native-a'});
    const b=await call('auth/register','POST',{nickname:'휴대폰예시B',password:'test-native-b'});
    assert.equal(a.status,200);assert.match(a.token,/^[a-f0-9]{64}$/);assert.equal(a.cookie,null);
    assert.ok(!JSON.stringify(a.data).includes(a.token));
    assert.equal((await call('auth/session','GET',undefined,a.token)).data.user.name,'휴대폰예시A');
    assert.equal((await call('plans','GET',undefined,'',{'Cookie':'sangil_session='+a.token})).status,401);
    const input={mountainId:'achasan',title:'앱 연동 검사',date:'2026-11-29',time:'09:00',place:'예시 장소'};
    assert.equal((await call('plans','POST',input,a.token,{Origin:'https://attacker.invalid'})).status,403);
    const plan=await call('plans','POST',input,a.token);assert.equal(plan.status,201);
    const id=plan.data.plan.id;
    await call(`plans/${id}/response`,'POST',{status:'yes'},b.token);
    assert.equal((await call('plans','GET',undefined,b.token)).data.plans[0].responses.length,2);
    assert.equal((await call(`plans/${id}`,'DELETE',{},b.token)).status,403);
    const review=await call('reviews','POST',{mountainId:'achasan',text:'연동 예시 후기',rating:4},a.token);assert.equal(review.status,200);
    assert.equal((await call('reviews')).data.reviews[0].text,'연동 예시 후기');
    const changed=await call('account/password','POST',{password:'test-native-a',newPassword:'test-native-new'},a.token);
    assert.equal(changed.status,200);assert.match(changed.token,/^[a-f0-9]{64}$/);
    assert.equal((await call('auth/session','GET',undefined,a.token)).token,'clear');
    assert.equal((await call('auth/session','GET',undefined,changed.token)).data.user.name,'휴대폰예시A');
    assert.equal((await call('auth/logout','POST',{},changed.token)).token,'clear');
    assert.equal((await call('plans','GET',undefined,changed.token)).status,401);
    assert.equal((await call('auth/session','GET',undefined,b.token)).data.user.name,'휴대폰예시B');
  } finally { server.close();server.closeAllConnections();await once(server,'close');db.close(); }
});

test('앱의 지정 서버는 HTTPS 원점만 허용한다',()=>{
  assert.equal(validateServerOrigin(''),'');assert.equal(validateServerOrigin('https://trail.example.com'),'https://trail.example.com');
  for(const value of ['http://trail.example.com','https://trail.example.com/','https://trail.example.com/api','https://user:pass@trail.example.com','https://trail.example.com?secret=1'])assert.throws(()=>validateServerOrigin(value));
});

test('운영 서버는 HTTPS·Node 버전·지속 저장 볼륨이 준비되지 않으면 시작하지 않는다',()=>{
  const env={SANGIL_PUBLIC_ORIGIN:'https://trail.example.com',RAILWAY_PROJECT_ID:'example-project',RAILWAY_VOLUME_MOUNT_PATH:'/data',PORT:'10000'};
  assert.equal(productionEnvironment(env).SANGIL_DATA_DIR,'/data');
  assert.equal(productionEnvironment(env).SANGIL_LISTEN_HOST,'0.0.0.0');
  assert.throws(()=>productionEnvironment({...env,RAILWAY_VOLUME_MOUNT_PATH:''}));
  assert.throws(()=>productionEnvironment({...env,SANGIL_DATA_DIR:'/outside-data'}));
  assert.throws(()=>productionEnvironment({...env,SANGIL_PUBLIC_ORIGIN:''}));
  assert.throws(()=>productionEnvironment(env,'22.0.0'));
});

test('공유 일정 링크는 같은 서버의 유효한 번호만 가져오고 기존 코드 입력도 유지한다',()=>{
  const id='a'.repeat(32);
  assert.equal(sharedPlanIdFromLink(`https://trail.example.com/#shared/${id}`,'https://trail.example.com'),id);
  assert.equal(sharedPlanIdFromLink('기존-기기-일정-코드','https://trail.example.com'),null);
  assert.throws(()=>sharedPlanIdFromLink(`https://attacker.invalid/#shared/${id}`,'https://trail.example.com'));
  assert.throws(()=>sharedPlanIdFromLink('https://trail.example.com/#shared/invalid','https://trail.example.com'));
});

test('웹 화면의 네이티브 통신은 요청을 구분하고 토큰 없이 결과·오류·시간 초과를 처리한다',async()=>{
  let source=await fs.readFile(new URL('../web/js/api.js',import.meta.url),'utf8');
  source=source.replace("import {serverOrigin} from './server-config.js';","const serverOrigin = 'https://trail.example.com';").replace(/^export /gm,'');
  const sent=[];const timers=new Map();let timerId=0;
  const context={AndroidTrail:{postMessage:value=>sent.push(JSON.parse(value))},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),console};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.testingAPI={apiRequest,connectBackend,backend};',context);
  const api=context.testingAPI;
  const first=api.apiRequest('plans');const second=api.apiRequest('reviews');
  assert.equal(sent.length,2);assert.ok(!JSON.stringify(sent).includes('Bearer'));
  context.onTrailAPI({requestId:sent[1].requestId,status:200,body:{reviews:[]}});
  context.onTrailAPI({requestId:sent[0].requestId,status:200,body:{plans:[]}});
  assert.equal((await second).reviews.length,0);assert.equal((await first).plans.length,0);
  const denied=api.apiRequest('plans');context.onTrailAPI({requestId:sent.at(-1).requestId,status:401,body:{error:'로그인 필요'}});
  await assert.rejects(denied,e=>e.status===401);
  const late=api.apiRequest('plans');timers.values().next().value();await assert.rejects(late,/응답이 늦어/);
  context.onTrailAPI({requestId:sent.at(-1).requestId,status:200,body:{plans:[]}});
  await assert.rejects(api.apiRequest('https://untrusted.invalid'),/지원하지 않는/);
});
