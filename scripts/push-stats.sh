#!/usr/bin/env bash
#
# 원격 DB의 파생 통계(dong_stat, dong_industry_stat)를 다시 만든다.
#
# place/place_closed/place_opened 를 바꾼 뒤에는 반드시 돌려야 한다.
# 안 그러면 동네 비교와 자리 찾기가 옛 수를 답한다 — 에러는 안 난다.
#
# 원본이 아니라 집계만 다시 만들므로 CSV를 올릴 일이 없다.
#
# 사용: ./scripts/push-stats.sh [-y]

set -euo pipefail

if [ -z "${SUPABASE_SESSION_URL:-}" ] && [ -f .env.local ]; then
  SUPABASE_SESSION_URL=$(grep -E '^SUPABASE_SESSION_URL=' .env.local | head -1 | cut -d= -f2-)
  export SUPABASE_SESSION_URL
fi
: "${SUPABASE_SESSION_URL:?SUPABASE_SESSION_URL 을 설정하세요 (.env.local)}"
docker ps --format '{{.Names}}' | grep -qx jario-db || {
  echo "jario-db 컨테이너가 없습니다. pnpm db:up 을 먼저 실행하세요." >&2; exit 1; }

HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SUPABASE_SESSION_URL")
echo "대상 호스트 : ${HOST}"
echo "수행할 일   : 마이그레이션 → 파생 통계 재생성 (원본 테이블은 건드리지 않음)"
echo

if [ "${1:-}" != "-y" ]; then
  read -r -p "진행할까요? (yes 입력) " answer
  [ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }
fi

echo "[1/3] 마이그레이션"
DATABASE_URL="$SUPABASE_SESSION_URL" node scripts/migrate.ts

echo
echo "[2/3] 파생 통계 재생성"
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -v ON_ERROR_STOP=1 -q -f - < db/etl/refresh-stats.sql

echo
echo "[3/3] 확인"
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -X -c \
  "SELECT (SELECT count(*) FROM dong_stat) AS 동,
          (SELECT count(*) FROM dong_industry_stat) AS 동x업종,
          (SELECT sum(cnt) FROM dong_industry_stat) AS 업소합,
          (SELECT sum(closed) FROM dong_industry_stat) AS 사라짐합,
          pg_size_pretty(pg_database_size(current_database())) AS DB크기;" </dev/null
