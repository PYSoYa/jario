#!/usr/bin/env bash
#
# CI용 시드 픽스처를 만든다. 전체 데이터(69만 행)를 저장소에 넣을 수 없으므로
# **행정동 몇 개만 온전히** 잘라낸다.
#
# 왜 행정동 단위인가: 좌표로 사각형을 잘라내면 동이 반쪽만 들어온다. 그러면
# "이 동의 업종 구성"이나 "반경 500m 안 전체"처럼 **완전한 이웃을 전제하는 테스트가
# 조용히 틀린 답을 낸다** — 실제로 그렇게 한 번 데였다.
#
# 두 분기를 함께 만든다. 최신 분기만 있으면 회전(사라짐·새로 생김)을 CI에서 검증할 수 없다.
#
# CSV 파싱은 python 으로 한다. awk 의 FPAT 은 gawk 전용이라 macOS 기본 awk 에서는
# 조용히 0행을 뱉는다 — 실제로 그렇게 픽스처를 빈 파일로 덮어썼다.
# 파일명 비교 전에 NFC 로 정규화한다. macOS 는 한글 파일명을 NFD 로 저장해서,
# 소스에 적은 "_서울_"(NFC)와 글자가 달라 하나도 안 걸린다. 화면에는 똑같아 보인다.
#
# 사용:
#   ./scripts/make-fixture.sh <최신분기_디렉터리> <이전분기_디렉터리>

set -euo pipefail
CUR="${1:?최신 분기 CSV 디렉터리}"
PREV="${2:?이전 분기 CSV 디렉터리}"
OUT=tests/fixtures

# 부평(인천 상권)과 역삼·서초(강남 상권)를 함께 둔다 — 상권 테스트가 두 지역을 다 본다.
export DONGS='부평1동,부평2동,부평3동,부평4동,부평5동,부평6동,부개1동,부개2동,서초2동,서초4동,역삼1동'

slice() {  # slice <디렉터리> <출력파일>
  python3 - "$1" "$2" <<'PY'
import csv, glob, os, sys, unicodedata
src, out = sys.argv[1], sys.argv[2]
want = set(os.environ["DONGS"].split(","))

# macOS 는 파일명을 NFD 로 정규화해 저장한다. 소스에 적은 "_서울_"(NFC)와 글자가
# 달라 in 검사가 통째로 실패한다 — 화면에는 똑같이 보이는데 하나도 안 걸린다.
def nfc(x):
    return unicodedata.normalize("NFC", x)

files = [f for f in sorted(glob.glob(os.path.join(src, "*.csv")))
         if any(k in nfc(os.path.basename(f)) for k in ("_서울_", "_인천_"))]
if not files:
    sys.exit(f"서울·인천 CSV를 찾지 못했습니다: {src}")
n = 0
with open(out, "w", encoding="utf-8", newline="") as w:
    writer = None
    for f in files:
        with open(f, encoding="utf-8", newline="") as r:
            rd = csv.DictReader(r)
            if writer is None:
                writer = csv.DictWriter(w, fieldnames=rd.fieldnames)
                writer.writeheader()
            for row in rd:
                if nfc(row["행정동명"]) in want:
                    writer.writerow(row); n += 1
print(n)
PY
}

echo "[1/2] 최신 분기"
cur_n=$(slice "$CUR" /tmp/seed.csv);      echo "  ${cur_n}행"
echo "[2/2] 이전 분기"
prev_n=$(slice "$PREV" /tmp/seed-prev.csv); echo "  ${prev_n}행"

# 0행을 그대로 쓰면 CI가 "적재 0건 성공"으로 통과한다. 실제로 한 번 덮어썼다.
for n in "$cur_n" "$prev_n"; do
  if [ "$n" -lt 10000 ]; then
    echo "행이 너무 적습니다(${n}). 행정동명이 바뀌었는지 확인하세요. 픽스처를 덮지 않습니다." >&2
    rm -f /tmp/seed.csv /tmp/seed-prev.csv
    exit 1
  fi
done

gzip -9 -c /tmp/seed.csv      > "$OUT/seed.csv.gz"
gzip -9 -c /tmp/seed-prev.csv > "$OUT/seed-prev.csv.gz"
rm -f /tmp/seed.csv /tmp/seed-prev.csv
ls -lh "$OUT"/*.gz | awk '{printf "  %s  %s\n", $9, $5}'
