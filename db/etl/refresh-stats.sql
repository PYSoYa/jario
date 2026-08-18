-- place에서 파생 통계를 다시 만든다. 데이터를 새로 넣은 뒤 반드시 돌려야 한다.
--
-- 실행: pnpm data:stats  (원격은 push-region.sh 가 자동으로 호출)

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM place;
  IF n = 0 THEN
    RAISE EXCEPTION 'place가 비어 있습니다. 먼저 데이터를 적재하세요.';
  END IF;
END $$;

TRUNCATE dong_stat;

INSERT INTO dong_stat (code, name, sigungu, total, lon, lat)
SELECT adm_dong_code, adm_dong_name, sigungu_name, count(*), avg(lon), avg(lat)
FROM place
GROUP BY 1, 2, 3;

ANALYZE dong_stat;

COMMIT;

-- ── 동 × 업종 사전 집계 ───────────────────────────────────────────
-- 자리 찾기가 쓴다. 없으면 요청마다 업종별 전체 행을 훑어, 대분류에서 10초를 넘긴다.
-- 회전 테이블이 아직 비어 있어도 만든다(closed/opened가 0일 뿐이다).
TRUNCATE dong_industry_stat;

INSERT INTO dong_industry_stat (adm_dong_code, industry_code, cnt, closed, opened)
SELECT
  COALESCE(c.adm_dong_code, d.adm_dong_code, o.adm_dong_code),
  COALESCE(c.industry_code, d.industry_code, o.industry_code),
  COALESCE(c.n, 0), COALESCE(d.n, 0), COALESCE(o.n, 0)
FROM      (SELECT adm_dong_code, industry_code, count(*) n FROM place GROUP BY 1,2) c
FULL JOIN (SELECT adm_dong_code, industry_code, count(*) n FROM place_closed GROUP BY 1,2) d
       ON d.adm_dong_code = c.adm_dong_code AND d.industry_code = c.industry_code
FULL JOIN (SELECT p.adm_dong_code, p.industry_code, count(*) n
             FROM place p JOIN place_opened x ON x.place_id = p.place_id
            GROUP BY 1,2) o
       ON o.adm_dong_code = COALESCE(c.adm_dong_code, d.adm_dong_code)
      AND o.industry_code = COALESCE(c.industry_code, d.industry_code);

ANALYZE dong_industry_stat;
