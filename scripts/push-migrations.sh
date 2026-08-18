#!/usr/bin/env bash
#
# 원격 DB에 마이그레이션만 적용한다. 데이터 적재는 하지 않는다.
#
# 0011처럼 참조 데이터가 마이그레이션 안에 들어 있는 경우(상권 68행)에는
# 이것만 돌리면 끝난다. CSV를 옮길 일이 없다.
#
# 사용: ./scripts/push-migrations.sh [-y]

set -euo pipefail

if [ -z "${SUPABASE_SESSION_URL:-}" ] && [ -f .env.local ]; then
  SUPABASE_SESSION_URL=$(grep -E '^SUPABASE_SESSION_URL=' .env.local | head -1 | cut -d= -f2-)
  export SUPABASE_SESSION_URL
fi
: "${SUPABASE_SESSION_URL:?SUPABASE_SESSION_URL 을 설정하세요 (.env.local)}"

HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SUPABASE_SESSION_URL")
echo "대상 호스트 : ${HOST}"
echo "수행할 일   : db/migrations 중 미적용분 실행 (데이터 적재 없음)"
echo

if [ "${1:-}" != "-y" ]; then
  read -r -p "진행할까요? (yes 입력) " answer
  [ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }
fi

DATABASE_URL="$SUPABASE_SESSION_URL" node scripts/migrate.ts

echo
echo "확인"
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -X -c \
  "SELECT (SELECT count(*) FROM market_district) AS 상권,
          pg_size_pretty(pg_database_size(current_database())) AS DB크기;" </dev/null
