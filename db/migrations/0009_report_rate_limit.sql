-- 리포트 생성 제한.
--
-- 로그인이 없어서 POST /api/reports 는 누구나 무제한으로 부를 수 있다.
-- 스크립트 한 번이면 무료 티어 DB(370MB/500MB)가 리포트로 찬다.
--
-- 서버리스라 프로세스 메모리에 카운터를 두면 인스턴스마다 따로 세어 소용이 없다.
-- DB에 세는 게 유일하게 맞는 곳이다.
--
-- IP를 그대로 저장하지 않고 해시를 저장한다. 개인정보를 남길 이유가 없고,
-- 필요한 건 "같은 곳에서 몇 번 왔나"뿐이다.
CREATE TABLE report_quota (
  ip_hash    text NOT NULL,
  window_at  timestamptz NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_at)
);

-- 지난 창(window)은 쓸모없다. 정리할 때 훑기 좋게 인덱스를 둔다.
CREATE INDEX report_quota_window_idx ON report_quota (window_at);

COMMENT ON TABLE report_quota IS
  '리포트 생성 횟수. 시간 단위 창으로 세고 지난 창은 정리한다.';
