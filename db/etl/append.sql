-- staging_place의 내용을 place/industry에 **덧붙인다**. 기존 데이터를 지우지 않는다.
--
-- transform.sql(전체 재생성)과 달리 지역을 나눠 넣기 위한 것이다.
-- 전국을 한 번에 올리면 staging과 place가 동시에 존재해 무료 티어 용량을 넘긴다.
-- 청크마다 staging을 비우고 이 파일을 돌리면 최대 사용량이 크게 줄어든다.
--
-- 같은 청크를 두 번 돌려도 안전하다(ON CONFLICT DO NOTHING).
--
-- 실행: db/etl/append.sql (scripts/push-region.sh 가 호출)

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM staging_place;
  IF n = 0 THEN
    RAISE EXCEPTION 'staging_place가 비어 있습니다. CSV를 먼저 COPY 하세요.';
  END IF;
END $$;

-- 업종 분류는 지역마다 조금씩 다르다(서울에 있고 인천에 없는 소분류가 있다).
-- 이미 있는 코드는 건너뛴다.
INSERT INTO industry (code, name, level, parent_code)
SELECT DISTINCT 상권업종대분류코드, 상권업종대분류명, 1, NULL FROM staging_place
ON CONFLICT (code) DO NOTHING;

INSERT INTO industry (code, name, level, parent_code)
SELECT DISTINCT 상권업종중분류코드, 상권업종중분류명, 2, 상권업종대분류코드 FROM staging_place
ON CONFLICT (code) DO NOTHING;

INSERT INTO industry (code, name, level, parent_code)
SELECT DISTINCT 상권업종소분류코드, 상권업종소분류명, 3, 상권업종중분류코드 FROM staging_place
ON CONFLICT (code) DO NOTHING;

INSERT INTO place (
  place_id, name, branch_name,
  industry_code, ksic_code, ksic_name,
  sido_code, sido_name, sigungu_code, sigungu_name,
  adm_dong_code, adm_dong_name, legal_dong_code, legal_dong_name,
  lot_address, road_address, building_name,
  floor_raw, floor_no,
  lon, lat
)
SELECT
  btrim(상가업소번호),
  btrim(상호명),
  NULLIF(btrim(지점명), ''),

  btrim(상권업종소분류코드),
  NULLIF(btrim(표준산업분류코드), ''),
  NULLIF(btrim(표준산업분류명), ''),

  btrim(시도코드), btrim(시도명),
  btrim(시군구코드), btrim(시군구명),
  btrim(행정동코드), btrim(행정동명),
  NULLIF(btrim(법정동코드), ''), NULLIF(btrim(법정동명), ''),

  NULLIF(btrim(지번주소), ''),
  NULLIF(btrim(도로명주소), ''),
  NULLIF(btrim(건물명), ''),

  NULLIF(btrim(층정보), ''),
  -- 층 정규화 규칙은 transform.sql 과 동일하다. 근거는 그쪽 주석 참고.
  CASE WHEN floor_candidate BETWEEN -10 AND 200 THEN floor_candidate END,

  경도::double precision,
  위도::double precision
FROM (
  SELECT
    s.*,
    CASE
      WHEN btrim(층정보) ~ '^-?[0-9]+$' THEN btrim(층정보)::int
      WHEN btrim(층정보) ~ '^[Bb]0*[0-9]{1,2}$'
        THEN -(regexp_replace(btrim(층정보), '^[Bb]0*', '')::int)
      WHEN btrim(층정보) = '지' THEN -1
      ELSE NULL
    END AS floor_candidate
  FROM staging_place s
) s
ON CONFLICT (place_id) DO NOTHING;

COMMIT;
