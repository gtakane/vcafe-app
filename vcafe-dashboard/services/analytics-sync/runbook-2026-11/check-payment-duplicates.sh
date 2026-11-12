#!/usr/bin/env bash
# 重複している課金の2行が、どう違うのかを調べる（読み取りのみ・個人情報や生のIDは表示しない）
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=50 '
WITH p AS (
  SELECT * FROM vcafe_analytics.payments_current_range(DATE "2025-12-01", DATE "2026-07-31")
  WHERE DATE(`at`, "Asia/Tokyo") BETWEEN DATE "2025-12-01" AND DATE "2026-07-31"
), g AS (
  SELECT customerId, `at`, amount FROM p GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
), d AS (
  SELECT p.* FROM p JOIN g USING (customerId, `at`, amount)
)
SELECT
  LENGTH(id) AS id_length, REGEXP_CONTAINS(id, r"[_/|:]") AS id_has_separator,
  recordKey IS NULL AS no_record_key, runId IS NULL AS no_run_id, sourceUpdatedAt IS NULL AS no_source_updated,
  channel, status, vendor IS NULL AS no_vendor,
  COUNT(*) AS row_count, MIN(DATE(syncedAt_proxy)) AS first_synced, MAX(DATE(syncedAt_proxy)) AS last_synced
FROM (SELECT d.*, COALESCE(sourceUpdatedAt, `at`) AS syncedAt_proxy FROM d)
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8 ORDER BY row_count DESC'
echo
echo "=== 生テーブルでの取り込み日（重複している課金の行） ==="
bq query --project_id=$P --use_legacy_sql=false --format=pretty --max_rows=50 '
WITH raw AS (
  SELECT * FROM vcafe_analytics.payments_raw
  WHERE DATE(`at`) BETWEEN DATE "2025-11-30" AND DATE "2026-08-01" AND source = "userPayments"
), g AS (SELECT customerId, `at`, amount FROM raw GROUP BY 1, 2, 3 HAVING COUNT(DISTINCT id) > 1)
SELECT DATE(syncedAt) AS synced_day, LENGTH(id) AS id_length, recordKey IS NULL AS no_record_key, COUNT(*) AS row_count, COUNT(DISTINCT id) AS ids
FROM raw JOIN g USING (customerId, `at`, amount) GROUP BY 1, 2, 3 ORDER BY 1, 2'
