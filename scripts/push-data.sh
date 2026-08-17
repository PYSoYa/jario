#!/usr/bin/env bash
#
# 원격 DB(Supabase)에 스키마와 인천 데이터를 올린다.
#
# psql을 로컬에 설치하지 않고 jario-db 컨테이너 안의 psql을 쓴다.
# CSV가 이미 컨테이너에 /data로 마운트돼 있어서, 파일을 옮기지 않고
# 컨테이너 → 원격으로 바로 스트리밍할 수 있다.
#
# 사용:
#   REMOTE_DATABASE_URL='postgresql://postgres:PW@db.xxx.supabase.co:5432/postgres' \
#     ./scripts/push-data.sh '소상공인시장진흥공단_상가(상권)정보_인천_202606.csv'
#
# 주의: 풀러(6543)가 아니라 직접 연결(5432)을 써야 한다.
#       트랜잭션 모드 풀러로는 COPY와 대형 트랜잭션이 안정적으로 돌지 않는다.

set -euo pipefail

: "${REMOTE_DATABASE_URL:?REMOTE_DATABASE_URL 을 설정하세요}"
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
HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$REMOTE_DATABASE_URL")
echo "대상 호스트 : ${HOST}"
echo "올릴 파일   : data/${CSV}"
echo "수행할 일   : 마이그레이션 → staging_place 재적재 → place/industry 재생성"
echo
read -r -p "진행할까요? (yes 입력) " answer
[ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }

echo
echo "[1/3] 마이그레이션"
DATABASE_URL="$REMOTE_DATABASE_URL" node scripts/migrate.ts

echo
echo "[2/3] CSV 적재 (컨테이너 → 원격 스트리밍)"
# \copy 는 클라이언트 측 복사라 원격 서버에 파일이 없어도 된다.
docker exec -i jario-db psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE staging_place;"
docker exec -i jario-db psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "\\copy staging_place FROM '/data/${CSV}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"

echo
echo "[3/3] 정제 (staging → place/industry)"
docker exec -i jario-db psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=1 -f - < db/etl/transform.sql

echo
echo "확인"
docker exec -i jario-db psql "$REMOTE_DATABASE_URL" -X -c \
  "SELECT (SELECT count(*) FROM place) AS place, (SELECT count(*) FROM industry) AS industry;"
