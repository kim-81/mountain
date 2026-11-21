export function photoDimensions(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height,mime;
  if(bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){mime='image/png';width=view.getUint32(16);height=view.getUint32(20);}
  else if(bytes.length>=30&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){
    mime='image/webp';const type=String.fromCharCode(...bytes.slice(12,16));
    if(type==='VP8X'){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
    else if(type==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}
    else if(type==='VP8L'&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  } else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
    mime='image/jpeg';let offset=2;
    while(offset+4<bytes.length){
      if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(offset+2>bytes.length)break;const length=view.getUint16(offset);if(length<2||offset+length>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;}
      offset+=length;
    }
  }
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>60000000)throw Error('사진 크기를 확인할 수 없거나 너무 큽니다. 6천만 화소 이하 JPG·PNG·WebP를 선택해 주세요.');
  return {width,height,mime};
}
export async function prepareReviewPhotos(files) {
  if(files.length>3)throw Error('사진은 최대 3장입니다.');
  const results=[];
  for(const file of files){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('10MB 이하 JPG·PNG·WebP 사진을 선택해 주세요.');
    const bytes=new Uint8Array(await file.slice(0,1024*1024).arrayBuffer());const dimensions=photoDimensions(bytes);
    if(dimensions.mime!==file.type)throw Error('사진 파일의 형식이 확장 정보와 다릅니다.');
    const bitmap=await createImageBitmap(file,{resizeWidth:Math.min(960,dimensions.width,dimensions.height),resizeQuality:'high'});
    try {
      const scale=Math.min(1,960/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');if(!context)throw Error('사진 변환 기능을 사용할 수 없습니다.');
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);let image='';
      for(const quality of [.7,.6,.5,.4]){image=canvas.toDataURL('image/jpeg',quality);if(image.length<=680000)break;}
      if(image.length>680000)throw Error('사진을 줄인 뒤 다시 선택해 주세요.');results.push(image);
    } finally {bitmap.close();}
  }
  return results;
}
