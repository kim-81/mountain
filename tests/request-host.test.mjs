import test from 'node:test';
import assert from 'node:assert/strict';
import {requestHostAllowed} from '../server/request-host.mjs';
test('Railway 상태 검사 Host는 운영 상태 GET에만 허용한다',()=>{
  const config = {publicOrigin:'https://trail.example.com'};
  const request = {headers:{host:'healthcheck.railway.app'},socket:{localPort:8080},method:'GET',url:'/api/health'};
  assert.equal(requestHostAllowed(request,config,true),true);
  assert.equal(requestHostAllowed(request,config,false),false);
  assert.equal(requestHostAllowed(request,{publicOrigin:''},true),false);
  for (const url of ['/','/api/plans','/api/health?x=1']) assert.equal(requestHostAllowed({...request,url},config,true),false);
  assert.equal(requestHostAllowed({...request,method:'POST'},config,true),false);
  assert.equal(requestHostAllowed({...request,headers:{host:'evil.example'}},config,true),false);
  assert.equal(requestHostAllowed({...request,url:'/',headers:{host:'trail.example.com'}},config,true),true);
});
