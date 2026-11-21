// 위경도 계산과 이탈 판정. 화면/운영체제에 의존하지 않아 자동 검사가 가능합니다.
import { distanceKm, validFix } from './core.js';

export function coordinateValid(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

export function pointToSegmentMeters(point, start, end) {
  const scale = Math.PI / 180 * 6371000;
  const cos = Math.cos(point.lat * Math.PI / 180);
  const a = { x: (start.lng - point.lng) * cos * scale, y: (start.lat - point.lat) * scale };
  const b = { x: (end.lng - point.lng) * cos * scale, y: (end.lat - point.lat) * scale };
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / length)) : 0;
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

export function routeDistanceMeters(point, segments) {
  if (!coordinateValid(point)) return Infinity;
  let nearest = Infinity;
  for (const segment of segments || []) {
    for (let i = 1; i < segment.length; i++) {
      nearest = Math.min(nearest, pointToSegmentMeters(point, segment[i - 1], segment[i]));
    }
  }
  return nearest;
}

export function routeLengthKm(segments) {
  return segments.reduce((sum, segment) => sum + segment.slice(1).reduce(
    (length, point, index) => length + distanceKm(segment[index], point), 0), 0);
}

export function nextDeviation(previous, fix, segments, enabled) {
  const result = { ...(previous || { outsideCount: 0, outside: false, lastAlertAt: 0 }), alert: false };
  if (!enabled || !segments?.length || !validFix(fix)) return { ...result, outsideCount: 0, distance: null };
  if (fix.time <= (result.lastFixAt || 0)) return result;
  result.lastFixAt = fix.time;
  const distance = routeDistanceMeters(fix, segments);
  result.distance = Math.round(distance);
  if (distance < 30) {
    result.outside = false;
    result.outsideCount = 0;
  } else if (distance > Math.max(70, fix.accuracy * 2)) {
    result.outsideCount++;
    if (result.outsideCount >= 3) {
      result.outside = true;
      if (fix.time - result.lastAlertAt >= 90000) {
        result.alert = true;
        result.lastAlertAt = fix.time;
      }
    }
  } else result.outsideCount = 0;
  return result;
}

export function appendFix(session, fix) {
  if (!validFix(fix) || !Number.isFinite(fix.time)) return false;
  if (fix.time < session.startedAt || fix.time > Date.now() + 10000) return false;
  const previous = session.points.at(-1);
  if (previous && fix.time <= previous.time) return false;
  const seconds = previous ? (fix.time - previous.time) / 1000 : 0;
  const km = previous ? distanceKm(previous, fix) : 0;
  // 비정상 이동과 긴 수신 공백은 직선거리로 더하지 않습니다.
  if (previous && (km / seconds > 0.012 || km < 0.005)) return false;
  if (previous && seconds <= 120) session.km += km;
  session.points.push({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, time: fix.time });
  return true;
}

export function validateRoute(segments) {
  const count = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (count < 2 || count > 12000) throw Error('GPX는 2~12,000개 좌표 범위로 준비해 주세요.');
  if (segments.some(segment => segment.length < 2 || segment.some(point => !coordinateValid(point))))
    throw Error('경로의 위도·경도 또는 구간 구성이 올바르지 않습니다.');
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      if (distanceKm(segment[i - 1], segment[i]) > 3) throw Error('같은 구간 안에 3km 이상 끊긴 경로가 있습니다. GPX를 확인해 주세요.');
    }
  }
  return { segments, count, km: routeLengthKm(segments) };
}
