-- staging_place(이전 분기) × place(최신 분기) → place_opened / place_closed
--
-- 실행 전제: staging_place 에 **이전 분기** CSV가 들어 있고, place 에는 **최신 분기**가
-- 적재돼 있어야 한다. 순서를 바꾸면 사라짐과 새로 생김이 뒤집힌다.
-- 실행: pnpm data:churn
--
-- ── 왜 상가업소번호로 대조하지 않는가 ─────────────────────────────
-- 번호는 분기 간에 대체로 유지되지만(인천 202512→202606 88.8% 일치) 전부는 아니다.
-- 번호가 사라진 14,823곳을 실제로 뒤져보니:
--
--   상호명+좌표가 최신 분기에 그대로 있음   3,469 (23.4%)  ← 번호만 새로 발급됨
--   진짜 사라진 것으로 보임                11,354 (76.6%)
--
-- 개업 쪽도 같다(새 번호 18,923 중 3,904 = 20.6%가 이전 분기에 같은 이름·좌표로 존재).
-- 번호 소멸을 그대로 폐업이라 세면 30% 부풀린 수를 화면에 내놓게 된다. 에러도 안 나고
-- 그럴듯해서 아무도 의심하지 않는다. 그래서 (상호명, 좌표)로 한 번 더 거른다.
--
-- ── 이 수를 폐업이라 부르지 않는 이유 ─────────────────────────────
-- 보정 후에도 이전(移轉)·상호변경·데이터 정비가 섞여 있고, 스냅샷 대조로는 원리적으로
-- 가릴 수 없다. 화면에도 "사라진 곳"으로 적는다. 폐업이라 단정하지 않는다.

BEGIN;

-- staging이 비어 있으면 "사라진 곳 0, 새로 생긴 곳 전부"라는 조용한 거짓말이 된다.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM staging_place;
  IF n = 0 THEN
    RAISE EXCEPTION 'staging_place가 비어 있습니다. 이전 분기 CSV를 먼저 COPY 하세요.';
  END IF;
END $$;

-- 최신 분기가 없으면 대조 자체가 성립하지 않는다.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM place;
  IF n = 0 THEN
    RAISE EXCEPTION 'place가 비어 있습니다. 최신 분기를 먼저 적재하세요(transform.sql).';
  END IF;
END $$;

-- 같은 지역만 대조해야 한다. staging에 서울·인천이 있는데 place에 인천만 있으면
-- 서울 전체가 "사라짐"으로 잡힌다. 실수하면 수십만 건이 조용히 폐업 처리된다.
DO $$
DECLARE only_in_staging text;
BEGIN
  SELECT string_agg(DISTINCT btrim(시도명), ', ') INTO only_in_staging
  FROM staging_place
  WHERE btrim(시도명) NOT IN (SELECT DISTINCT sido_name FROM place);
  IF only_in_staging IS NOT NULL THEN
    RAISE EXCEPTION 'staging에만 있는 시도: %. place와 같은 지역만 넣으세요.', only_in_staging;
  END IF;
END $$;

TRUNCATE place_opened;
TRUNCATE place_closed;

-- 이전 분기를 place와 같은 모양으로 한 번만 정제해 둔다. 아래에서 두 번 쓴다.
CREATE TEMP TABLE prev ON COMMIT DROP AS
SELECT
  btrim(상가업소번호)          AS place_id,
  btrim(상호명)                AS name,
  btrim(상권업종소분류코드)    AS industry_code,
  btrim(행정동코드)            AS adm_dong_code,
  btrim(행정동명)              AS adm_dong_name,
  NULLIF(btrim(도로명주소), '') AS road_address,
  NULLIF(btrim(건물명), '')     AS building_name,
  -- transform.sql과 같은 층 해석. 규칙이 갈리면 같은 가게가 다르게 보인다.
  CASE
    WHEN btrim(층정보) ~ '^-?[0-9]+$' THEN btrim(층정보)::int
    WHEN btrim(층정보) ~ '^[Bb]0*[0-9]{1,2}$'
      THEN -(regexp_replace(btrim(층정보), '^[Bb]0*', '')::int)
    WHEN btrim(층정보) = '지' THEN -1
    ELSE NULL
  END                          AS floor_candidate,
  경도::double precision       AS lon,
  위도::double precision       AS lat
FROM staging_place;

-- 같은 번호가 두 번 나오면 PK에서 터진다. 실사에서 전건 유일이었지만 분기마다 다시 믿을 근거는 없다.
CREATE INDEX ON prev (place_id);
CREATE INDEX ON prev (name, lon, lat);
ANALYZE prev;

-- ── 사라진 곳 ─────────────────────────────────────────────────────
INSERT INTO place_closed (place_id, name, industry_code, adm_dong_code, adm_dong_name,
                          road_address, building_name, floor_no, lon, lat, last_seen)
SELECT DISTINCT ON (p.place_id)
  p.place_id, p.name, p.industry_code, p.adm_dong_code, p.adm_dong_name,
  p.road_address, p.building_name,
  CASE WHEN p.floor_candidate BETWEEN -10 AND 200 THEN p.floor_candidate END,
  p.lon, p.lat,
  :'prev_quarter'::integer
FROM prev p
WHERE NOT EXISTS (SELECT 1 FROM place c WHERE c.place_id = p.place_id)
  -- 번호만 새로 발급된 경우를 걸러낸다
  AND NOT EXISTS (
    SELECT 1 FROM place c
    WHERE c.name = p.name AND c.lon = p.lon AND c.lat = p.lat
  )
  -- 업종 코드가 이번 분기에 사라졌으면 FK에 걸린다. 분류 개편 때 실제로 생길 수 있다.
  AND EXISTS (SELECT 1 FROM industry i WHERE i.code = p.industry_code)
ORDER BY p.place_id;

-- ── 새로 생긴 곳 ──────────────────────────────────────────────────
-- 좌표를 복사하지 않는다. place에 살아 있으므로 id만 들고 조인한다.
INSERT INTO place_opened (place_id, first_seen)
SELECT c.place_id, :'curr_quarter'::integer
FROM place c
WHERE NOT EXISTS (SELECT 1 FROM prev p WHERE p.place_id = c.place_id)
  AND NOT EXISTS (
    SELECT 1 FROM prev p
    WHERE p.name = c.name AND p.lon = c.lon AND p.lat = c.lat
  );

ANALYZE place_opened;
ANALYZE place_closed;

COMMIT;

-- staging에 이전 분기가 남아 있으면 transform.sql이 그걸로 place를 갈아엎는다.
-- 최신 분기가 조용히 6개월 전으로 되돌아가는 사고라 여기서 비운다.
TRUNCATE staging_place;
