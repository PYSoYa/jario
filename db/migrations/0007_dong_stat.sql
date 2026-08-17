-- 행정동별 고정 통계.
--
-- 입지계수를 구하려면 "그 동의 전체 업소 수"가 필요한데, 이건 업종과 무관하고
-- 분기 스냅샷이라 데이터를 다시 넣기 전까지 변하지 않는다. 그런데도 매 요청마다
-- 691,087행을 훑고 있었다 — 인덱스로는 없앨 수 없는 전체 집계다.
-- 이 때문에 /api/analysis/dong 이 30~60초가 걸렸다.
--
-- 585행짜리 표로 미리 계산해둔다. 적재 후 db/etl/refresh-stats.sql 로 갱신한다.
CREATE TABLE dong_stat (
  code    text PRIMARY KEY,
  name    text NOT NULL,
  sigungu text NOT NULL,
  total   integer NOT NULL,
  -- 그 업종이 한 곳도 없는 동에서 쓰는 대표 좌표(전체 업소의 무게중심).
  lon     double precision NOT NULL,
  lat     double precision NOT NULL
);

COMMENT ON TABLE dong_stat IS
  '행정동별 전체 업소 수와 대표 좌표. place에서 파생되며 적재 후 재계산한다.';
