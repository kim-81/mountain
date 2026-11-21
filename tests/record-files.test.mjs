import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecordBackup,mergeRecordBackup,makeRecordBackup,recordGPX} from '../web/js/record-files.js';
const mountains=[{id:'achasan'}];
const startedAt=1700000000000;
const record=()=>({id:'test-record-1',userId:'old-user',mountainId:'achasan',startedAt,date:'2023. 11. 15.',km:1.2,minutes:30,complete:true,points:[{lat:37.5,lng:127,time:startedAt,accuracy:5},{lat:37.501,lng:127.001,time:startedAt+10000,accuracy:6}]});

test('새 백업과 0.4 기록 파일을 읽고 사용자 식별·인증·알 수 없는 속성을 복원하지 않는다',()=>{
  const backup=makeRecordBackup([record()]);
  assert.ok(!JSON.stringify(backup).includes('old-user'));
  const records=parseRecordBackup(JSON.stringify(backup),mountains);
  assert.equal(records.length,1); assert.equal(records[0].complete,true);
  const old={schemaVersion:1,records:[{...record(),password:'must-not-restore',routeSegments:[[]]}]};
  assert.equal(parseRecordBackup(JSON.stringify(old),mountains)[0].password,undefined);
  assert.equal(records[0].userId,undefined);
});

test('기존 기록은 보존하고 같은 번호는 건너뛰며 현재 계정에만 추가한다',()=>{
  const current=[record()];
  const incoming=[{...record(),complete:false},{...record(),id:'second-record'}];
  const merged=mergeRecordBackup(current,incoming,'current-user');
  assert.equal(merged.added,1); assert.equal(merged.skipped,1);
  assert.equal(current.length,1); assert.equal(merged.records[0].complete,true);
  assert.equal(merged.records.find(r=>r.id==='second-record').userId,'current-user');
  assert.equal(mergeRecordBackup(merged.records,incoming,'current-user').added,0);
});

test('형식·버전·좌표·순서·거리·기록 번호가 잘못된 백업은 전부 거부한다',()=>{
  for(const mutation of [
    r=>({...r,id:'<script>'}), r=>({...r,mountainId:'unknown'}), r=>({...r,km:-1}),
    r=>({...r,complete:'true'}), r=>({...r,points:[{...r.points[0],lat:100}]}),
    r=>({...r,points:[r.points[1],r.points[0]]}), r=>({...r,startedAt:Date.now()+172800000})
  ]) assert.throws(()=>parseRecordBackup(JSON.stringify({schemaVersion:1,records:[mutation(record())]}),mountains));
  assert.throws(()=>parseRecordBackup('{bad json',mountains));
  assert.throws(()=>parseRecordBackup(JSON.stringify({schemaVersion:99,records:[]}),mountains));
  assert.throws(()=>parseRecordBackup(JSON.stringify({schemaVersion:1,records:[record(),record()]}),mountains));
  assert.throws(()=>parseRecordBackup(' '.repeat(16*1024*1024+1),mountains));
});

test('GPX는 XML 문자를 이스케이프하고 긴 GPS 공백을 별도 구간으로 저장한다',()=>{
  const input=record(); input.points.push({...input.points[1],time:startedAt+300000});
  const xml=recordGPX(input,'산 & <길>');
  assert.ok(xml.includes('산 &amp; &lt;길&gt;'));
  assert.equal((xml.match(/<trkseg>/g)||[]).length,2);
  assert.equal((xml.match(/<trkpt /g)||[]).length,3);
  assert.ok(!xml.includes('old-user'));
  assert.throws(()=>recordGPX({...input,points:[]},'빈 기록'));
});
