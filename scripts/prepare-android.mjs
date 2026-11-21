// 사용자 SDK 약관 동의 후에만 실행합니다. 도구와 캐시는 프로젝트 안에 준비합니다.
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--sdk-license-approved')) throw Error('Google Android SDK 약관 동의를 확인한 후 --sdk-license-approved 옵션으로 실행하세요.');
const project = fileURLToPath(new URL('../', import.meta.url));
const toolsRoot = path.join(project, '.build-tools');
const downloads = path.join(toolsRoot, 'downloads');
const logs = path.join(toolsRoot, 'logs');
const sdk = path.join(toolsRoot, 'sdk');
for (const folder of [downloads, logs, sdk]) await fs.mkdir(folder, { recursive: true });
const planFile = new URL('../docs/android-build-plan.json', import.meta.url);
const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
plan.status = 'user-approved-sdk-license';
plan.approval = { date: '2026-11-05', answer: '약관에 동의하고 빌드 진행', scope: 'JDK 17·Android SDK 준비, 해당 SDK 약관 동의 및 Android 디버그 APK 빌드' };
await fs.writeFile(planFile, JSON.stringify(plan, null, 2));

function checkedPath(file) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(toolsRoot) + path.sep)) throw Error('도구 폴더 밖 경로는 사용할 수 없습니다.');
  return resolved;
}
async function fileHash(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function download(label, url, expected, algorithm) {
  const file = checkedPath(path.join(downloads, path.basename(new URL(url).pathname)));
  try { if (await fileHash(file, algorithm) === expected.toLowerCase()) { console.log(label + ': 검증된 캐시 사용'); return file; } } catch {}
  console.log(label + ': 공식 배포본 다운로드 시작');
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw Error(label + ' 다운로드 HTTP ' + response.status);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0, lastPercent = -1;
  const stream = Readable.fromWeb(response.body);
  stream.on('data', chunk => {
    received += chunk.length;
    const percent = total ? Math.floor(received / total * 5) * 20 : 0;
    if (percent > lastPercent) { console.log(label + ': ' + percent + '%'); lastPercent = percent; }
  });
  await pipeline(stream, createWriteStream(file));
  if (await fileHash(file, algorithm) !== expected.toLowerCase()) throw Error(label + ' 공식 체크섬과 파일이 일치하지 않습니다.');
  console.log(label + ': 체크섬 확인 완료');
  return file;
}
async function command(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, ...options });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error(executable + ' 종료 코드 ' + code)));
  });
}
async function extract(zip, destination) {
  checkedPath(zip); checkedPath(destination);
  await fs.mkdir(destination, { recursive: true });
  // Windows 기본 tar는 ZIP도 처리하며 PowerShell 스크립트 모듈 로딩이 필요 없습니다.
  await command('tar.exe', ['-xf', zip, '-C', destination], { stdio: 'inherit' });
}

const cmdline = plan.packages.find(p => p.package === 'cmdline-tools;12.0');
const gradleChecksumResponse = await fetch('https://services.gradle.org/distributions/gradle-8.9-bin.zip.sha256');
if (!gradleChecksumResponse.ok) throw Error('Gradle 체크섬을 확인하지 못했습니다.');
const gradleSHA256 = (await gradleChecksumResponse.text()).trim();
if (!/^[a-f0-9]{64}$/i.test(gradleSHA256)) throw Error('Gradle 체크섬 형식이 올바르지 않습니다.');
const result = await Promise.allSettled([
  download('JDK 17', plan.jdk.url, plan.jdk.sha256, 'sha256'),
  download('Android 명령행 도구', cmdline.url, cmdline.checksum, 'sha1'),
  download('Gradle 8.9', 'https://services.gradle.org/distributions/gradle-8.9-bin.zip', gradleSHA256, 'sha256')
]);
for (const item of result) if (item.status === 'rejected') throw item.reason;
console.log('공식 도구 압축 해제 중');
const jdkFolder = path.join(toolsRoot, 'jdk');
const cmdlineFolder = path.join(toolsRoot, 'sdk-bootstrap');
const gradleFolder = path.join(toolsRoot, 'gradle');
await extract(result[0].value, jdkFolder);
await extract(result[1].value, cmdlineFolder);
await extract(result[2].value, gradleFolder);
const jdkName = (await fs.readdir(jdkFolder, { withFileTypes: true })).find(entry => entry.isDirectory() && entry.name.startsWith('jdk-'))?.name;
if (!jdkName) throw Error('압축 해제한 JDK를 찾지 못했습니다.');
const javaRoot = path.join(jdkFolder, jdkName);
const sdkmanager = path.join(cmdlineFolder, 'cmdline-tools', 'bin', 'sdkmanager.bat');
const gradle = path.join(gradleFolder, 'gradle-8.9', 'bin', 'gradle.bat');
const environment = {
  ...process.env, JAVA_HOME: javaRoot, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk,
  ANDROID_USER_HOME: path.join(toolsRoot, 'android-user'), GRADLE_USER_HOME: path.join(toolsRoot, 'gradle-cache')
};
await fs.mkdir(environment.ANDROID_USER_HOME, { recursive: true });
await fs.writeFile(path.join(environment.ANDROID_USER_HOME, 'repositories.cfg'), '');
console.log('승인된 SDK 패키지 설치 시작');
await new Promise((resolve, reject) => {
  const child = spawn('cmd.exe', ['/d', '/c', sdkmanager, '--sdk_root=' + sdk, 'platforms;android-35', 'build-tools;35.0.0', 'platform-tools'], { env: environment, cwd: project, windowsHide: true });
  const log = createWriteStream(path.join(logs, 'sdk-install.log'));
  let buffer = '', accepted = false, lastProgress = 0;
  const output = chunk => {
    log.write(chunk);
    buffer = (buffer + chunk.toString('utf8')).slice(-30000);
    if (/Accept\?\s*\(y\/N\)/i.test(buffer)) {
      if (!/android-sdk-license/.test(buffer) || accepted) { child.kill(); reject(Error('예상하지 못한 약관 요청입니다. SDK 로그를 확인하세요.')); return; }
      accepted = true; child.stdin.write('y\n'); buffer = '';
      console.log('사용자 승인 범위의 android-sdk-license 동의 전달');
    }
    if (Date.now() - lastProgress > 20000) { console.log('Android SDK 설치 진행 중 · 상세 로그는 .build-tools/logs/sdk-install.log'); lastProgress = Date.now(); }
  };
  child.stdout.on('data', output); child.stderr.on('data', output);
  child.on('error', reject);
  child.on('close', code => { log.end(); code === 0 ? resolve() : reject(Error('SDK 설치 종료 코드 ' + code)); });
});
await fs.writeFile(path.join(project, 'android', 'local.properties'), 'sdk.dir=' + sdk.replaceAll('\\', '\\\\').replace(':', '\\:') + '\n');
const settings = { javaRoot, sdk, gradle, environment: { JAVA_HOME: javaRoot, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: environment.ANDROID_USER_HOME, GRADLE_USER_HOME: environment.GRADLE_USER_HOME } };
await fs.writeFile(path.join(toolsRoot, 'build-settings.json'), JSON.stringify(settings, null, 2));
plan.status = 'android-tools-ready';
plan.notes = ['SDK 약관 사용자 동의 확인 및 필수 패키지 설치 완료. APK 빌드는 다음 단계입니다.'];
await fs.writeFile(planFile, JSON.stringify(plan, null, 2));
console.log('Android 빌드 도구 준비 완료');
