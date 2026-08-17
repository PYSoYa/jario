-- staging_place(원본 그대로) → industry / place(정제)
--
-- 멱등하다. 분기 데이터를 새로 받으면 staging에 COPY한 뒤 이 파일을 다시 돌리면 된다.
-- 실행: pnpm data:transform

BEGIN;

-- staging이 비어 있으면 아무것도 하지 않고 실패한다.
-- 이게 없으면 place를 통째로 비운 뒤 0건을 넣고 "성공"으로 끝난다.
-- 적재 공간을 아끼려고 staging을 비워두는 경우가 있어 실제로 밟기 쉬운 함정이다.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM staging_place;
  IF n = 0 THEN
    RAISE EXCEPTION 'staging_place가 비어 있습니다. CSV를 먼저 COPY 하세요 (README의 "데이터 적재").';
  END IF;
END $$;

-- place가 industry를 참조하므로 순서대로 비운다.
TRUNCATE place;
TRUNCATE industry CASCADE;

-- ── 업종 분류 트리 ────────────────────────────────────────────────
-- 코드가 접두어 구조라(G2 → G204 → G20404) 상위 코드를 그대로 부모로 쓴다.
-- FK 때문에 대 → 중 → 소 순서로 넣어야 한다.

INSERT INTO industry (code, name, level, parent_code)
SELECT DISTINCT 상권업종대분류코드, 상권업종대분류명, 1, NULL
FROM staging_place;

INSERT INTO industry (code, name, level, parent_code)
SELECT DISTINCT 상권업종중분류코드, 상권업종중분류명, 2, 상권업종대분류코드
FROM staging_place;

INSERT INTO industry (code, name, level, parent_code)
SELECT DISTINCT 상권업종소분류코드, 상권업종소분류명, 3, 상권업종중분류코드
FROM staging_place;

-- ── 상가업소 ──────────────────────────────────────────────────────
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
  -- 원본은 결측을 빈 문자열로 표현한다. ''와 NULL이 섞이면 조건문이 지저분해지므로 NULL로 통일한다.
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
  -- 범위를 벗어나면 층이 아니라 호실번호다. 숫자 층과 지하 표기 양쪽에
  -- 같은 가드를 건다.
  --
  -- 처음에는 숫자 층에만 범위를 걸고 지하는 두 자리까지 무조건 받았는데,
  -- 서울 데이터에서 B17·B26·B40이 나와 CHECK 제약에 걸렸다. 국내 최심도는
  -- B7~B8 수준이라 지하 40층은 존재하지 않는다 — 호실번호다.
  CASE WHEN floor_candidate BETWEEN -10 AND 200 THEN floor_candidate END,

  경도::double precision,
  위도::double precision
FROM (
  SELECT
    s.*,
    -- 실사에서 확인된 비숫자 표기: '지'(지하), 'B1'~'B5', 'B02', 'B08',
    -- '반'·'반지층'(반지하), 그리고 'B103'·'15015' 같은 호실번호.
    CASE
      WHEN btrim(층정보) ~ '^-?[0-9]+$'
        THEN btrim(층정보)::int
      -- 'B1' → -1, 'B02' → -2
      WHEN btrim(층정보) ~ '^[Bb]0*[0-9]{1,2}$'
        THEN -(regexp_replace(btrim(층정보), '^[Bb]0*', '')::int)
      -- '지' = 지하. 몇 층인지 알 수 없어 지하1층으로 본다.
      WHEN btrim(층정보) = '지' THEN -1
      -- '반'·'반지층'은 층수로 환산할 근거가 없다. 원문만 floor_raw에 남는다.
      ELSE NULL
    END AS floor_candidate
  FROM staging_place s
) s;

-- 통계가 없으면 플래너가 새 인덱스를 안 쓸 수 있다. 성능 측정 전에 갱신한다.
ANALYZE industry;
ANALYZE place;

COMMIT;
