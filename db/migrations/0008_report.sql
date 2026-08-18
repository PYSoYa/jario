-- 후보지 비교 리포트.
--
-- 계산 결과를 저장하지 않고 **입력만** 저장한다. 상가 데이터가 분기 스냅샷이라
-- 같은 입력이면 같은 결과가 나오고, 그래야 표가 커지지 않는다.
-- 대신 어느 분기 데이터로 만든 리포트인지는 남긴다. 다음 분기 데이터를 넣으면
-- 숫자가 달라지는데, 그걸 모르고 보면 공유한 사람과 본 사람이 다른 값을 보게 된다.
--
-- 로그인이 없다. 링크를 아는 사람은 볼 수 있다. 개인정보가 없는 공개 데이터
-- 분석 결과라 이 수준이 맞다고 봤다.

CREATE TABLE report (
  -- URL에 그대로 들어가므로 짧고 추측하기 어려운 값이어야 한다.
  id          text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{8,24}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- 비교 조건
  radius        integer NOT NULL CHECK (radius BETWEEN 50 AND 2000),
  industry_code text REFERENCES industry(code),

  -- 후보지 A / B
  a_lon double precision NOT NULL,
  a_lat double precision NOT NULL,
  a_label text,
  b_lon double precision NOT NULL,
  b_lat double precision NOT NULL,
  b_label text,

  CONSTRAINT report_a_in_korea CHECK (a_lon BETWEEN 124 AND 132 AND a_lat BETWEEN 33 AND 39),
  CONSTRAINT report_b_in_korea CHECK (b_lon BETWEEN 124 AND 132 AND b_lat BETWEEN 33 AND 39),

  -- 어느 분기 데이터로 만든 리포트인가. 지금 데이터와 다르면 화면에 알린다.
  data_version text NOT NULL
);

CREATE INDEX report_created_at_idx ON report (created_at DESC);

COMMENT ON TABLE report IS
  '후보지 A/B 비교 리포트. 입력만 저장하고 지표는 볼 때 다시 계산한다.';
