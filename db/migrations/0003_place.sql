-- 정제 스키마. staging_place를 실사한 결과를 근거로 설계했다.
--
-- 실사 결과 (인천 2026-06, 136,995행):
--   · 상가업소번호 전건 유일          → 자연키를 그대로 PK로 쓴다
--   · 좌표 결측/파싱실패 0건          → lon/lat NOT NULL
--   · 업종 코드가 접두어 계층 100%    → 소분류코드만 갖고 상위를 유도할 수 있다
--   · 모든 코드→명이 1:1              → 분류/지역명을 안전하게 분리하거나 비정규화할 수 있다
--   · 호정보·동정보 100% 빈값         → 컬럼 자체를 만들지 않는다

-- ── 업종 분류 (대 → 중 → 소 3단계) ────────────────────────────────
-- 원본은 매 행마다 코드·명을 6개 컬럼으로 중복해서 들고 있다.
-- 246개뿐인 값이 13만 행에 반복되므로 분리한다.
CREATE TABLE industry (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  level       smallint NOT NULL CHECK (level BETWEEN 1 AND 3),  -- 1=대, 2=중, 3=소
  parent_code text REFERENCES industry(code)
);

CREATE INDEX industry_parent_idx ON industry (parent_code);

COMMENT ON TABLE industry IS
  '상권업종 분류 트리. 코드가 접두어 구조라(G2 → G204 → G20404) parent_code를 접두어로 유도한다.';

-- ── 상가업소 ──────────────────────────────────────────────────────
CREATE TABLE place (
  place_id        text PRIMARY KEY,                       -- 상가업소번호
  name            text NOT NULL,
  branch_name     text,                                   -- 지점명 (90% 빈값이라 NULL 허용)

  industry_code   text NOT NULL REFERENCES industry(code),-- 소분류 코드. 상위는 조인으로 얻는다
  ksic_code       text,                                   -- 표준산업분류
  ksic_name       text,

  -- 지역명은 비정규화한다. 코드→명이 1:1이라 정규화해도 얻는 게 없고,
  -- 목록 조회마다 지역 테이블을 조인하는 비용만 늘어난다.
  -- (분기 스냅샷이라 이름이 바뀌면 그 분기 데이터에는 바뀐 이름이 맞다)
  sido_code       text NOT NULL,
  sido_name       text NOT NULL,
  sigungu_code    text NOT NULL,
  sigungu_name    text NOT NULL,
  adm_dong_code   text NOT NULL,                          -- 행정동 (집계 단위)
  adm_dong_name   text NOT NULL,
  legal_dong_code text,
  legal_dong_name text,

  lot_address     text,
  road_address    text,
  building_name   text,

  -- 층은 'B1', '지하1' 같은 값이 섞여 있어 원문을 버리지 않는다.
  -- 숫자로 해석되는 것만 floor_no에 담고, 나머지는 floor_raw로 남긴다.
  -- 1층 여부는 상권 분석에서 의미가 커서 버릴 수 없는 정보다.
  floor_raw       text,
  floor_no        smallint,
  -- 'B105' 같은 호실번호로 보이는 값이 층수로 둔갑하지 않게 막는다
  CONSTRAINT place_floor_sane CHECK (floor_no IS NULL OR floor_no BETWEEN -10 AND 200),

  lon             double precision NOT NULL,
  lat             double precision NOT NULL,

  -- 좌표가 한국 밖이면 좌표계를 잘못 읽은 것이다. 다음 분기 적재에서 조용히 틀리는 걸 막는다.
  CONSTRAINT place_coord_in_korea CHECK (lon BETWEEN 124 AND 132 AND lat BETWEEN 33 AND 39),

  -- 거리 계산의 단일 진실. lon/lat과 어긋날 수 없도록 생성 컬럼으로 둔다.
  -- geometry(4326)가 아니라 geography인 이유는 db/checks/distance_srid.sql 참고:
  -- 4326에서 ST_Distance의 단위는 미터가 아니라 도(degree)다.
  geom geography(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED
);

-- 반경 검색(ST_DWithin)의 핵심 인덱스
CREATE INDEX place_geom_idx ON place USING gist (geom);

-- "이 업종만" 필터
CREATE INDEX place_industry_idx ON place (industry_code);

-- 행정동 단위 집계
CREATE INDEX place_adm_dong_idx ON place (adm_dong_code);

-- 상호명 부분 검색. LIKE '%...%'는 B-tree를 못 타서 trigram이 필요하다.
CREATE INDEX place_name_trgm_idx ON place USING gin (name gin_trgm_ops);

COMMENT ON TABLE place IS
  '상가업소. 분기 스냅샷이며 staging_place에서 db/etl/transform.sql로 만든다.';
