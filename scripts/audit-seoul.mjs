import fs from 'node:fs/promises';
import { mountains } from '../web/js/data.js';
import { courseCatalog } from '../web/js/catalog.js';
import { mapDatabase } from '../web/js/map-database.js';
import { mapManifest } from '../web/js/map-catalog.js';
import { facilityDatabase } from '../web/js/facility-database.js';
import { auditCourses } from './lib/course-audit.mjs';

const report = { checkedAt: new Date().toISOString(), ...auditCourses({mountains, courses:courseCatalog, maps:mapDatabase, manifest:mapManifest, facilities:facilityDatabase}) };
const output = new URL('../outputs/', import.meta.url);
await fs.mkdir(output, {recursive:true});
await fs.writeFile(new URL('seoul-readiness.json', output), JSON.stringify(report, null, 2));
console.table(report.rows.map(row => ({산:row.name, 기본경로:row.hasBundledRoute?'포함':'미확보', 좌표:row.points, 시설:row.facilityCount, 오류:row.errors.join(' / ')||'없음'})));
console.log(`기본 경로 ${report.bundledRouteCount}/${report.mountainCount} · 자료 연결 오류 ${report.dataErrorCount} · 현장 검증 미완료`);
if (report.dataErrorCount || (process.argv.includes('--require-all') && !report.allRoutesPrepared)) process.exitCode = 1;
