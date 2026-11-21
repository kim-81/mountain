import { renderOfflineMap } from './offline-map.js';
import { validateRoute } from './navigation.js';

export function parseGPX(text) {
  if (text.length > 3 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('3MB 이하의 일반 GPX 파일을 선택해 주세요.');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'gpx') throw Error('올바른 GPX XML 파일이 아닙니다.');
  const nodes = name => [...xml.getElementsByTagNameNS('*', name)];
  const tracks = nodes('trkseg');
  const groups = tracks.length ? tracks : nodes('rte');
  const segments = groups.map(group => [...group.children]
    .filter(node => ['trkpt', 'rtept'].includes(node.localName))
    .map(node => ({ lat: Number(node.getAttribute('lat') || NaN), lng: Number(node.getAttribute('lon') || NaN) })))
    .filter(segment => segment.length >= 2);
  return validateRoute(segments);
}

export function geoMap(route,fixes=[],position=null,options={}) {
  return renderOfflineMap(route,fixes,position,options);
}
