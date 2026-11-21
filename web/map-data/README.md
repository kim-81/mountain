# 서울 주변 OSM 배경지도 및 기본 경로

© OpenStreetMap contributors. 이 폴더의 `seoul-osm.json` 및 `../js/map-database.js` 지리자료는 **ODbL-1.0**으로 제공합니다.

- 저작권/기여자 안내: https://www.openstreetmap.org/copyright
- 라이선스: https://opendatacommons.org/licenses/odbl/1-0/
- 조회 API: https://overpass-api.de/api/interpreter
- 생성 방법: 프로젝트의 `scripts/fetch-map-data.mjs`

지리자료를 재배포하거나 수정해 배포할 때 출처와 ODbL 조건을 유지하세요. 앱 코드 자체의 라이선스와 지리 데이터베이스의 라이선스는 구분됩니다. 앱에서 지도를 표시할 때 출처와 라이선스 링크를 항상 표시합니다.

## 포함한 범위

서울의 초기 대상 산 8곳 주변을 서부·동부·북동부·남부의 네 사각형으로 조회했습니다. 구체적 경계와 원본 데이터베이스 시각은 JSON의 `coverage`에 기록되어 있습니다.

도로·산길·숲·하천·산봉우리만 포함합니다. 건물·상점·등고선·실시간 통제 정보는 포함하지 않았습니다. 배경 선형 자료는 표시 용량을 줄이기 위해 약 2m 허용오차로 단순화했습니다. 기본 산행 경로는 이 단순화를 적용하지 않았습니다.

OSM 타일 이미지를 내려받거나 묶어서 배포하지 않았습니다. 원시 지리자료에서 직접 SVG 배경을 그립니다. 앱 실행 중 사용자 GPS 위치를 OSM/Overpass에 전송하지 않습니다.

## 기본 경로

- 아차산: https://www.openstreetmap.org/relation/17496414
- 북한산 종로: https://www.openstreetmap.org/relation/17506001
- 관악산: https://www.openstreetmap.org/relation/17538300
- 수락산: https://www.openstreetmap.org/relation/21955834
- 불암산: https://www.openstreetmap.org/relation/22020366
- 인왕산·북악산: https://www.openstreetmap.org/relation/10997594 및 각 경로의 `connectingWayIds`에 기록한 공개 보행로

코스 번호가 현재 안내와 일치하는 관계 객체를 후보로 선택했습니다. 공식 기관이 검증한 GPX가 아니라 OSM 기여자가 편집한 자료입니다. 공식 안내 거리와 계산 거리는 다를 수 있습니다. 연결은 좌표가 같은 끝점끼리만 수행하며, 떨어진 구간을 임의로 이어 붙이지 않습니다.

개편 전 수락·불암산 통합 경로는 사용하지 않습니다. 2026-11-20에 개별 관계 객체를 받아 연결·방향·출발/도착을 검토했습니다. 수락산은 도봉산역 접근 구간이 포함되지 않는다는 안내를 지도에 표시합니다.

인왕산·북악산은 한양도성 관계와 등록 보행로를 연결한 참고 경로입니다. 연결에 사용한 모든 선분이 원본 way의 인접 node인지 다시 검사하며 임의의 직선은 추가하지 않습니다. 공식 GPX나 현장 검증 자료는 아닙니다. 봉화산은 기본 경로가 미확보입니다.

불암산 남쪽 연결부는 별도 영역 `buram-connection`의 배경지도 1,380개 객체를 보강했습니다. 추가 영역은 2026-11-20 OSM API `https://api.openstreetmap.org/api/0.6/map.json`에서 받았으며 단순화하지 않은 원본 좌표를 유지합니다. 추가 경로·영역의 `sourceTimeBasis: api-download` 또는 수신 날짜는 API 다운로드 시각이며, 원본 요소의 수정 시각과 구분합니다.

재현용 개발 도구: `research-osm-routes.mjs`, `add-seoul-northeast-routes.mjs`, `fetch-osm-area.mjs`, `add-buram-map-connection.mjs`, `review-citywall-connections.mjs`, `add-citywall-routes.mjs`. 원본 응답은 `map-source/`에 보관하며 이 폴더와 조사용 PDF·GPX는 APK에 포함하지 않습니다.

데이터 수집 시각·OSM 기준 시각·경로별 마지막 수정 시각·출처 ID는 JSON에 보관합니다. 원본 응답 캐시는 개발용 `map-source/` 폴더에서 관리하며 배포에 필수인 지리자료는 이 폴더의 JSON으로 제공합니다.
