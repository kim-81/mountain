import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const filename = `sangil-ttara-${version}-debug.apk`;
const settings = JSON.parse(await fs.readFile(path.join(project, '.build-tools', 'build-settings.json'), 'utf8'));
const environment = { ...process.env, ...settings.environment };
// 기존에 전달한 APK도 다시 빌드하지 않고 검사할 수 있습니다.
const apk = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(project, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const buildTools = path.join(settings.sdk, 'build-tools', '35.0.0');
const options = { env: environment, windowsHide: true, maxBuffer: 24 * 1024 * 1024 };
const badging = (await run(path.join(buildTools, 'aapt.exe'), ['dump', 'badging', apk], options)).stdout;
const signature = (await run('cmd.exe', ['/d', '/c', path.join(buildTools, 'apksigner.bat'), 'verify', '--verbose', '--print-certs', apk], options)).stdout;
const assets = (await run(path.join(buildTools, 'aapt.exe'), ['list', apk], options)).stdout.split(/\r?\n/);
if (!badging.includes("application-label:'산길따라'")) throw Error('APK 앱 이름이 예상과 다릅니다.');
const packageInfo = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
if (packageInfo?.[1] !== 'kr.seoultrail.app' || packageInfo[3] !== version) throw Error('APK 앱 ID와 버전을 확인해 주세요.');
const required = [
  'index.html', 'js/native-bundle.js', 'js/app.js', 'js/offline-map.js',
  'js/map-database.js', 'map-data/seoul-osm.json', 'map-data/README.md',
  'map-data/seoul-facilities.json', 'js/facility-database.js',
  'js/official-notices.js', 'js/official-notices-data.js', 'js/weather.js',
  'js/weather-data.js', 'js/photo-files.js', 'js/review-client.js', 'server-config.json'
].map(relative => 'assets/web/' + relative);
if (assets.some(name => /(?:sangil\.sqlite|\.env|build-settings\.json)$/.test(name))) throw Error('개발용 비공개 파일이 APK에 포함되었습니다.');
const certificateSha256 = signature.match(/certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1];
if (!certificateSha256) throw Error('APK 서명 인증서를 확인할 수 없습니다.');
const extract = async asset => (await run('tar.exe', ['-xOf', apk, asset], { ...options, encoding: 'buffer' })).stdout;
for (const asset of required) {
  if (!assets.includes(asset)) throw Error('APK 자료 누락: ' + asset);
  const expected = await fs.readFile(path.join(project, 'android', 'app', 'src', 'main', asset));
  const packaged = await extract(asset);
  if (!expected.equals(packaged)) throw Error('APK 자료와 Android 소스가 다릅니다: ' + asset);
}
const output = path.join(project, 'outputs');
await fs.mkdir(output, { recursive: true });
const target = path.join(output, filename);
if (path.relative(apk, target)) await fs.copyFile(apk, target);
const bytes = await fs.readFile(target);
const bundledConfig = JSON.parse((await extract('assets/web/server-config.json')).toString('utf8'));
const report = {
  version, variant: 'debug', applicationId: 'kr.seoultrail.app', label: '산길따라',
  apk: path.relative(project, target), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  verifiedAt: new Date().toISOString(), sdkVersion: badging.match(/sdkVersion:'([^']+)'/)?.[1],
  targetSdkVersion: badging.match(/targetSdkVersion:'([^']+)'/)?.[1],
  versionCode: Number(packageInfo[2]), bundledAssets: required, bundledAssetsMatchedSource: true,
  signatureVerified: true, certificateSha256,
  nativeServerConfigured: Boolean(bundledConfig.apiOrigin), publicHTTPSDeviceSyncTested: false,
  deviceInstallationTested: false, fieldGPSAndNotificationsTested: false
};
await fs.writeFile(path.join(output, `android-build-report-${version}.json`), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(output, 'android-build-report.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(output, filename + '.sha256'), report.sha256 + '  ' + filename + '\n');
await fs.writeFile(path.join(output, 'android-package-info.txt'), badging + '\n--- Signature verification ---\n' + signature);
console.log(JSON.stringify(report, null, 2));
