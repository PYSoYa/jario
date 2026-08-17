-- 상호명 trigram 인덱스를 제거한다.
--
-- 0003에서 "상호명 부분 검색에 쓸 것"이라며 만들었지만 그 기능을 구현한 적이 없다.
-- 인천만 있을 때는 눈에 안 띄었는데, 서울을 더하니 53MB로 place 테이블의 14%를
-- 차지했다. Supabase 무료 티어 500MB에서 이건 그냥 낭비다.
--
-- 상호명 검색을 실제로 만들 때 다시 추가한다. pg_trgm 확장은 남겨둔다(용량 없음).
--   CREATE INDEX place_name_trgm_idx ON place USING gin (name gin_trgm_ops);

DROP INDEX IF EXISTS place_name_trgm_idx;
