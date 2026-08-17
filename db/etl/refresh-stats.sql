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
