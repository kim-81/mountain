import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCourses } from '../scripts/lib/course-audit.mjs';
import { mountains } from '../web/js/data.js';
import { courseCatalog } from '../web/js/catalog.js';
import { mapDatabase } from '../web/js/map-database.js';
import { mapManifest } from '../web/js/map-catalog.js';
import { facilityDatabase } from '../web/js/facility-database.js';
const input = {mountains, courses:courseCatalog, maps:mapDatabase, manifest:mapManifest, facilities:facilityDatabase};

test('서울 8곳의 자료 연결과 기본 경로 미확보 1곳을 구분한다', () => {
  const result = auditCourses(input);
  assert.equal(result.mountainCount, 8);
  assert.equal(result.bundledRouteCount, 7);
  assert.equal(result.dataErrorCount, 0);
  assert.equal(result.allRoutesPrepared, false);
  assert.equal(result.fieldVerified, false);
  assert.deepEqual(result.rows.filter(row=>!row.hasBundledRoute).map(row=>row.id).sort(), ['bonghwasan']);
});

test('잘못된 코스 연결·출처 누락·가짜 직선과 시설 누락을 차단한다', () => {
  const maps = {...mapDatabase, routes:structuredClone(mapDatabase.routes)};
  const route = maps.routes.achasan;
  route.courseId = 'wrong-course'; delete route.license;
  route.segments = [[{lat:37.55,lng:127.08},{lat:37.56,lng:127.08}]];
  const facilities = {...facilityDatabase, mountainIndex:{...facilityDatabase.mountainIndex, achasan:['missing-facility']}};
  const row = auditCourses({...input, maps, facilities}).rows.find(row=>row.id==='achasan');
  assert.equal(row.dataChecksPassed, false);
  for (const text of ['ID 불일치','이용 조건 누락','300m 초과','시설 연결 누락']) assert.ok(row.errors.some(error=>error.includes(text)), text);
});

test('배경지도 밖 경로와 분리된 구간을 완료로 판단하지 않는다', () => {
  const maps = {...mapDatabase, routes:structuredClone(mapDatabase.routes)};
  maps.routes.achasan.segments = [[{lat:35,lng:127},{lat:35.0001,lng:127}], [{lat:35.001,lng:127},{lat:35.002,lng:127}]];
  const row = auditCourses({...input, maps}).rows.find(row=>row.id==='achasan');
  assert.ok(row.errors.some(error=>error.includes('범위를 벗어남')));
  assert.ok(row.errors.some(error=>error.includes('여러 구간')));
});
