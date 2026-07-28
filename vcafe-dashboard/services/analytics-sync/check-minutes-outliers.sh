#!/usr/bin/env bash
# メイド個別実績ログの「滞在(分)」異常値を調査する（BigQueryへの読み取りのみ）。
#   bash check-minutes-outliers.sh
# 分の分布と、異常に大きい行の実例（種別・チケット・日時）を出して原因を絞り込む。
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DS="${BIGQUERY_DATASET:-}"
if [[ -z "${DS}" ]]; then
  DS="$(bq --project_id="${PROJECT_ID}" ls --format=json 2>/dev/null \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['datasetReference']['datasetId'] if d else '')")"
fi
echo "# project=${PROJECT_ID} dataset=${DS}"

q() { bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=pretty "$1"; }

echo
echo "== 1) 滞在(分)の分布（上位30値） =="
q "SELECT minutes, COUNT(*) AS row_count
   FROM \`${PROJECT_ID}.${DS}.visits_current\`
   WHERE minutes IS NOT NULL
   GROUP BY minutes ORDER BY minutes DESC LIMIT 30"

echo
echo "== 2) 異常に大きい行の実例（120分超・新しい順20件） =="
q "SELECT DATETIME(at, 'Asia/Tokyo') AS at_jst, type, ticketId, minutes, billedCoin, billedRewardPoint
   FROM \`${PROJECT_ID}.${DS}.visits_current\`
   WHERE minutes > 120
   ORDER BY at DESC LIMIT 20"

echo
echo "== 3) 異常値はいつの時代のデータか（月別） =="
q "SELECT FORMAT_DATE('%Y-%m', DATE(at, 'Asia/Tokyo')) AS month,
          COUNT(*) AS visits,
          COUNTIF(minutes > 120) AS over120,
          MAX(minutes) AS max_minutes
   FROM \`${PROJECT_ID}.${DS}.visits_current\`
   WHERE minutes IS NOT NULL
   GROUP BY month ORDER BY month"

echo
echo "== 4) チケット別の分の代表値（異常がチケット固有かを見る） =="
q "SELECT ticketId, COUNT(*) AS row_count,
          APPROX_QUANTILES(minutes, 2)[OFFSET(1)] AS median_minutes,
          MAX(minutes) AS max_minutes
   FROM \`${PROJECT_ID}.${DS}.visits_current\`
   WHERE minutes IS NOT NULL
   GROUP BY ticketId ORDER BY max_minutes DESC LIMIT 20"

echo
echo "----"
echo "読み方:"
echo "・3) で異常値が古い月（WEB版時代）に集中 → 旧データの initialTime の単位が違う可能性"
echo "・4) で特定チケットだけ最大値が大きい → チケット仕様（長時間券）で正常の可能性"
echo "・2) の実例を見て、本番の userRecordVisits の該当ドキュメントと突き合わせます"
