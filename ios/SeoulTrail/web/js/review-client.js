import {serverOrigin} from './server-config.js';
export function reviewImageURL(value,origin=serverOrigin||globalThis.location?.origin||'') {
  if(typeof value!=='string')return null;
  if(value.length<=700000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return value;
  if(!/^\/api\/reviews\/[a-f0-9]{32}\/photos\/[0-2]\/[a-f0-9]{16}$/.test(value))return null;
  if((globalThis.AndroidTrail||globalThis.webkit?.messageHandlers?.trail)&&!serverOrigin)return null;
  try{const url=new URL(value,origin);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function serverDraftId(crypto=globalThis.crypto) {
  if(!crypto?.getRandomValues)throw Error('안전한 저장 번호를 만들 수 없습니다. 앱 또는 HTTPS 환경을 사용해 주세요.');
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
