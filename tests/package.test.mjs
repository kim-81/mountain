import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('설치 안내 버전과 Android·iOS 소스 버전이 일치한다',async()=>{
  const {version}=JSON.parse(await fs.readFile(new URL('package.json',root),'utf8'));
  const android=await fs.readFile(new URL('android/app/build.gradle.kts',root),'utf8');
  const ios=await fs.readFile(new URL('ios/SeoulTrail/Info.plist',root),'utf8');
  assert.equal(android.match(/versionName = "([^"]+)"/)?.[1],version);
  assert.equal(ios.match(/CFBundleShortVersionString<\/key><string>([^<]+)/)?.[1],version);
  assert.equal(ios.match(/CFBundleVersion<\/key><string>([^<]+)/)?.[1],android.match(/versionCode = (\d+)/)?.[1]);
});
test('오프라인 캐시 목록의 모든 파일이 실제로 존재한다',async()=>{
  const source=await fs.readFile(new URL('web/sw.js',root),'utf8');
  const list=source.match(/const FILES=(\[[^;]+\]);/)[1].replace(/'/g,'"');
  for(const file of JSON.parse(list))assert.ok((await fs.stat(new URL('web/'+(file==='./'?'index.html':file),root))).isFile());
});
test('두 네이티브 앱에 외부 번들러 없이 생성한 스크립트가 포함된다',async()=>{
  for(const folder of ['android/app/src/main/assets/web/','ios/SeoulTrail/web/']){
    const html=await fs.readFile(new URL(folder+'index.html',root),'utf8');
    assert.ok(html.includes('src="js/native-bundle.js"'));
    const script=await fs.readFile(new URL(folder+'js/native-bundle.js',root),'utf8');
    assert.doesNotThrow(()=>new vm.Script(script));
  }
});
test('예시 데이터와 디자인이 Android/iOS에 동일하게 복사되어 있다',async()=>{
  for(const file of ['js/data.js','styles.css','assets/mark.svg','assets/landscape.svg','server-config.json','js/server-config.js']){
    const expected=await fs.readFile(new URL('web/'+file,root),'utf8');
    for(const folder of ['android/app/src/main/assets/web/','ios/SeoulTrail/web/'])assert.equal(await fs.readFile(new URL(folder+file,root),'utf8'),expected);
  }
});
test('네이티브 번들 초기화와 기록 복구는 자동 GPS 수집 없이 동작한다',async()=>{
  const source=await fs.readFile(new URL('ios/SeoulTrail/web/js/native-bundle.js',root),'utf8');
  for (const recover of [false,'resume','finish']) {
  const nodes=new Map();
  const handlers=new Map(), calls=[];
  let ready=false;
  const activeSession=recover?{id:'recovery-test',userId:'example-user',mountainId:'achasan',startedAt:Date.now()-30000,points:[{lat:37,lng:127,accuracy:5,time:Date.now()-20000}],km:0,routeSegments:[],alertsEnabled:false}:null;
  const context={
    console, TextEncoder,TextDecoder, URL, btoa,atob,
    navigator:{onLine:true}, location:{hash:recover?'#map':'#home',protocol:'file:',href:'file:///web/index.html'},
    localStorage:{getItem:()=>JSON.stringify({user:{id:'example-user',name:'복구검증계정'},activeSession}),setItem:()=>{}},
    setInterval:()=>0, clearInterval:()=>{}, setTimeout:()=>0, clearTimeout:()=>{},
    AndroidTrail:{postMessage:message=>{const value=JSON.parse(message);calls.push(value);if(value.action==='ready')ready=true;}},
    document:{
      addEventListener:(event,handler)=>handlers.set(event,handler), visibilityState:'visible',
      querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',open:false,showModal(){this.open=true;},classList:{toggle:()=>{},add:()=>{},remove:()=>{}},addEventListener:()=>{}});return nodes.get(selector);}
    },
    addEventListener:()=>{},scrollTo:()=>{}
  };
  context.window=context;
  vm.runInNewContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ready,true);
  assert.equal(calls.some(call=>call.action==='start'),false);
  if (!recover) {
    assert.ok(nodes.get('#main').innerHTML.includes('어떤 산을 걸을까요'));
    assert.ok(nodes.get('#mountain-grid').innerHTML.includes('북한산'));
    await handlers.get('click')({target:{closest:()=>({disabled:false,dataset:{action:'export'}})}});
    const exported = calls.find(call => call.action === 'export');
    assert.equal(exported.filename, 'sangil-ttara-records.json');
    assert.deepEqual(JSON.parse(exported.content).records, []);
  } else if (recover === 'resume') {
    assert.ok(nodes.get('#main').innerHTML.includes('기록 이어가기'));
    await handlers.get('click')({target:{closest:()=>({disabled:false,dataset:{action:'resume-session'}})}});
    assert.equal(calls.find(call=>call.action==='start').resume,true);
    assert.ok(nodes.get('#main').innerHTML.includes('산행 종료'));
  } else {
    await handlers.get('click')({target:{closest:()=>({disabled:false,dataset:{action:'recover-finish'}})}});
    assert.equal(calls.find(call=>call.action==='replay-gps').sessionId,'recovery-test');
    assert.equal(calls.some(call=>call.action==='start'),false);
    const fix={lat:37.0004,lng:127,accuracy:5,time:Date.now()-10000};
    context.onTrailRecovery([fix,fix],'unrelated-session');
    assert.equal(nodes.get('#dialog')?.open??false,false);
    context.onTrailRecovery([fix,fix],'recovery-test');
    assert.ok(nodes.get('#dialog-body').innerHTML.includes('GPS 2개 지점'));
  }
  }
});

test('기록 복원은 사용자 확인 뒤 저장하며 용량 부족 시 기존 기록으로 되돌린다',async()=>{
  const source=await fs.readFile(new URL('android/app/src/main/assets/web/js/native-bundle.js',root),'utf8');
  const fixture=await fs.readFile(new URL('tests/fixtures/기능검사용-가상기록.json',root),'utf8');
  for(const storageFails of [false,true]) {
    const original={id:'original-record',mountainId:'achasan',startedAt:1600000000000,date:'예시 기존 기록',km:0,minutes:1,complete:false,points:[]};
    const nodes=new Map(),handlers=new Map(),calls=[];
    const context={
      console,TextEncoder,TextDecoder,URL,btoa,atob,
      FormData:class { *[Symbol.iterator]() {} },
      navigator:{onLine:true},location:{hash:'#my',protocol:'file:',href:'file:///web/index.html#my'},
      localStorage:{getItem:()=>JSON.stringify({user:{id:'local-test-user',name:'복원검증'},records:[original]}),setItem:()=>{if(storageFails)throw Error('QuotaExceededError');}},
      setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,clearTimeout:()=>{},
      AndroidTrail:{postMessage:message=>calls.push(JSON.parse(message))},
      document:{addEventListener:(name,handler)=>handlers.set(name,handler),visibilityState:'visible',querySelector:selector=>{
        if(!nodes.has(selector)){const node={innerHTML:'',textContent:'',open:false,addEventListener(){},classList:{toggle(){},add(){},remove(){}},showModal(){this.open=true;},close(){this.open=false;}};nodes.set(selector,node);}return nodes.get(selector);
      }},addEventListener(){},scrollTo(){}
    };
    context.window=context;vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));
    const click=action=>handlers.get('click')({target:{closest:()=>({disabled:false,dataset:{action}})}});
    await click('import-records');
    const submit={disabled:false,isConnected:true},error={textContent:''};
    const form=id=>({id,querySelector:selector=>selector==='button.primary'?submit:selector==='input[type="file"]'?{files:[{size:fixture.length,text:async()=>fixture}]}:error});
    await handlers.get('submit')({preventDefault(){},target:form('backup-file-form')});
    assert.ok(nodes.get('#dialog-body').innerHTML.includes('1개 추가'));
    await click('export');
    assert.equal(JSON.parse(calls.filter(c=>c.action==='export').at(-1).content).records.length,1);
    await handlers.get('submit')({preventDefault(){},target:form('restore-records-form')});
    await click('export');
    const records=JSON.parse(calls.filter(c=>c.action==='export').at(-1).content).records;
    assert.equal(records.length,storageFails?1:2);
    assert.equal(records.find(r=>r.id==='original-record').date,'예시 기존 기록');
    if(storageFails)assert.ok(error.textContent.includes('기존 기록은 유지'));
  }
});
