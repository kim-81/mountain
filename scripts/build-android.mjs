import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const project = fileURLToPath(new URL('../', import.meta.url));
const settings = JSON.parse(await fs.readFile(path.join(project, '.build-tools', 'build-settings.json'), 'utf8'));
const child = spawn('cmd.exe', ['/d', '/c', settings.gradle, '--no-daemon', '--console=plain', 'assembleDebug'], {
  cwd: path.join(project, 'android'), env: { ...process.env, ...settings.environment }, windowsHide: true, stdio: 'inherit'
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code || 0; });
