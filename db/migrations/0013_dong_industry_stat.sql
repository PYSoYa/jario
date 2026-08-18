-- 동 × 업종 사전 집계.
--
-- 자리 찾기가 요청마다 해당 업종의 전체 행을 훑고 있었다. 소분류(카페 28,504행)는
-- 견디는데 대분류(소매 142,840행)에서 **운영 11~16초**가 나왔다. 같은 쿼리가
-- 로컬에서는 24ms다 — 통계는 최신이었고, 차이는 순전히 훑는 양과 장비다.
--
-- dong_stat에서 이미 겪은 것과 같은 실수다. 그때도 동별 총계를 매 요청마다
-- 691,087행에서 집계하다 68초를 냈고, 585행으로 미리 계산해 해결했다.
--
-- 조합은 85,473개다. 원본의 8분의 1이고, 업종 접두어로 걸러도 여기서는
-- 몇 천 행이면 끝난다.

CREATE TABLE dong_industry_stat (
  adm_dong_code text NOT NULL,
  industry_code text NOT NULL REFERENCES industry(code),

  -- 최신 분기 업소 수
  cnt      integer NOT NULL,
  -- 이전 분기에 있었고 사라진 수 / 최신 분기에 새로 생긴 수
  closed   integer NOT NULL DEFAULT 0,
  opened   integer NOT NULL DEFAULT 0,

  PRIMARY KEY (adm_dong_code, industry_code)
);

-- 업종 접두어로 거르는 것이 이 테이블의 유일한 접근 패턴이다.
-- LIKE 'G2%' 가 인덱스를 타려면 text_pattern_ops 여야 한다(0005와 같은 이유).
CREATE INDEX dong_industry_stat_industry_idx
  ON dong_industry_stat (industry_code text_pattern_ops)
  INCLUDE (adm_dong_code, cnt, closed, opened);

COMMENT ON TABLE dong_industry_stat IS
  '동×업종 사전 집계. db/etl/refresh-stats.sql이 만든다. '
  'place/place_closed/place_opened를 바꾸면 반드시 다시 만들어야 한다 — '
  '안 그러면 자리 찾기가 옛 수를 답한다.';
