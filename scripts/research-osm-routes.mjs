import fs from 'node:fs/promises';
const folder = new URL('../map-source/', import.meta.url);
await fs.mkdir(folder, {recursive:true});
const ids = process.argv.slice(2).map(Number);
if (ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw Error('OSM 관계 번호를 확인하세요.');
for (const id of ids.length ? ids : [11361878, 10997594]) {
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`, {
    headers: {'User-Agent':'SangilTtara route review'}, signal:AbortSignal.timeout(30000)
  });
  if (response.status === 410) {
    const history = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${id}/history.json`, {signal:AbortSignal.timeout(30000)});
    if (!history.ok) throw Error(`OSM history ${id}: HTTP ${history.status}`);
    const data = await history.json();
    await fs.writeFile(new URL(`osm-history-${id}.json`,folder),JSON.stringify(data));
    console.log(JSON.stringify({id,deleted:true,latest:data.elements.at(-1)}));
    continue;
  }
  if (!response.ok) throw Error(`OSM ${id}: HTTP ${response.status}`);
  const data = await response.json();
  await fs.writeFile(new URL(`osm-full-${id}.json`, folder), JSON.stringify(data));
  const relation = data.elements.find(item=>item.type==='relation'&&item.id===id);
  console.log(JSON.stringify({id,tags:relation.tags,objects:data.elements.length}));
}
