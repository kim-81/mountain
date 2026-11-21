import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/database.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/backup-server.mjs', import.meta.url));

test('서버가 열린 상태에서 WAL의 후기·사진을 포함해 독립적으로 열 수 있는 백업을 만든다', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sangil-backup-test-'));
  const source = path.join(root, 'sangil.sqlite');
  const destination = path.join(root, 'private');
  const db = openDatabase(source);
  try {
    db.exec('PRAGMA wal_autocheckpoint=0');
    db.prepare('INSERT INTO users VALUES (?,?,?,?)').run('sample', '검사 계정', 'sample-salt', 'sample-hash');
    const content = JSON.stringify({ text: '검사 후기', photos: ['data:image/png;base64,example'] });
    db.prepare('INSERT INTO reviews VALUES (?,?,?,?)').run('review', 'sample', 'achasan', content);
    await run(process.execPath, [script, destination], {
      env: { ...process.env, SANGIL_DATA_DIR: root, SANGIL_PUBLIC_ORIGIN: '', SANGIL_LISTEN_HOST: '127.0.0.1' }
    });
    const [folder] = await readdir(destination);
    const snapshot = path.join(destination, folder);
    const report = JSON.parse(await readFile(path.join(snapshot, 'verified.json'), 'utf8'));
    assert.deepEqual(report.counts, {users:1, plans:0, responses:0, reviews:1});
    assert.match(report.sha256, /^[a-f0-9]{64}$/);
    const restored = new DatabaseSync(path.join(snapshot, report.file), { readOnly: true });
    try {
      assert.equal(restored.prepare('SELECT content FROM reviews WHERE id=?').get('review').content, content);
    } finally {
      restored.close();
    }
    assert.equal(db.prepare('SELECT count(*) AS count FROM reviews').get().count, 1);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
