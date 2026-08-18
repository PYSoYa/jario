#!/usr/bin/env bash
#
# 회전 테이블(place_opened / place_closed)을 원격 DB에 올린다.
#
# 왜 원격에서 차분을 돌리지 않는가:
#   차분에는 이전 분기 전체가 필요하다. CSV만 서울 278MB + 인천 69MB = 347MB인데,
#   운영은 무료 티어 500MB에 370MB를 쓰고 있어 여유가 130MB뿐이다. staging에 올리는
#   순간 한도를 넘긴다. 그래서 차분은 로컬에서 끝내고 **결과 두 테이블만** 올린다(24.6MB).
#
# 사용:
#   ./scripts/push-churn.sh        확인 후 진행
#   ./scripts/push-churn.sh -y     확인 생략
#
# 전제: 로컬에서 pnpm data:churn 을 이미 돌려 회전 테이블이 채워져 있어야 한다.

set -euo pipefail

if [ -z "${SUPABASE_SESSION_URL:-}" ] && [ -f .env.local ]; then
  SUPABASE_SESSION_URL=$(grep -E '^SUPABASE_SESSION_URL=' .env.local | head -1 | cut -d= -f2-)
  export SUPABASE_SESSION_URL
fi
: "${SUPABASE_SESSION_URL:?SUPABASE_SESSION_URL 을 설정하세요 (.env.local)}"

if ! docker ps --format '{{.Names}}' | grep -qx jario-db; then
  echo "jario-db 컨테이너가 실행 중이 아닙니다. pnpm db:up 을 먼저 실행하세요." >&2
  exit 1
fi

LOCAL="psql -U jario -d jario -v ON_ERROR_STOP=1"

# 올릴 게 없으면 원격을 비우기만 하고 끝난다. 조용한 사고라 먼저 막는다.
closed=$(docker exec -i jario-db $LOCAL -t -A -c "SELECT count(*) FROM place_closed" </dev/null)
opened=$(docker exec -i jario-db $LOCAL -t -A -c "SELECT count(*) FROM place_opened" </dev/null)
if [ "$closed" = "0" ] || [ "$opened" = "0" ]; then
  echo "로컬 회전 테이블이 비어 있습니다 (사라짐 $closed / 새로생김 $opened)." >&2
  echo "pnpm data:churn 을 먼저 실행하세요." >&2
  exit 1
fi

HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SUPABASE_SESSION_URL")
echo "대상 호스트 : ${HOST}"
echo "올릴 것     : 사라짐 ${closed}행 · 새로생김 ${opened}행 (약 25MB)"
echo "수행할 일   : 마이그레이션 → 회전 테이블 재적재"
echo

if [ "${1:-}" != "-y" ]; then
  read -r -p "진행할까요? (yes 입력) " answer
  [ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }
fi

echo "[1/4] 마이그레이션"
DATABASE_URL="$SUPABASE_SESSION_URL" node scripts/migrate.ts

echo
echo "[2/4] 로컬 → CSV 내보내기"
# 컨테이너의 /tmp 에 쓴다. data/ 는 읽기 전용으로 마운트돼 있어 쓸 수 없다.
# \copy 는 클라이언트(=컨테이너) 쪽 파일을 읽고 쓰므로 원격 적재에도 이 경로를 그대로 쓴다.
# geom은 생성 컬럼이라 넣지 않는다. 원격이 lon/lat에서 다시 만든다.
docker exec -i jario-db $LOCAL -c "\\copy (SELECT place_id,name,industry_code,adm_dong_code,adm_dong_name,road_address,building_name,floor_no,lon,lat,last_seen FROM place_closed) TO '/tmp/_churn_closed.csv' CSV" </dev/null
docker exec -i jario-db $LOCAL -c "\\copy (SELECT place_id,first_seen FROM place_opened) TO '/tmp/_churn_opened.csv' CSV" </dev/null

echo
echo "[3/4] 원격 적재"
REMOTE="psql $SUPABASE_SESSION_URL -v ON_ERROR_STOP=1"
docker exec -i jario-db $REMOTE -c "TRUNCATE place_closed; TRUNCATE place_opened;" </dev/null
docker exec -i jario-db $REMOTE -c "\\copy place_closed(place_id,name,industry_code,adm_dong_code,adm_dong_name,road_address,building_name,floor_no,lon,lat,last_seen) FROM '/tmp/_churn_closed.csv' CSV" </dev/null
docker exec -i jario-db $REMOTE -c "\\copy place_opened(place_id,first_seen) FROM '/tmp/_churn_opened.csv' CSV" </dev/null
docker exec -i jario-db $REMOTE -c "ANALYZE place_closed; ANALYZE place_opened;" </dev/null

echo
echo "[4/4] 확인"
docker exec -i jario-db $REMOTE -X -c \
  "SELECT (SELECT count(*) FROM place_closed) AS 사라짐, (SELECT count(*) FROM place_opened) AS 새로생김, pg_size_pretty(pg_database_size(current_database())) AS DB크기;" </dev/null

docker exec -i jario-db rm -f /tmp/_churn_closed.csv /tmp/_churn_opened.csv </dev/null
echo
echo "완료. 임시 CSV 제거함."
