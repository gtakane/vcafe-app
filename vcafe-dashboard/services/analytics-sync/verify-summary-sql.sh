#!/usr/bin/env bash
# 概要KPIについて「SQL集計」と「現行のクライアント集計」が実データで一致するか確認する。
# 読み取りのみ。段階1（サーバー集計への移行）の前に必ず実行すること。
#
#   bash verify-summary-sql.sh 2026-07-01 2026-07-28
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-vcafe-admin-analytics}"
DS="${BIGQUERY_DATASET:-vcafe_analytics}"
START="${1:-2026-07-01}"
END="${2:-2026-07-28}"

echo "# project=${PROJECT_ID} dataset=${DS} 期間=${START}〜${END}"
echo "# lib/summary-sql.ts と同じ定義のSQLを実行します（tests/summary-sql.test.ts が定義を固定）"

bq --project_id="${PROJECT_ID}" query --use_legacy_sql=false --format=pretty \
  --parameter="startDate:STRING:${START}" --parameter="endDate:STRING:${END}" \
"WITH v AS (
   SELECT * FROM \`${PROJECT_ID}.${DS}.visits_current\`
   WHERE DATE(TIMESTAMP_SUB(\`at\`, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN DATE(@startDate) AND DATE(@endDate)
 ), s AS (
   SELECT * FROM \`${PROJECT_ID}.${DS}.shifts_current\`
   WHERE DATE(TIMESTAMP_SUB(scheduledStart, INTERVAL 2 HOUR), 'Asia/Tokyo') BETWEEN DATE(@startDate) AND DATE(@endDate)
 )
 SELECT
   COALESCE((SELECT SUM(weight) FROM v), 0) AS visits,
   COALESCE((SELECT SUM(IF(type != 'trial', weight, 0)) FROM v), 0) AS paid,
   COALESCE((SELECT SUM(revenue + cheki * 500) FROM v), 0) AS revenue,
   (SELECT COUNT(DISTINCT customerId) FROM v) AS customerCount,
   COALESCE((SELECT SUM(cheki) FROM v), 0) AS cheki,
   ROUND(COALESCE((SELECT SUM(TIMESTAMP_DIFF(COALESCE(actualEnd, scheduledEnd), COALESCE(actualStart, scheduledStart), SECOND)) / 3600 FROM s), 0), 2) AS workHours,
   ROUND(COALESCE((SELECT SUM(GREATEST(TIMESTAMP_DIFF(COALESCE(actualStart, scheduledStart), scheduledStart, SECOND), 0)) / 60 FROM s), 0), 2) AS lateMinutes"

echo
echo "----"
echo "確認方法:"
echo "・ダッシュボードで同じ期間を表示し、上の数値と一致するか目視で比べる"
echo "  ご帰宅数 / 売上 / 実働時間 / 記念撮影(cheki) の4つ"
echo "・1つでもずれたら段階1へ進まないこと。SQLとクライアントで定義がずれている"
echo "・ずれた場合は lib/summary-sql.ts と lib/analytics.ts の summarize() を突き合わせる"
