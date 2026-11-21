// 지도 투영·이동·확대 계산. 외부 지도 라이브러리를 사용하지 않습니다.
const earthRadius = 6378137;
export function projectPoint(point) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  return {
    x: earthRadius * point.lng * Math.PI / 180,
    y: earthRadius * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360))
  };
}
export function unprojectPoint(point) {
  return { lat: (2 * Math.atan(Math.exp(point.y / earthRadius)) - Math.PI / 2) * 180 / Math.PI, lng: point.x / earthRadius * 180 / Math.PI };
}
export function fitMapBounds(points, aspect = 560 / 360) {
  const projected = points.map(projectPoint);
  const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  let width = Math.max(400, Math.max(...xs) - Math.min(...xs)) * 1.2;
  let height = Math.max(300, Math.max(...ys) - Math.min(...ys)) * 1.2;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  return { minX: centerX - width / 2, maxX: centerX + width / 2, minY: centerY - height / 2, maxY: centerY + height / 2 };
}
export function zoomMapBounds(bounds, factor) {
  const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
  const width = Math.max(120, Math.min(60000, (bounds.maxX - bounds.minX) * factor));
  const height = width / (560 / 360);
  return { minX: centerX - width / 2, maxX: centerX + width / 2, minY: centerY - height / 2, maxY: centerY + height / 2 };
}
export function panMapBounds(bounds, dx, dy) {
  return { minX: bounds.minX + dx, maxX: bounds.maxX + dx, minY: bounds.minY + dy, maxY: bounds.maxY + dy };
}
export function geographicBounds(bounds) {
  const sw = unprojectPoint({ x: bounds.minX, y: bounds.minY }), ne = unprojectPoint({ x: bounds.maxX, y: bounds.maxY });
  return [sw.lat, sw.lng, ne.lat, ne.lng];
}
export function boundsIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
export function coverageContains(coverage, bounds) {
  // 여러 사각형의 합집합으로 덮이는지도 확인합니다. 작은 경계 공백을 '포함'으로 오인하지 않습니다.
  const latitudes = [bounds[0], bounds[2], ...coverage.flatMap(c => [c.bounds[0], c.bounds[2]]).filter(y => y > bounds[0] && y < bounds[2])].sort((a,b) => a-b);
  for (let i = 1; i < latitudes.length; i++) {
    const latitude = (latitudes[i - 1] + latitudes[i]) / 2;
    const intervals = coverage.filter(c => c.bounds[0] <= latitude && c.bounds[2] >= latitude).map(c => [c.bounds[1], c.bounds[3]]).sort((a,b) => a[0]-b[0]);
    let reached = bounds[1];
    for (const [start, end] of intervals) {
      if (start > reached) break;
      reached = Math.max(reached, end);
    }
    if (reached < bounds[3]) return false;
  }
  return true;
}
