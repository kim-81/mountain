import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {prepareServerPackage} from '../scripts/lib/server-package.mjs';
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sangil-deploy-test-'));
  const project=path.join(root,'project');
  for(const directory of ['web','server','scripts','.local-data','.build-tools','android'])await fs.mkdir(path.join(project,directory),{recursive:true});
  for(const file of ['web/index.html','server/api.mjs','scripts/serve-production.mjs','scripts/serve-local.mjs','scripts/backup-server.mjs','.local-data/account.sqlite','.build-tools/settings.json','android/private-key.pem'])await fs.writeFile(path.join(project,file),'test fixture');
  await fs.writeFile(path.join(project,'package.json'),JSON.stringify({name:'sangil-test',version:'1.0.0',scripts:{start:'local-only'}}));
  return {root,project,destination:path.join(root,'payload')};
}
async function cleanup(root){
  const resolved=path.resolve(root),temporary=path.resolve(os.tmpdir());
  if(path.dirname(resolved)!==temporary||!path.basename(resolved).startsWith('sangil-deploy-test-'))throw Error('시험 임시 폴더 범위 확인 실패');
  await fs.rm(resolved,{recursive:true,force:true});
}
test('서버 배포 묶음은 기록·개발 도구·서명 파일을 제외하고 운영 시작 명령을 사용한다',async()=>{
  const f=await fixture();try{
    const result=await prepareServerPackage(f.project,f.destination);
    assert.equal(result.fileCount,6);
    assert.ok(result.files.every(file=>!/local-data|build-tools|android/.test(file.path)));
    const pkg=JSON.parse(await fs.readFile(path.join(f.destination,'package.json'),'utf8'));
    assert.equal(pkg.scripts.start,'node scripts/serve-production.mjs');
    assert.equal(pkg.engines.node,'24.x');
    await assert.rejects(prepareServerPackage(f.project,f.destination),/EEXIST/);
  }finally{await cleanup(f.root);}
});
test('공개 파일 폴더에 섞인 비공개 파일은 업로드 전에 차단한다',async()=>{
  const f=await fixture();try{
    await fs.writeFile(path.join(f.project,'web','.env'),'EXAMPLE_TOKEN=not-a-real-secret');
    await assert.rejects(prepareServerPackage(f.project,f.destination),/비공개/);
  }finally{await cleanup(f.root);}
});

test('실제 배포 묶음은 운영 모드로 시작하고 재시작 후 계정·일정을 보존한다',{timeout:20000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sangil-deploy-test-'));
  const payload=path.join(root,'payload'),data=path.join(root,'private-data');
  // 시스템 임시 포트 범위 대신 HTTP 클라이언트가 지원하는 대역에서 빈 포트를 찾습니다.
  let port;
  for(let attempt=0;attempt<40;attempt++){
    const reserve=net.createServer();
    const available=await new Promise(resolve=>{reserve.once('error',()=>resolve(false));reserve.listen(11020+attempt,'127.0.0.1',()=>resolve(true));});
    if(available){port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));break;}
  }
  if(!port)throw Error('HTTP 검사에 사용할 수 있는 임시 포트를 확보하지 못했습니다.');
  let child;
  async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
  async function start(){
    child=spawn(process.execPath,['scripts/serve-production.mjs'],{cwd:payload,windowsHide:true,
      env:{...process.env,RAILWAY_PROJECT_ID:'',SANGIL_PORT:String(port),SANGIL_LISTEN_HOST:'127.0.0.1',SANGIL_DATA_DIR:data,SANGIL_PUBLIC_ORIGIN:'https://deployment.example'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('배포 묶음 시작 지연: '+output)),8000);
      child.stdout.on('data',bytes=>{output+=bytes.toString();if(output.includes('산길따라:')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',bytes=>{output+=bytes.toString();});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('배포 묶음 시작 실패: '+output));});
    });
  }
  const origin=`http://127.0.0.1:${port}`;
  try{
    const report=await prepareServerPackage(fileURLToPath(new URL('../',import.meta.url)),payload);
    await start();
    const health=await(await fetch(origin+'/api/health')).json();
    assert.equal(health.version,report.version);assert.equal(health.mode,'https-server');
    assert.equal((await fetch(origin+'/')).status,200);
    const headers={'Content-Type':'application/json',Origin:'https://deployment.example','X-Sangil-Request':'1'};
    const registered=await fetch(origin+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({nickname:'배포검사계정',password:'example-deploy-password'})});
    assert.equal(registered.status,200);
    const cookie=registered.headers.get('set-cookie').split(';')[0];
    const created=await fetch(origin+'/api/plans',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({mountainId:'achasan',title:'배포 묶음 검사',date:'2030-01-02',time:'09:00',place:'예시 출발점'})});
    assert.equal(created.status,201);
    await stop();await start();
    const response=await fetch(origin+'/api/plans',{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.ok(result.plans.some(plan=>plan.title==='배포 묶음 검사'));
  }finally{await stop();await cleanup(root);}
});
