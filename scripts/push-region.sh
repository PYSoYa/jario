#!/usr/bin/env bash
#
# 지역 CSV 하나를 원격 DB에 **덧붙인다**. 기존 데이터는 지우지 않는다.
#
# 왜 청크로 나누는가:
#   staging과 place가 동시에 존재하는 순간이 용량 최대치다. 전국을 한 번에
#   올리면 staging 354MB + place 323MB = 677MB로 무료 티어(500MB)를 넘는다.
#   20만 행씩 나누면 staging이 103MB로 줄어 최대 426MB에 머문다.
#
# 사용:
#   ./scripts/push-region.sh '소상공인시장진흥공단_상가(상권)정보_서울_202606.csv' [청크크기]
#
# 처음 한 번은 ./scripts/push-data.sh 로 스키마를 만들고 첫 지역을 넣어야 한다.

set -euo pipefail

if [ -z "${SUPABASE_SESSION_URL:-}" ] && [ -f .env.local ]; then
  SUPABASE_SESSION_URL=$(grep -E '^SUPABASE_SESSION_URL=' .env.local | head -1 | cut -d= -f2-)
  export SUPABASE_SESSION_URL
fi
: "${SUPABASE_SESSION_URL:?SUPABASE_SESSION_URL 을 설정하세요 (.env.local)}"

CSV="${1:?data/ 안의 CSV 파일명을 인자로 주세요}"
CHUNK="${2:-200000}"

[ -f "data/${CSV}" ] || { echo "data/${CSV} 가 없습니다." >&2; exit 1; }
docker ps --format '{{.Names}}' | grep -qx jario-db || {
  echo "jario-db 컨테이너가 실행 중이 아닙니다. pnpm db:up 을 먼저 실행하세요." >&2; exit 1; }

# docker exec -i 는 stdin을 물고 들어간다. </dev/null 을 주지 않으면
# 확인 프롬프트에 파이프로 넣은 입력까지 먹어버려서, 그다음 read가 EOF를 만나
# set -e 로 스크립트가 조용히 죽는다. 실제로 그렇게 한 번 멈췄다.
psql_remote() { docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -v ON_ERROR_STOP=1 "$@" </dev/null; }
# SQL 파일을 흘려넣을 때만 stdin을 쓴다.
psql_stdin() { docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f -; }

HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SUPABASE_SESSION_URL")
ROWS=$(( $(wc -l < "data/${CSV}") - 1 ))
BEFORE=$(psql_remote -X -t -A -c "SELECT count(*) FROM place;")

echo "대상 호스트 : ${HOST}"
echo "올릴 파일   : data/${CSV}  (약 ${ROWS} 행)"
echo "청크 크기   : ${CHUNK} 행"
echo "현재 place  : ${BEFORE} 행 (덧붙이며, 기존 데이터는 지우지 않습니다)"
echo
read -r -p "진행할까요? (yes 입력) " answer
[ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }

# 헤더를 유지한 채 청크로 나눈다.
CHUNK_DIR="data/_chunks"
rm -rf "$CHUNK_DIR"; mkdir -p "$CHUNK_DIR"
awk -v n="$CHUNK" -v dir="$CHUNK_DIR" '
  NR==1 { header=$0; next }
  { if ((NR-2) % n == 0) { f=sprintf("%s/part_%03d.csv", dir, ++i); print header > f } print > f }
' "data/${CSV}"

echo
echo "청크 $(ls "$CHUNK_DIR" | wc -l | tr -d ' ')개 생성"

for part in "$CHUNK_DIR"/part_*.csv; do
  name=$(basename "$part")
  printf "  %s 적재… " "$name"
  psql_remote -q -c "TRUNCATE staging_place;"
  psql_remote -q -c "\\copy staging_place FROM '/data/_chunks/${name}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
  psql_stdin -q < db/etl/append.sql
  echo "완료 ($(psql_remote -X -t -A -c 'SELECT count(*) FROM place;') 행)"
done

# staging은 비워둔다. 남겨두면 무료 티어 용량을 그대로 잡아먹는다.
psql_remote -q -c "TRUNCATE staging_place;"
psql_remote -q -c "ANALYZE place; ANALYZE industry;"
rm -rf "$CHUNK_DIR"

echo
psql_remote -X -c "
  SELECT (SELECT count(*) FROM place) AS place,
         (SELECT count(*) FROM industry) AS industry,
         pg_size_pretty(pg_database_size(current_database())) AS db크기;"
