import { distanceKm } from '../../web/js/core.js';
import { validateRoute } from '../../web/js/navigation.js';

// 지도·코스·시설의 연결을 검사합니다. 현장 안전/개방 여부를 판정하지 않습니다.
export function auditCourses({ mountains, courses, maps, manifest, facilities }) {
  const facilityIds = new Set(facilities.features.map(item => item.id));
  const rows = mountains.map(mountain => {
    const errors = [], pending = [];
    const course = courses[mountain.id], route = maps.routes[mountain.id];
    const metadata = manifest.routes[mountain.id];
    const coverage = maps.coverage.filter(area => area.mountains.includes(mountain.id));
    const contains = point => maps.coverage.some(({bounds: [south, west, north, east]}) =>
      point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east);
    if (!course?.source?.startsWith('https://') || !course.start || !course.end || !(course.km > 0) || !(course.minutes > 0)) errors.push('공식 코스 안내 누락');
    if (!coverage.length || !contains(mountain)) errors.push('산 대표 위치의 배경지도 누락');
    const indexed = facilities.mountainIndex[mountain.id] || [];
    if (!indexed.length || indexed.some(id => !facilityIds.has(id))) errors.push('주변 시설 연결 누락');
    let points = 0, km = null, maxStepMeters = null;
    if (!route) {
      pending.push('기본 경로 확보 및 현재 코스 대조');
      if (metadata) errors.push('목록에는 있지만 실제 경로 없음');
    } else {
      if (!metadata || route.courseId !== course?.id || metadata.courseId !== course?.id) errors.push('코스와 경로 ID 불일치');
      if (!route.sourceUrl?.startsWith('https://') || !route.sourceId || !route.sourceBaseAt || !route.license?.spdx || !route.license?.attribution) errors.push('경로 출처·기준일·이용 조건 누락');
      try {
        const validated = validateRoute(route.segments);
        points = validated.count; km = Number(validated.km.toFixed(3));
        if (route.segments.length !== 1) errors.push('기본 코스의 경로가 여러 구간으로 끊김');
        let max = 0;
        for (const segment of route.segments) {
          for (let i = 1; i < segment.length; i++) max = Math.max(max, distanceKm(segment[i - 1], segment[i]));
          if (segment.some(point => !contains(point))) errors.push('경로가 저장 배경지도 범위를 벗어남');
        }
        maxStepMeters = Math.round(max * 1000);
        // 과도하게 생략된 점/가짜 직선 연결을 기본 경로에 허용하지 않습니다.
        if (max > .3) errors.push('인접 경로 좌표 사이 300m 초과: 원본 연결 확인 필요');
        if (course && Math.abs(validated.km - course.km) / course.km > .2) errors.push('공식 안내 거리와 경로 계산 거리 차이 20% 초과');
      } catch (error) { errors.push(error.message); }
      pending.push('실제 산행 GPS·이탈 알림·현재 통제 확인');
    }
    return { id: mountain.id, name: mountain.name, courseId: course?.id || null,
      hasBundledRoute: Boolean(route), points, km, maxStepMeters,
      facilityCount: indexed.length, dataChecksPassed: errors.length === 0,
      fieldVerified: false, errors: [...new Set(errors)], pending };
  });
  return { mountainCount: rows.length, bundledRouteCount: rows.filter(row => row.hasBundledRoute).length,
    dataErrorCount: rows.reduce((sum, row) => sum + row.errors.length, 0),
    allRoutesPrepared: rows.every(row => row.hasBundledRoute && row.dataChecksPassed),
    fieldVerified: false, rows };
}
