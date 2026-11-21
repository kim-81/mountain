// 가져온 파일은 허용된 필드만 복사합니다. 로그인·일정·서버 인증은 복원하지 않습니다.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_POINTS = 150000;
function requireValue(value, message) { if (!value) throw Error(message); }
function textBytes(text) { return new TextEncoder().encode(text).byteLength; }
function cleanRecord(record, mountains, pointBudget) {
  requireValue(record && typeof record === 'object', '기록 형식이 올바르지 않습니다.');
  requireValue(typeof record.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(record.id), '기록 번호가 올바르지 않습니다.');
  requireValue(mountains.some(m => m.id === record.mountainId), '지원하지 않는 산의 기록이 있습니다.');
  requireValue(Number.isFinite(record.km) && record.km >= 0 && record.km <= 10000 && Number.isFinite(record.minutes) && record.minutes >= 0 && record.minutes <= 100000, '기록의 거리·시간이 올바르지 않습니다.');
  requireValue(Number.isFinite(record.startedAt) && record.startedAt >= 0 && record.startedAt <= Date.now() + 86400000, '기록 시작 시각이 올바르지 않습니다.');
  requireValue(typeof record.date === 'string' && record.date.length <= 80 && typeof record.complete === 'boolean', '기록의 날짜·완주 여부를 확인해 주세요.');
  requireValue(Array.isArray(record.points) && record.points.length <= MAX_POINTS, '기록의 GPS 지점 수가 너무 많습니다.');
  pointBudget.count += record.points.length;
  requireValue(pointBudget.count <= MAX_POINTS, '파일 전체 GPS 지점은 150,000개 이하로 준비해 주세요.');
  let previous = -1;
  const points = record.points.map(point => {
    requireValue(point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
      && Number.isFinite(point.time) && point.time >= record.startedAt && point.time > previous && point.time <= Date.now() + 86400000
      && Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 100000, 'GPS 좌표·수신 순서·정확도가 올바르지 않습니다.');
    previous = point.time;
    return { lat: point.lat, lng: point.lng, time: point.time, accuracy: point.accuracy };
  });
  return { id: record.id, mountainId: record.mountainId, startedAt: record.startedAt, date: record.date, km: record.km, minutes: record.minutes, complete: record.complete, points };
}
export function parseRecordBackup(text, mountains) {
  requireValue(typeof text === 'string' && textBytes(text) <= MAX_BYTES, '16MB 이하의 기록 JSON 파일을 선택해 주세요.');
  let input;
  try { input = JSON.parse(text); } catch { throw Error('JSON 파일을 읽을 수 없습니다. 산길따라에서 내보낸 기록을 선택해 주세요.'); }
  requireValue(input && [1, 2].includes(input.schemaVersion) && (!input.format || input.format === 'sangil-ttara-records') && Array.isArray(input.records), '산길따라 기록 백업 파일이 아닙니다.');
  requireValue(input.records.length <= 1000, '한 번에 1,000개 이하의 기록을 가져올 수 있습니다.');
  const budget = { count: 0 };
  const records = input.records.map(record => cleanRecord(record, mountains, budget));
  requireValue(new Set(records.map(record => record.id)).size === records.length, '파일 안에 중복된 기록 번호가 있습니다.');
  return records;
}
export function mergeRecordBackup(current, incoming, userId) {
  const existing = new Set(current.map(record => record.id));
  const added = incoming.filter(record => !existing.has(record.id)).map(record => ({ ...record, userId: userId || undefined }));
  return { records: [...current, ...added].sort((a, b) => b.startedAt - a.startedAt), added: added.length, skipped: incoming.length - added.length };
}
export function makeRecordBackup(records) {
  return { format: 'sangil-ttara-records', schemaVersion: 2, exportedAt: new Date().toISOString(), records: records.map(({userId, routeSegments, deviation, ...record}) => record) };
}
function xml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]); }
export function recordGPX(record, title) {
  requireValue(record?.points?.length >= 2, 'GPX로 저장하려면 GPS 지점이 2개 이상 필요합니다.');
  const segments = [];
  for (const point of record.points) {
    requireValue(Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180 && Number.isFinite(point.time) && point.time >= 0 && point.time <= Date.now() + 86400000, '기록의 GPS 좌표 또는 시각을 확인해 주세요.');
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    // 기록 수신 공백은 실제 이동 경로로 연결하지 않습니다.
    if (!previous || point.time - previous.time > 120000 || point.time <= previous.time) segments.push([point]);
    else segment.push(point);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="산길따라" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${xml(title)}</name>${segments.map(segment => '<trkseg>' + segment.map(point => `<trkpt lat="${point.lat}" lon="${point.lng}"><time>${new Date(point.time).toISOString()}</time></trkpt>`).join('') + '</trkseg>').join('')}</trk></gpx>`;
}
