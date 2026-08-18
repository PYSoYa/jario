-- 폐업·개업 회전율.
--
-- 원본에는 개업일도 폐업일도 없다(39개 컬럼 전수 확인). 있는 것은 상가업소번호뿐이라,
-- 회전율은 분기 스냅샷 두 장을 대조해서만 구할 수 있다:
--   이전 분기에 있고 지금 없다  → 폐업
--   지금 있고 이전 분기에 없다  → 개업
--
-- ── place에 컬럼을 붙이지 않는 이유 ───────────────────────────────
-- 처음에는 place에 first_seen 컬럼을 두려 했다. 재보고 접었다.
--
--   UPDATE place SET first_seen = 202606;   -- 691,087행
--   → 350.5MB에서 691.3MB. 죽은 행 691,087.
--
-- PostgreSQL은 UPDATE 때 행을 새로 쓰고 옛 행을 죽은 채로 남긴다(MVCC). 컬럼 하나를
-- 채우는 것만으로 테이블이 두 배가 되고, VACUUM 전까지 그대로다. 운영은 무료 티어
-- 500MB에 343MB를 쓰고 있어 여유가 157MB뿐이다 — 이 UPDATE 한 번에 한도를 넘긴다.
--
-- 그래서 place는 읽기만 한다. 회전 정보는 아래 두 테이블에만 쓴다.
-- 부수 효과로 반경 조회·업종 집계·dong_stat·LQ가 쓰는 인덱스도 전혀 건드리지 않는다.

-- ── 개업: 최신 분기에 새로 나타난 곳 ──────────────────────────────
-- 좌표를 복사하지 않는다. 이 place_id는 place에 살아 있으므로 조인하면 되고,
-- 반경 검색은 place의 GiST 인덱스가 이미 처리한다.
CREATE TABLE place_opened (
  place_id   text PRIMARY KEY,
  first_seen integer NOT NULL          -- 처음 관측된 분기(YYYYMM). smallint에는 안 들어간다.
);

-- place(place_id)를 참조하지 않는다. transform.sql이 `TRUNCATE place`를 하는데,
-- 참조하는 테이블이 있으면 TRUNCATE가 거부돼 기존 적재 절차가 통째로 깨진다.
COMMENT ON TABLE place_opened IS
  '최신 분기에 새로 나타난 업소의 id. db/etl/churn.sql이 만든다. '
  'place를 FK로 참조하지 않는다 — transform.sql의 TRUNCATE place가 막히기 때문이다.';

-- ── 폐업: 이전 분기에만 있던 곳 ───────────────────────────────────
-- 이쪽은 place에 없는 행이라 좌표를 직접 들고 있어야 한다.
-- 지도에 찍고 업종별로 세는 데 필요한 것까지만 옮긴다. 표본 실측 358바이트/행.
CREATE TABLE place_closed (
  place_id       text PRIMARY KEY,
  name           text NOT NULL,
  industry_code  text NOT NULL REFERENCES industry(code),
  adm_dong_code  text NOT NULL,
  adm_dong_name  text NOT NULL,
  road_address   text,
  building_name  text,
  floor_no       smallint,

  lon            double precision NOT NULL,
  lat            double precision NOT NULL,
  CONSTRAINT place_closed_coord_in_korea
    CHECK (lon BETWEEN 124 AND 132 AND lat BETWEEN 33 AND 39),

  -- 마지막으로 관측된 분기(YYYYMM). 이 분기까지는 있었고 다음 분기에 사라졌다.
  last_seen      integer NOT NULL,

  geom geography(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED
);

-- place와 같은 질문을 받는다: 이 자리 반경 안에, 이 업종으로 몇 곳.
CREATE INDEX place_closed_geom_idx ON place_closed USING gist (geom);
CREATE INDEX place_closed_industry_idx ON place_closed (industry_code);

COMMENT ON TABLE place_closed IS
  '이전 분기에는 있었고 최신 분기에 사라진 업소. db/etl/churn.sql이 만든다. '
  '"폐업"이라고 부르지만 이전(移轉)·상호변경·데이터 정비도 섞여 있다 — 화면에도 그렇게 적는다. '
  'industry를 참조하므로 transform.sql의 TRUNCATE industry CASCADE에 함께 지워진다. '
  '기반 데이터를 다시 적재하면 회전 정보는 어차피 옛것이므로 그게 맞는 동작이다.';
