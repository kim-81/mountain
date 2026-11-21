import {createHash} from 'node:crypto';
import {photoDimensions} from '../web/js/photo-files.js';
const fail=(message,status=400)=>{const error=Error(message);error.status=status;throw error;};
export function decodeReviewPhoto(value) {
  if(typeof value!=='string'||value.length>700000)fail('사진 형식 또는 용량을 확인해 주세요.');
  const match=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||match[2].length%4!==0)fail('JPG·PNG·WebP 사진만 저장할 수 있습니다.');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.toString('base64')!==match[2])fail('사진 인코딩이 올바르지 않습니다.');
  const valid=match[1]==='jpeg'?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid)fail('사진 내용과 확장 형식이 일치하지 않습니다.');
  let dimensions;
  try{dimensions=photoDimensions(bytes);}catch{fail('사진 헤더가 올바르지 않거나 크기가 너무 큽니다.');}
  if(dimensions.mime!=='image/'+match[1]||dimensions.width>2048||dimensions.height>2048||dimensions.width*dimensions.height>4000000)fail('사진을 2048px 이하로 줄여서 다시 저장해 주세요.');
  return {mime:'image/'+match[1],bytes};
}
const digest=value=>createHash('sha256').update(value).digest('hex');
export function reviewPhotoPath(id,index,value){return `/api/reviews/${id}/photos/${index}/${digest(value).slice(0,16)}`;}
export function reviewRevision(content){return digest(typeof content==='string'?content:JSON.stringify(content));}
export function publicReview(row) {
  const content=JSON.parse(row.content);
  return {...content,photos:(content.photos||[]).map((value,index)=>reviewPhotoPath(row.id,index,value)),id:row.id,userId:row.owner_id,author:row.nickname,mountainId:row.mountain_id,storage:'server',revision:reviewRevision(row.content)};
}
export function resolveReviewPhotos(input,id,previous=[]) {
  if(!Array.isArray(input)||input.length>3)fail('사진은 최대 3장까지 저장할 수 있습니다.');
  return input.map(value=>{
    if(typeof value==='string'&&value.startsWith('/api/reviews/')){
      const index=previous.findIndex((photo,i)=>reviewPhotoPath(id,i,photo)===value);
      if(index<0)fail('사진이 변경되었습니다. 후기를 다시 불러와 주세요.',409);
      return previous[index];
    }
    decodeReviewPhoto(value);return value;
  });
}
