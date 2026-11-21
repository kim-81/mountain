import fs from 'node:fs/promises';
const web=new URL('../web/',import.meta.url);
// 로컬 파일로 여는 WKWebView에서도 동작하도록, 외부 번들러 없이 모듈을 한 함수 안에 묶습니다.
const modules=['data.js','core.js','map-catalog.js','catalog.js','store.js','server-config.js','review-client.js','photo-files.js','api.js','share-links.js','facility-database.js','facilities.js','course-support.js','weather-data.js','weather.js','official-notices-data.js','official-notices.js','navigation.js','map-database.js','map-geometry.js','offline-map.js','route-map.js','record-files.js','app.js'];
const contents=await Promise.all(modules.map(f=>fs.readFile(new URL('js/'+f,web),'utf8')));
// 각 모듈을 별도 함수로 감싸 이름 충돌과 import 별칭 누락을 방지합니다.
const parts=contents.map((source,index)=>{
  const names=[...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(match=>match[1]);
  const body=source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?\r?\n/gm,(_,imports,file)=>{
    if(modules.indexOf(file)<0||modules.indexOf(file)>=index)throw Error('모듈 순서를 확인하세요: '+file);
    const fields=imports.split(',').map(field=>field.trim().replace(/\s+as\s+/,': ')).join(', ');
    return `const {${fields}}=__modules[${JSON.stringify(file)}];\n`;
  }).replace(/^export /gm,'');
  return `__modules[${JSON.stringify(modules[index])}]=(()=>{\n${body}\nreturn {${names.join(',')}};\n})();`;
});
const bundle='(()=>{\nconst __modules=Object.create(null);\n'+parts.join('\n')+'\n})();\n';
for(const target of ['../android/app/src/main/assets/web/','../ios/SeoulTrail/web/']){
  const dest=new URL(target,import.meta.url);
  await fs.cp(web,dest,{recursive:true});
  const html=(await fs.readFile(new URL('index.html',dest),'utf8')).replace('type="module" src="js/app.js"','src="js/native-bundle.js"');
  await fs.writeFile(new URL('index.html',dest),html);
  await fs.writeFile(new URL('js/native-bundle.js',dest),bundle);
}
console.log('Android/iOS 공통 화면 동기화 완료');
