-- 공간 데이터의 기반. 이후 모든 마이그레이션이 이걸 전제한다.
CREATE EXTENSION IF NOT EXISTS postgis;

-- 상호명 부분 검색("스타벅스" 같은)에 trigram 인덱스를 쓰기 위해 미리 켜 둔다.
-- LIKE '%...%' 는 B-tree 인덱스를 못 타서 12만 행이면 전부 훑는다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
