-- 업종 접두어 검색을 index-only scan 으로 만든다.
--
-- 0005로 인덱스는 타게 됐지만 여전히 느렸다. 실행계획을 보면 원인이 힙 접근이다:
--   Bitmap Index Scan  47ms   (인덱스는 빠르다)
--   Bitmap Heap Scan 2103ms   Heap Blocks: exact=17724
-- 28,504행을 모으려고 힙 블록 1.7만 개를 훑는다. 업종이 같은 업소는 테이블 여기저기
-- 흩어져 있어서 그렇다.
--
-- 동네 분석이 쓰는 컬럼(행정동·좌표)을 인덱스에 함께 담으면 힙에 갈 일이 없다.
-- 약 40MB를 쓰지만 무료 티어 500MB 중 여유가 있고, 이 쿼리가 68초를 잡아먹던 것을
-- 생각하면 값이 맞다.
CREATE INDEX place_industry_cover_idx
  ON place (industry_code text_pattern_ops)
  INCLUDE (adm_dong_code, lon, lat);

-- 커버링 인덱스가 접두어 검색을 모두 대신한다.
DROP INDEX IF EXISTS place_industry_prefix_idx;
