#!/usr/bin/env bash
# 本番 Firestore の読み取り量とエラー応答を日別に出す（読み取りのみ・本番は変更しない）。
#
#   bash check-firestore-usage.sh          # 直近14日を日別
#   bash check-firestore-usage.sh 30       # 直近30日を日別
#   bash check-firestore-usage.sh 0.1 60   # 直近2.4時間を1分きざみ（ALLを押した瞬間の特定用）
#
# 「いつから」「どのエラーが」出ているかを特定する。
# 障害の開始日に読み取りの急増や RESOURCE_EXHAUSTED / DEADLINE_EXCEEDED が並んでいれば、
# データではなく読み取り量が原因。
set -uo pipefail

PROJECT="${PRODUCTION_PROJECT_ID:-v-athome-cafe-app}"
DAYS="${1:-14}"
ALIGN="${2:-86400}"   # 集計のきざみ（秒）。60 にすると分単位で見られる。
TOKEN="$(gcloud auth print-access-token 2>/dev/null)"
if [[ -z "${TOKEN}" ]]; then
  echo "gcloud のアクセストークンを取得できませんでした。" >&2
  exit 1
fi

# 小数の日数も扱えるように秒へ換算する。
SECONDS_BACK="$(python3 -c "print(int(float('${DAYS}') * 86400))")"
START="$(date -u -d "${SECONDS_BACK} seconds ago" +%Y-%m-%dT%H:%M:%SZ)"
END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "# project=${PROJECT}  期間: ${START} 〜 ${END}"

cat >"${WORK}/render.py" <<'PY'
import os, sys, json
from collections import defaultdict

label = sys.argv[1]
keys = sys.argv[2:]
# きざみが1日未満なら分まで表示する（ALLを押した瞬間と突き合わせるため）。
align = int(os.environ.get("ALIGN", "86400"))
cut = 10 if align >= 86400 else 16

try:
    payload = json.load(sys.stdin)
except Exception:
    print("  取得できませんでした")
    sys.exit(0)

if "error" in payload:
    print("  取得できませんでした: %s" % payload["error"].get("message"))
    sys.exit(0)

series = payload.get("timeSeries") or []
if not series:
    print("  データがありません（指標が記録されていない可能性があります）")
    sys.exit(0)

# 日付 -> ラベル -> 値
table = defaultdict(lambda: defaultdict(float))
names = set()
for s in series:
    parts = [str(s.get("metric", {}).get("labels", {}).get(k, "-")) for k in keys]
    name = " / ".join(parts) if parts else label
    names.add(name)
    for p in s.get("points", []):
        day = (p.get("interval", {}).get("endTime") or "")[:cut].replace("T", " ")
        v = p.get("value", {})
        val = v.get("int64Value") or v.get("doubleValue") or 0
        table[day][name] += float(val)

ordered = sorted(names, key=lambda n: -sum(table[d][n] for d in table))[:8]
width = max([len(n) for n in ordered] + [10])

print("  %-16s %s" % ("日時(UTC)", " ".join("%*s" % (width, n) for n in ordered)))
for day in sorted(table):
    row = " ".join("%*s" % (width, format(int(table[day][n]), ",")) for n in ordered)
    print("  %-16s %s" % (day, row))
PY

fetch() {
  local filter="$1"; shift
  curl -sS -G "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-urlencode "filter=${filter}" \
    --data-urlencode "interval.startTime=${START}" \
    --data-urlencode "interval.endTime=${END}" \
    --data-urlencode "aggregation.alignmentPeriod=${ALIGN}s" \
    --data-urlencode "aggregation.perSeriesAligner=ALIGN_SUM" \
    --data-urlencode "aggregation.crossSeriesReducer=REDUCE_SUM" \
    "$@"
}

echo
echo "=================================================================="
echo "1) ドキュメント読み取り件数（日別）"
echo "=================================================================="
echo "   ★ 障害の直前に急増していれば、読み取り量が原因です"
fetch 'metric.type="firestore.googleapis.com/document/read_count"' \
  --data-urlencode "aggregation.groupByFields=metric.label.type" \
  | ALIGN="${ALIGN}" python3 "${WORK}/render.py" reads type

echo
echo "=================================================================="
echo "2) API 応答コード別のリクエスト数（日別）"
echo "=================================================================="
echo "   ★ RESOURCE_EXHAUSTED / DEADLINE_EXCEEDED / PERMISSION_DENIED が"
echo "     ある日から出ていれば、その日が障害の開始日です"
fetch 'metric.type="firestore.googleapis.com/api/request_count"' \
  --data-urlencode "aggregation.groupByFields=metric.label.response_code" \
  | ALIGN="${ALIGN}" python3 "${WORK}/render.py" requests response_code

echo
echo "=================================================================="
echo "3) エラーになった API を種類別に（日別）"
echo "=================================================================="
fetch 'metric.type="firestore.googleapis.com/api/request_count" AND metric.label.response_code!="OK"' \
  --data-urlencode "aggregation.groupByFields=metric.label.api_method" \
  --data-urlencode "aggregation.groupByFields=metric.label.response_code" \
  | ALIGN="${ALIGN}" python3 "${WORK}/render.py" errors api_method response_code

echo
echo "----"
echo "読み方:"
echo "・1) が最近になって跳ね上がっている → ALL の読み取り量が限界を超えた可能性"
echo "・2) に OK 以外が並び始めた日 → それが障害の開始日"
echo "・どちらも平常 → サーバー側は正常。ブラウザ側（端末・アカウント）の問題を疑う"
