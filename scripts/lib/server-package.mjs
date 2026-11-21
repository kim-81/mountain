import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// 서버 배포에는 공개 웹 파일과 서버 코드만 포함합니다. 기기 기록·개발 도구는 읽지 않습니다.
export async function prepareServerPackage(project, destination) {
  const sourceRoot=path.resolve(project),targetRoot=path.resolve(destination);
  if(targetRoot===sourceRoot||sourceRoot.startsWith(targetRoot+path.sep))throw Error('프로젝트 밖의 새 배포 폴더를 지정하세요.');
  for(const directory of ['web','server','scripts']){
    const included=path.join(sourceRoot,directory);
    if(targetRoot===included||targetRoot.startsWith(included+path.sep))throw Error('배포할 원본 폴더 안에 결과를 만들 수 없습니다.');
  }
  await fs.mkdir(targetRoot); // 기존 폴더를 덮어쓰지 않습니다.
  const files=[];
  async function copyFile(relative){
    const source=path.join(sourceRoot,relative),stat=await fs.lstat(source);
    if(stat.isSymbolicLink()||!stat.isFile())throw Error('일반 파일만 배포할 수 있습니다: '+relative);
    const bytes=await fs.readFile(source),target=path.join(targetRoot,relative);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});
    files.push({path:relative.replaceAll(path.sep,'/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  async function copyFolder(relative,extensions){
    const stat=await fs.lstat(path.join(sourceRoot,relative));if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('일반 폴더만 배포할 수 있습니다.');
    for(const entry of await fs.readdir(path.join(sourceRoot,relative),{withFileTypes:true})){
      const next=path.join(relative,entry.name);
      if(entry.isSymbolicLink())throw Error('배포 경로에 연결 파일이 있습니다: '+next);
      if(entry.name.startsWith('.')||/\.(?:sqlite|db|key|pem|p12|apk|gpx)$/i.test(entry.name))throw Error('공개 폴더 안의 비공개/조사 파일을 제거하세요: '+next);
      if(entry.isDirectory())await copyFolder(next,extensions);
      else if(extensions.has(path.extname(entry.name)))await copyFile(next);
      else throw Error('배포 허용 파일 형식 확인 필요: '+next);
    }
  }
  await copyFolder('web',new Set(['.html','.js','.json','.css','.svg','.md','.webmanifest','.png','.jpg','.webp','.ico']));
  await copyFolder('server',new Set(['.mjs']));
  for(const file of ['serve-production.mjs','serve-local.mjs','backup-server.mjs'])await copyFile(path.join('scripts',file));
  const sourcePackage=JSON.parse(await fs.readFile(path.join(sourceRoot,'package.json'),'utf8'));
  const deploymentPackage={name:sourcePackage.name,version:sourcePackage.version,private:true,type:'module',engines:{node:'24.x'},scripts:{start:'node scripts/serve-production.mjs'}};
  const bytes=Buffer.from(JSON.stringify(deploymentPackage,null,2)+'\n');
  await fs.writeFile(path.join(targetRoot,'package.json'),bytes,{flag:'wx'});
  files.push({path:'package.json',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  return {version:sourcePackage.version,fileCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),files};
}
