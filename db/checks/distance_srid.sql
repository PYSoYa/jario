-- 좌표계 선택 근거를 재현하는 검증 쿼리.
--
-- EPSG:4326에서 ST_Distance의 단위는 미터가 아니라 도(degree)다.
-- "도 × 111320"으로 미터를 근사하는 코드가 흔한데, 경도 1도의 실제 거리는
-- cos(위도)에 비례해 줄어들기 때문에 동서 방향에서 크게 틀린다.
--
-- 실행: pnpm db:check
--   (docker exec에 -i 가 없으면 stdin이 컨테이너로 전달되지 않아
--    psql이 빈 입력을 읽고 아무 출력 없이 exit 0으로 끝난다. 조용히 실패하는 형태라 주의.)

WITH pts AS (
  SELECT
    ST_SetSRID(ST_MakePoint(126.7052, 37.4563), 4326)         AS a,      -- 인천시청
    ST_SetSRID(ST_MakePoint(126.7052 + 0.005, 37.4563), 4326) AS east,   -- 동쪽으로 0.005도
    ST_SetSRID(ST_MakePoint(126.7052, 37.4563 + 0.005), 4326) AS north   -- 북쪽으로 0.005도
)
SELECT
  '동쪽 0.005도' AS 방향,
  round(ST_Distance(a::geography, east::geography)::numeric, 1)                 AS "geography(m)",
  round(ST_Distance(ST_Transform(a, 5179), ST_Transform(east, 5179))::numeric, 1) AS "EPSG5179(m)",
  round((ST_Distance(a, east) * 111320)::numeric, 1)                           AS "도x111320(m)"
FROM pts
UNION ALL
SELECT
  '북쪽 0.005도',
  round(ST_Distance(a::geography, north::geography)::numeric, 1),
  round(ST_Distance(ST_Transform(a, 5179), ST_Transform(north, 5179))::numeric, 1),
  round((ST_Distance(a, north) * 111320)::numeric, 1)
FROM pts;

-- 기대 결과 (PostGIS 3.5.3):
--     방향     | geography(m) | EPSG5179(m) | 도x111320(m)
--  동쪽 0.005도 |        442.4 |       442.2 |        556.6
--  북쪽 0.005도 |        554.9 |       554.7 |        556.6
--
-- → geography와 EPSG:5179는 0.2m(0.05%) 차이로 둘 다 정확.
-- → 상수 곱셈은 동서 방향을 114m(26%) 과대평가. 채택 불가.
