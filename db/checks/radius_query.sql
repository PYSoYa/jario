-- M1 핵심 쿼리(반경 내 업소 검색)가 GiST 인덱스를 타는지 확인한다.
--
-- 여기서 봐야 할 것:
--   1. "Bitmap Index Scan on place_geom_idx"  → 인덱스를 탄다
--   2. Index Cond 에 `geom && _st_expand(...)` → 바운딩박스로 먼저 후보를 좁힌다
--   3. Seq Scan 이 보이면 실패다 (통계 미갱신이나 인덱스 누락)
--
-- 실행: pnpm db:check

\echo '── 부평역(126.7244, 37.4894) 반경 500m 업종 분포 상위 10 ──'
SELECT s.name AS 업종, count(*) AS 개수
FROM place p
JOIN industry s ON s.code = p.industry_code
WHERE ST_DWithin(p.geom, ST_MakePoint(126.7244, 37.4894)::geography, 500)
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;

\echo ''
\echo '── 실행계획 ──'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*)
FROM place
WHERE ST_DWithin(geom, ST_MakePoint(126.7244, 37.4894)::geography, 500);

-- 2026-06 인천(136,995행) 기준 측정:
--   Bitmap Index Scan on place_geom_idx → 후보 4,629건
--   정확 필터 통과 3,074건 / 제거 1,556건
--   Execution Time: 7.683 ms
