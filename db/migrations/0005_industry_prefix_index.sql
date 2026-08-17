-- 업종 접두어 매칭용 인덱스.
--
-- 이 프로젝트의 업종 필터는 전부 `industry_code LIKE 'I2%'` 형태다(대/중/소를
-- 파라미터 하나로 처리하는 설계의 핵심). 그런데 기본 btree 인덱스는 C가 아닌
-- collation에서 LIKE 접두어 검색에 쓰이지 않는다. text_pattern_ops 가 필요하다.
--
-- 인천만 있을 때(137k행)는 seq scan도 빨라서 드러나지 않았다. 서울을 더해
-- 691k행이 되고 Supabase 무료 티어의 느린 I/O에서 실행하니
-- "Parallel Seq Scan on place ... 5603ms" 로 나타났고,
-- /api/analysis/dong 응답이 68초가 됐다.

CREATE INDEX place_industry_prefix_idx ON place (industry_code text_pattern_ops);

-- 기존 인덱스는 등가 비교용인데 그런 쿼리가 없다. 접두어 인덱스가 등가도 처리한다.
DROP INDEX IF EXISTS place_industry_idx;
