#!/usr/bin/env bash
# 手順5: 結果の確認（読み取りのみ）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

echo "=== 11/6以降の無料枠の内訳（売上は0のはず） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty \
  'SELECT type, entryType, ticketId, COUNT(*) AS n, SUM(revenue) AS revenue FROM vcafe_analytics.visits_current_range("2026-11-06","2026-11-14",NULL) WHERE type IN ("free","trial") GROUP BY 1,2,3 ORDER BY n DESC'

echo
echo "=== 日別の件数（10/20・10/25 が埋まっているか） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=40 \
  'SELECT DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR),"Asia/Tokyo") AS d, COUNT(*) AS n, COUNTIF(type="free") AS free, COUNTIF(type="trial") AS trial FROM vcafe_analytics.visits_current_range("2026-10-15","2026-11-14",NULL) GROUP BY d ORDER BY d'

echo
echo "=== 直近の同期の状態 ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty \
  'SELECT source, status, errorCode, FORMAT_TIMESTAMP("%m-%d %H:%M", startedAt, "Asia/Tokyo") AS started, readCount, insertedCount FROM vcafe_analytics.sync_runs WHERE startedAt > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 HOUR) ORDER BY startedAt DESC LIMIT 20'
