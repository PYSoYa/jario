#!/usr/bin/env bash
#
# 원격 DB(Supabase)에 스키마와 인천 데이터를 올린다.
#
# psql을 로컬에 설치하지 않고 jario-db 컨테이너 안의 psql을 쓴다.
# CSV가 이미 컨테이너에 /data로 마운트돼 있어서, 파일을 옮기지 않고
# 컨테이너 → 원격으로 바로 스트리밍할 수 있다.
#
# 사용:
#   ./scripts/push-data.sh '소상공인시장진흥공단_상가(상권)정보_인천_202606.csv'
#   (SUPABASE_SESSION_URL 은 .env.local 에 있다)
#
# 어느 연결을 쓰는가:
#   세션 모드 풀러(5432) — 이 스크립트. COPY와 대형 트랜잭션을 지원한다.
#   트랜잭션 모드 풀러(6543) — 앱(Vercel)용. COPY에는 쓸 수 없다.
#
#   직접 연결(db.<ref>.supabase.co)은 쓰지 않는다. IPv6(AAAA) 레코드만 있고
#   A 레코드가 없어(IPv4는 Supabase 유료 부가기능) 환경에 따라 getaddrinfo가
#   해석하지 못한다. 실제로 이 개발 환경에서 ENOTFOUND 로 막혔다.

set -euo pipefail

# .env.local 에서 SUPABASE_SESSION_URL 을 읽는다(이미 환경에 있으면 그걸 쓴다).
if [ -z "${SUPABASE_SESSION_URL:-}" ] && [ -f .env.local ]; then
  SUPABASE_SESSION_URL=$(grep -E '^SUPABASE_SESSION_URL=' .env.local | head -1 | cut -d= -f2-)
  export SUPABASE_SESSION_URL
fi

: "${SUPABASE_SESSION_URL:?SUPABASE_SESSION_URL 을 설정하세요 (.env.local)}"
CSV="${1:?data/ 안의 CSV 파일명을 인자로 주세요}"

if [ ! -f "data/${CSV}" ]; then
  echo "data/${CSV} 가 없습니다." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx jario-db; then
  echo "jario-db 컨테이너가 실행 중이 아닙니다. pnpm db:up 을 먼저 실행하세요." >&2
  exit 1
fi

# 어디에 쓰는지 먼저 보여주고 확인받는다. 되돌리기 어려운 작업이다.
HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SUPABASE_SESSION_URL")
echo "대상 호스트 : ${HOST}"
echo "올릴 파일   : data/${CSV}"
echo "수행할 일   : 마이그레이션 → staging_place 재적재 → place/industry 재생성"
echo
read -r -p "진행할까요? (yes 입력) " answer
[ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }

echo
echo "[1/3] 마이그레이션"
DATABASE_URL="$SUPABASE_SESSION_URL" node scripts/migrate.ts

echo
echo "[2/3] CSV 적재 (컨테이너 → 원격 스트리밍)"
# \copy 는 클라이언트 측 복사라 원격 서버에 파일이 없어도 된다.
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE staging_place;"
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -v ON_ERROR_STOP=1 \
  -c "\\copy staging_place FROM '/data/${CSV}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"

echo
echo "[3/3] 정제 (staging → place/industry)"
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f - < db/etl/transform.sql

echo
echo "확인"
docker exec -i jario-db psql "$SUPABASE_SESSION_URL" -X -c \
  "SELECT (SELECT count(*) FROM place) AS place, (SELECT count(*) FROM industry) AS industry;"
