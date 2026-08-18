#!/usr/bin/env bash
#
# 빌드된 앱을 실제로 띄워놓고 HTTP로 훑는다.
#
# 왜 필요한가: OG 이미지는 유닛 테스트로 못 잡는다. node --test 는 JSX를 읽지
# 못하고, 무엇보다 Satori의 실패는 **빈 응답**으로 나온다 — 빌드는 통과하고
# 페이지도 멀쩡한데 미리보기만 죽는다. 실제로 한 번 겪었다
# ("Expected <div> to have explicit display: flex" → failed to pipe response).
# 그래서 진짜 PNG가 나오는지 바이트로 확인한다.
#
# 사용: BASE=http://localhost:3001 ./scripts/smoke.sh

set -euo pipefail
BASE="${BASE:-http://localhost:3001}"
fail=0

ok()   { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31mFAIL\033[0m %s\n" "$1"; fail=1; }

# curl 실패(빈 응답·연결 끊김)로 스크립트가 죽으면 안 된다. 그게 바로 잡아야 할
# 증상인데 set -e 가 먼저 스크립트를 끝내버려서 무엇이 실패했는지 안 보인다.
# 실제로 그렇게 종료코드 52만 남고 아무 메시지도 없었다.
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1" || echo "000"; }

check_status() {
  local url="$1" want="$2" label="$3" got
  got=$(status "$url")
  [ "$got" = "$want" ] && ok "$label ($got)" || bad "$label — 기대 $want, 실제 $got"
}

# PNG 인지 매직 바이트로 확인한다. 200이어도 빈 응답이면 여기서 걸린다.
check_png() {
  local url="$1" label="$2" tmp size sig
  tmp=$(mktemp)
  curl -s -o "$tmp" --max-time 60 "$url" || true
  size=$(wc -c < "$tmp" | tr -d ' ')
  sig=$(head -c 8 "$tmp" | od -An -tx1 | tr -d ' \n')
  if [ "$sig" = "89504e470d0a1a0a" ] && [ "$size" -gt 5000 ]; then
    ok "$label (PNG ${size}B)"
  else
    bad "$label — PNG가 아니거나 너무 작다 (${size}B, sig=${sig:-없음})"
  fi
  rm -f "$tmp"
}

echo "대상: $BASE"

check_status "$BASE/" 200 "메인 페이지"
check_status "$BASE/api/places/nearby?lon=126.7244&lat=37.4894&radius=500&limit=1" 200 "반경 조회"
check_status "$BASE/api/places/nearby?lon=999&lat=37" 400 "잘못된 좌표 거부"
check_status "$BASE/api/spot?lon=126.7244&lat=37.4894&radius=500" 200 "통합 조회"
check_status "$BASE/api/analysis/dong?industry=I21201" 200 "동네 분석"
check_status "$BASE/api/analysis/dong" 400 "업종 없는 동네 분석 거부"

check_png "$BASE/opengraph-image" "사이트 OG 이미지"

echo "리포트 생성"
body=$(curl -s --max-time 30 -X POST "$BASE/api/reports" \
  -H 'Content-Type: application/json' \
  -d '{"radius":500,"industry":"I21201",
       "a":{"lon":126.7244,"lat":37.4894,"label":"부평역"},
       "b":{"lon":127.0276,"lat":37.4979,"label":"강남역"}}')
id=$(node -e 'try{process.stdout.write(JSON.parse(process.argv[1]).id??"")}catch{}' "$body")

if [ -z "$id" ]; then
  bad "리포트 생성 — 응답: ${body:0:120}"
else
  ok "리포트 생성 ($id)"
  check_status "$BASE/r/$id" 200 "리포트 페이지"
  check_png "$BASE/r/$id/opengraph-image" "리포트 OG 이미지"

  # 미리보기와 본문이 다른 숫자를 말하면 안 된다. 페이지에 총계가 실제로 박혀 있는지 본다.
  html=$(curl -s --max-time 30 "$BASE/r/$id")
  if printf '%s' "$html" | grep -q "3,074"; then
    ok "리포트 본문에 실제 수치"
  else
    bad "리포트 본문에서 기대한 수치(3,074)를 찾지 못했다"
  fi

  # 자리를 재는 축이 리포트에서 빠지면 안 된다. 밀도만 비교하던 시절로 조용히 돌아간다.
  for row in "최근 6개월 회전" "공실률" "10평 월 임대료"; do
    printf '%s' "$html" | grep -q "$row" \
      && ok "리포트 행: $row" || bad "리포트에 '$row' 행이 없다"
  done

  # 좁은 화면에서 표가 세로로 무너지는 것을 막는 유일한 장치다.
  #
  # table-layout이 auto면 값 열의 내용이 항목 열을 짓눌러, 390px에서 항목 열이 40px까지
  # 줄고 설명 문구가 한 글자씩 세로로 흘렀다(페이지 높이 2,378px). 가로 넘침은 없어서
  # 기존 검사는 전부 통과했다.
  #
  # 이건 렌더 결과가 아니라 클래스 유무만 보는 좁은 검사다. 진짜 레이아웃 검증에는
  # 브라우저가 필요하다 — 여기서는 그 회귀 하나만 막는다.
  printf '%s' "$html" | grep -q "table-fixed" \
    && ok "리포트 표가 table-fixed" || bad "리포트 표에 table-fixed가 없다 — 좁은 화면에서 무너진다"
fi

# 로그인이 없어서 이 방어가 뚫리면 무료 티어 DB가 리포트로 찬다.
# 한도를 넘겼을 때 429가 나오는지, 그리고 그 전까지는 정상인지 본다.
echo "레이트 리밋"
over=""
for _ in $(seq 1 25); do
  over=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$BASE/api/reports" \
    -H 'Content-Type: application/json' \
    -d '{"radius":500,"a":{"lon":126.7244,"lat":37.4894},"b":{"lon":127.0276,"lat":37.4979}}' || echo 000)
  [ "$over" = "429" ] && break
done
[ "$over" = "429" ] && ok "한도 초과 시 429" || bad "한도를 넘겨도 막지 않는다 (마지막 $over)"

check_status "$BASE/r/doesnotexist" 404 "없는 리포트"
check_png "$BASE/r/doesnotexist/opengraph-image" "없는 리포트 OG (안내 이미지)"
check_status "$BASE/api/reports" 405 "리포트 GET 거부"

echo
[ "$fail" = 0 ] && echo "스모크 통과" || { echo "스모크 실패"; exit 1; }
