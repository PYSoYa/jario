#!/usr/bin/env bash
#
# 새 분기 데이터로 갈아엎는다. 로컬에서 끝까지 돌린 뒤 운영에 올린다.
#
# 이 절차는 석 달에 한 번만 밟는다. 그래서 잊는다 — 순서를 틀리면 조용히 망가진다:
#   · 차분을 먼저 돌리면 최신 분기가 아직 없어 전부 "새로 생김"이 된다
#   · staging에 이전 분기를 남겨두면 다음 transform이 place를 6개월 전으로 되돌린다
#   · 원격에서 차분을 돌리면 이전 분기 347MB를 올려야 해 무료 티어 한도를 넘는다
#
# 그래서 순서를 코드로 고정한다.
#
# 사용:
#   ./scripts/refresh-quarter.sh <최신분기_디렉터리> <이전분기_디렉터리> <YYYYMM> <이전YYYYMM>
# 예:
#   ./scripts/refresh-quarter.sh ~/Downloads/...20260930 ~/Downloads/...20260630 202609 202606
#
# 데이터는 https://www.data.go.kr/data/15083033/fileData.do 에서 직접 받는다
# (로그인 없이 받을 수 있고, 과거 분기는 "주기성 과거 데이터" 탭에 있다).

set -euo pipefail
CUR="${1:?최신 분기 CSV 디렉터리}"
PREV="${2:?이전 분기 CSV 디렉터리}"
CURQ="${3:?최신 분기 YYYYMM (예: 202609)}"
PREVQ="${4:?이전 분기 YYYYMM (예: 202606)}"

[ -d "$CUR" ]  || { echo "없는 디렉터리: $CUR" >&2; exit 1; }
[ -d "$PREV" ] || { echo "없는 디렉터리: $PREV" >&2; exit 1; }
docker ps --format '{{.Names}}' | grep -qx jario-db || {
  echo "jario-db 컨테이너가 없습니다. pnpm db:up 을 먼저 실행하세요." >&2; exit 1; }

Q() { docker exec -i jario-db psql -U jario -d jario -v ON_ERROR_STOP=1 "$@" </dev/null; }
copy_region() {  # copy_region <디렉터리> <지역> <분기>
  local f="$1/소상공인시장진흥공단_상가(상권)정보_$2_$3.csv"
  [ -f "$f" ] || { echo "없는 파일: $f" >&2; exit 1; }
  cp "$f" "data/_load.csv"
  Q -q -c "\copy staging_place FROM '/data/_load.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
  rm -f data/_load.csv
}

echo "== 1/6 스키마"
pnpm db:migrate

echo "== 2/6 최신 분기($CURQ) → staging"
Q -q -c "TRUNCATE staging_place;"
for r in 인천 서울; do copy_region "$CUR" "$r" "$CURQ"; done
Q -X -c "SELECT count(*) AS staging FROM staging_place;"

echo "== 3/6 정제 (staging → place/industry) + 파생 통계"
docker exec -i jario-db psql -U jario -d jario -v ON_ERROR_STOP=1 -q -f - < db/etl/transform.sql
docker exec -i jario-db psql -U jario -d jario -v ON_ERROR_STOP=1 -q -f - < db/etl/refresh-stats.sql

echo "== 4/6 이전 분기($PREVQ) → staging → 차분"
Q -q -c "TRUNCATE staging_place;"
for r in 인천 서울; do copy_region "$PREV" "$r" "$PREVQ"; done
docker exec -i jario-db psql -U jario -d jario -v ON_ERROR_STOP=1 -q \
  -v prev_quarter="$PREVQ" -v curr_quarter="$CURQ" -f - < db/etl/churn.sql

echo "== 5/6 로컬 확인"
Q -X -c "SELECT (SELECT count(*) FROM place) place,
                (SELECT count(*) FROM place_closed) 사라짐,
                (SELECT count(*) FROM place_opened) 새로생김,
                (SELECT count(*) FROM staging_place) staging_잔여;"
pnpm test

echo
echo "== 6/6 남은 일 (사람이 판단할 것) =="
cat <<'NEXT'
  1. src/lib/places.ts 의 CHURN_FROM / CHURN_TO 를 새 분기로 고친다
  2. src/lib/compare.ts 의 DATA_VERSION 을 고친다
  3. 상권 공실률·임대료가 갱신됐으면 db/migrations 에 새 마이그레이션으로 넣는다
     (market_district 는 참조 데이터라 마이그레이션에 산다)
  4. ./scripts/make-fixture.sh <최신> <이전>  — CI 픽스처도 새 분기로
  5. ./scripts/push-data.sh  → 운영 place 갱신
     ./scripts/push-churn.sh → 운영 회전 테이블 갱신
     (차분은 로컬에서 끝났다. 원격에는 결과만 올린다)
  6. README 의 "배포된 DB 상태" 수치를 실측값으로 고친다
NEXT
