// 실행/설치/약관 동의를 하지 않고, 공식 배포 메타데이터만 확인합니다.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const repository='https://dl.google.com/android/repository/repository2-1.xml';
const response=await fetch(repository,{signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error('Android 저장소 조회 실패: '+response.status);
const xml=await response.text();
const wanted=['cmdline-tools;12.0','platforms;android-35','build-tools;35.0.0','platform-tools'];
const packages=[];
for(const match of xml.matchAll(/<remotePackage\b[^>]*\bpath="([^"]+)"[^>]*>([\s\S]*?)<\/remotePackage>/g)) {
  if(!wanted.includes(match[1]))continue;
  const body=match[2];
  if(/<channelRef\s+ref="channel-[1-9]/.test(body))continue;
  const archive=[...body.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].find(m=>/<host-os>windows<\/host-os>/.test(m[1])||!/<host-os>/.test(m[1]));
  if(!archive)throw Error('Windows 배포본 없음: '+match[1]);
  const complete=archive[1].match(/<complete>([\s\S]*?)<\/complete>/)?.[1];
  const file=complete?.match(/<url>([^<]+)<\/url>/)?.[1];
  const checksum=complete?.match(/<checksum[^>]*>([^<]+)<\/checksum>/)?.[1];
  const revision=body.match(/<revision>([\s\S]*?)<\/revision>/)?.[1]||'';
  const rank=Number(revision.match(/<major>(\d+)<\/major>/)?.[1]||0)*10000+Number(revision.match(/<minor>(\d+)<\/minor>/)?.[1]||0)*100+Number(revision.match(/<micro>(\d+)<\/micro>/)?.[1]||0);
  const value={package:match[1],revision:rank,description:body.match(/<display-name>([^<]+)<\/display-name>/)?.[1],license:body.match(/<uses-license\s+ref="([^"]+)"/)?.[1],url:new URL(file,'https://dl.google.com/android/repository/').href,bytes:Number(complete?.match(/<size>(\d+)<\/size>/)?.[1]),checksum};
  const existing=packages.findIndex(p=>p.package===value.package);
  if(existing<0)packages.push(value);else if(packages[existing].revision<rank)packages[existing]=value;
}
if(packages.length!==wanted.length)throw Error('Android 저장소에서 찾은 패키지: '+packages.map(p=>p.package).join(', ')+' / cmdline 후보: '+[...xml.matchAll(/path="(cmdline-tools;[^"]+)"/g)].map(m=>m[1]).join(', '));
const jdkResponse=await fetch('https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse',{signal:AbortSignal.timeout(30000)});
if(!jdkResponse.ok)throw Error('JDK 메타데이터 조회 실패');
const jdk=(await jdkResponse.json())[0];
const sdkLicense=xml.match(/<license\b[^>]*\bid="android-sdk-license"[^>]*>([\s\S]*?)<\/license>/)?.[1]||'';
const plan={
  checkedAt:new Date().toISOString(),status:'awaiting-sdk-license-consent',
  action:'프로젝트 전용 도구 폴더에 개발 도구를 준비하고 Android 디버그 APK를 빌드',
  termsUrl:'https://developer.android.com/studio/terms',sdkLicenseId:'android-sdk-license',
  sdkLicenseSHA256:createHash('sha256').update(sdkLicense).digest('hex'),
  packages,
  jdk:{version:jdk.version?.semver||jdk.release_name,url:jdk.binary.package.link,sha256:jdk.binary.package.checksum,bytes:jdk.binary.package.size},
  downloadBytes:packages.reduce((sum,p)=>sum+p.bytes,0)+jdk.binary.package.size,
  notes:['이 단계에서는 약관에 동의하거나 도구를 설치하지 않았습니다.','Gradle과 컴파일 의존성은 실제 빌드 때 추가로 내려받습니다.','Android SDK 약관 동의 후 패키지 설치와 APK 빌드를 진행합니다.']
};
await fs.writeFile(new URL('../docs/android-build-plan.json',import.meta.url),JSON.stringify(plan,null,2));
console.log(JSON.stringify({packages:packages.map(p=>({name:p.package,MB:Math.round(p.bytes/1048576),license:p.license})),jdk:plan.jdk.version,downloadMB:Math.round(plan.downloadBytes/1048576),terms:plan.termsUrl,status:plan.status},null,2));
