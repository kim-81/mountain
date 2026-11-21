// 산(장소)과 코스(경로/시간/교통)는 별도로 관리합니다.
// 공식 페이지에서 확인한 '안내 수치'와 실제 GPS 선형 경로의 검증은 서로 다릅니다.
import { mountains } from './data.js';
import { mapManifest } from './map-catalog.js';

export const checkedDate = '2026-11-04';
export const courseCatalog = {
  bukhansan: {
    id: 'seoul-dulle-18', mountainId: 'bukhansan', name: '서울둘레길 18코스 · 북한산 종로',
    km: 7.4, minutes: 240, level: 2, ascent: null,
    start: '북한산생태공원', end: '형제봉 입구',
    transport: '서울시 공식 코스 안내에서 출발점 접근과 귀가 교통을 확인하세요.',
    waypoints: ['북한산생태공원', '형제봉 입구'],
    source: 'https://gil.seoul.go.kr/gil/view.do?key=2407100011&sc_gilNo=18'
  },
  inwangsan: {
    id: 'hanyang-wall-inwang', mountainId: 'inwangsan', name: '한양도성 · 인왕구간',
    km: 4.0, minutes: 150, level: 3, ascent: null,
    levelBasis: '공식 별점 5/5를 앱의 어려움으로 환산',
    start: '돈의문 터', end: '창의문',
    transport: '한양도성 공식 안내에서 교통과 현재 탐방 안내를 확인하세요.',
    waypoints: ['돈의문 터', '인왕산 범바위', '인왕산 정상', '윤동주 시인의 언덕', '창의문'],
    source: 'https://seoulcitywall.seoul.go.kr/wallcourse/6.do'
  },
  bukhaksan: {
    id: 'hanyang-wall-baegak', mountainId: 'bukhaksan', name: '한양도성 · 백악구간',
    km: 4.7, minutes: 180, level: 3, ascent: null,
    levelBasis: '공식 별점 5/5를 앱의 어려움으로 환산',
    start: '창의문', end: '혜화문',
    transport: '한양도성 공식 안내에서 교통과 계절별 탐방 안내를 확인하세요.',
    waypoints: ['창의문', '백악마루', '청운대', '숙정문', '와룡공원', '혜화문'],
    source: 'https://seoulcitywall.seoul.go.kr/wallcourse/1.do'
  },
  bonghwasan: {
    id: 'seoul-theme-bonghwa', mountainId: 'bonghwasan', name: '봉화산 마실 둘레길',
    km: 4.2, minutes: 80, level: 1, ascent: null,
    start: '봉수대공원 상단', end: '봉수대공원 상단',
    transport: '서울시 테마산책길의 코스 진입 방법 안내를 확인하세요.',
    waypoints: ['봉수대공원 상단', '신내체육관', '먹골약수터', '보현정사', '봉수대공원 상단'],
    source: 'https://gil.seoul.go.kr/trail/view.do?key=2405200007&sc_trailSn=121'
  },
  achasan: {
    id: 'seoul-dulle-5', mountainId: 'achasan', name: '서울둘레길 5코스 · 아차산',
    km: 4.6, minutes: 130, level: 2, ascent: null,
    start: '깔딱고개 쉼터', end: '광나루역',
    transport: '사가정역 4번 출구에서 시작 지점 접근 · 도착 후 광나루역 1번 출구 이용',
    waypoints: ['깔딱고개 쉼터', '용마산 5보루', '아차산', '아차산 해맞이공원', '광나루역'],
    source: 'https://gil.seoul.go.kr/gil/view.do?key=2407100014&sc_gilNo=5'
  },
  suraksan: {
    id: 'seoul-dulle-1', mountainId: 'suraksan', name: '서울둘레길 1코스 · 수락산',
    km: 6.3, minutes: 170, level: 3, ascent: null,
    start: '도봉산역', end: '당고개공원 갈림길',
    transport: '도봉산역에서 진입 · 당고개공원 갈림길 이후 귀가 동선은 별도 확인',
    waypoints: ['도봉산역', '서울창포원', '당고개공원 갈림길'],
    source: 'https://gil.seoul.go.kr/gil/view.do?key=2406040003&sc_gilNo=1'
  },
  buramsan: {
    id: 'seoul-dulle-3', mountainId: 'buramsan', name: '서울둘레길 3코스 · 불암산',
    km: 6.9, minutes: 150, level: 2, ascent: null,
    start: '상계동 나들이 철쭉동산', end: '화랑대역',
    transport: '공식 코스 안내에서 접근 교통을 확인하세요.',
    waypoints: ['상계동 나들이 철쭉동산', '화랑대역'],
    source: 'https://gil.seoul.go.kr/gil/view.do?key=2406040002&sc_gilNo=3'
  },
  gwanaksan: {
    id: 'seoul-dulle-11', mountainId: 'gwanaksan', name: '서울둘레길 11코스 · 관악산',
    km: 5.7, minutes: 150, level: 2, ascent: null,
    start: '사당역 갈림길', end: '관악산공원 입구',
    transport: '공식 코스 안내에서 접근 교통을 확인하세요.',
    waypoints: ['사당역 갈림길', '관음사 입구', '관악산공원 입구'],
    source: 'https://gil.seoul.go.kr/gil/view.do?key=2407100008&sc_gilNo=11'
  }
};

export const catalogMountains = mountains.filter(mountain => courseCatalog[mountain.id]).map(mountain => {
  const course = courseCatalog[mountain.id];
  return {
    ...mountain,
    title: `${mountain.name}에서 만나는 나의 다음 산행`, mood: '나만의 속도로 걷기',
    ...(course ? {
      course: course.name, km: course.km, minutes: course.minutes,
      level: course.level, ascent: null, start: course.start, end: course.end,
      station: course.transport, transport: 'transit',
      title: course.id.startsWith('hanyang') ? '성곽을 따라 만나는 산과 도시' : `${mountain.name} 자락을 따라 걷는 둘레길`,
      mood: course.id.startsWith('hanyang') ? '한양도성 · 성곽 순성길' : (course.level === 1 ? '초급 안내 · 산자락 걷기' : '서울둘레길 · 산자락 걷기')
    } : {}),
    metadataStatus: course ? 'source-checked' : 'sample',
    sourceUrl: course?.source || null,
    checkedAt: course ? checkedDate : null,
    courseId: course?.id || `sample-${mountain.id}`,
    // 공식 둘레길은 정상 등정 코스가 아닐 수 있습니다. 산 높이를 코스 최고 고도로 사용하지 않습니다.
    courseAltitude: null,
    levelBasis: course?.levelBasis || null,
    positionStatus: 'approximate',
    routeStatus: mapManifest.routes[mountain.id]?.status || 'not-supplied',
    routeSourceUrl: mapManifest.routes[mountain.id]?.sourceUrl || null,
    facilities: { parking: null, toilet: null, water: null, shelter: null },
    waypoints: course?.waypoints || [],
    closure: { status: 'unknown', checkedAt: null },
    weather: { status: 'not-connected', checkedAt: null }
  };
});

export const preparationItems = [
  ['weather', '날씨와 강수·강풍 예보 확인'],
  ['closure', '탐방로 통제와 입산 가능 여부 확인'],
  ['water', '물과 간식 준비'],
  ['battery', '휴대폰 충전과 보조배터리 준비'],
  ['route', '사용할 경로와 귀가 동선 확인'],
  ['gear', '등산화·겉옷 등 장비 확인']
];

export function sourceLabel(mountain) {
  return mountain.metadataStatus === 'source-checked'
    ? `공식 안내 수치 확인 · ${mountain.checkedAt} · 실시간 통제 아님`
    : '개발용 예시 코스 · 실제 안내 수치 확인 필요';
}
