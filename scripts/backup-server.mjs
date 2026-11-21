import { backup, DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverConfig } from '../server/config.mjs';

async function snapshot(source, backupRoot) {
  if (!(await stat(source)).isFile()) throw Error('서버 데이터베이스 파일을 찾을 수 없습니다.');
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const directory = await realpath(backupRoot);
  const webRoot = await realpath(fileURLToPath(new URL('../web/', import.meta.url)));
  const relative = path.relative(webRoot, directory);
  if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw Error('웹에서 제공하는 폴더 바깥에 백업을 보관해 주세요.');
  }
  const folder = await mkdtemp(path.join(directory, 'sangil-'));
  const target = path.join(folder, 'sangil.sqlite');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, target);
  } finally {
    db.close();
  }

  const copy = new DatabaseSync(target, { readOnly: true });
  let counts;
  try {
    const integrity = copy.prepare('PRAGMA quick_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok'
      || copy.prepare('PRAGMA foreign_key_check').all().length) {
      throw Error('백업의 SQLite 무결성 확인에 실패했습니다.');
    }
    counts = Object.fromEntries(['users', 'plans', 'responses', 'reviews'].map(table =>
      [table, copy.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));
  } finally {
    copy.close();
  }

  const digest = createHash('sha256');
  for await (const chunk of createReadStream(target)) digest.update(chunk);
  const report = {
    file: 'sangil.sqlite', verifiedAt: new Date().toISOString(),
    bytes: (await stat(target)).size, sha256: digest.digest('hex'), counts
  };
  await writeFile(path.join(folder, 'verified.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return folder;
}

try {
  const [backupRoot, ...extra] = process.argv.slice(2);
  if (!backupRoot || extra.length) throw Error('사용법: node scripts/backup-server.mjs <백업을 보관할 비공개 폴더>');
  const source = path.join(serverConfig().dataDirectory, 'sangil.sqlite');
  const folder = await snapshot(source, path.resolve(backupRoot));
  console.log('백업과 무결성 확인 완료: ' + folder);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
